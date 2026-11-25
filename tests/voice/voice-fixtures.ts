// Shared helpers of the voice integration tests (brain, session, routes, isolation, summary):
// a fully controlled environment, Request builders and a reader for the turn stream.
import { register } from "node:module";
import { mock } from "node:test";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import { resetCalendarsForTests } from "@/lib/voice/calendar";
import { resetVoiceEnvForTests } from "@/lib/voice/server/env";
import type { VoiceDeps } from "@/lib/voice/server/handlers";
import type { SessionGrant, TurnStreamEvent, VoiceApiError } from "@/lib/voice/types";

/** Every variable the voice module and the summary email read. */
export const VOICE_TEST_ENV_KEYS = [
  "VOICE_ENABLED",
  "VOICE_MODE",
  "VOICE_BRAIN",
  "VOICE_MODEL",
  "VOICE_MAX_OUTPUT_TOKENS",
  "VOICE_SESSION_SECRET",
  "VOICE_PROVIDER",
  "VOICE_PROVIDER_API_KEY",
  "VOICE_PROVIDER_WEBHOOK_SECRET",
  "VOICE_COST_CHF_PER_MINUTE",
  "VOICE_ALERT_EMAIL",
  "VOICE_LAB",
  "VOICE_MAX_CALL_SECONDS",
  "VOICE_MINUTES_PER_DAY",
  "VOICE_MINUTES_PER_MONTH",
  "VOICE_BUDGET_CHF_PER_MONTH",
  "VOICE_MAX_CONCURRENT",
  "VOICE_GLOBAL_MINUTES_PER_DAY",
  "VOICE_GLOBAL_BUDGET_CHF_PER_MONTH",
  "VOICE_CHF_PER_USD",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ASSISTANT_HASH_SALT",
  "RESEND_API_KEY",
  "CONTACT_FROM",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NODE_ENV",
] as const;
export type VoiceTestEnvKey = (typeof VOICE_TEST_ENV_KEYS)[number];

export const TEST_SECRET = "voice-test-secret-0123456789-abcdefghijklmnop";
export const WEBHOOK_SECRET = "webhook-test-secret-0123456789";
export const SITE = "https://site.example";

// Next types NODE_ENV as read-only; tests write through a plain view.
const mutableEnv: Record<string, string | undefined> = process.env;

/**
 * Makes the environment exactly `vars` (every other voice variable unset) and forgets the cached
 * voice configuration and the demo calendars. Returns the function that restores everything.
 */
export function setVoiceEnv(vars: Partial<Record<VoiceTestEnvKey, string>>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of VOICE_TEST_ENV_KEYS) {
    saved.set(key, mutableEnv[key]);
    delete mutableEnv[key];
  }
  for (const [key, value] of Object.entries(vars)) mutableEnv[key] = value;
  resetVoiceEnvForTests();
  resetCalendarsForTests();
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete mutableEnv[key];
      else mutableEnv[key] = value;
    }
    resetVoiceEnvForTests();
    resetCalendarsForTests();
  };
}

/** The usual "local" mode with the mock brain. */
export function localEnv(extra: Partial<Record<VoiceTestEnvKey, string>> = {}): () => void {
  return setVoiceEnv({
    VOICE_ENABLED: "true",
    VOICE_MODE: "local",
    VOICE_BRAIN: "mock",
    VOICE_SESSION_SECRET: TEST_SECRET,
    ...extra,
  });
}

/** Collects the JSON log lines instead of printing them. Call inside a test (mock is restored after). */
export function captureLogs(): string[] {
  const lines: string[] = [];
  mock.method(console, "log", (line: unknown) => {
    lines.push(String(line));
  });
  mock.method(console, "warn", (line: unknown) => {
    lines.push(String(line));
  });
  return lines;
}

/**
 * Fresh dependencies for one test: its own store, so tests never share counters. One store plays
 * both parts (shared and accounting), as Upstash does in production, so a test can read the
 * counters and the state from `deps.store`. The memory store's separate accounting companion is
 * tested on its own (limits-abuse.test.ts).
 */
export function testDeps(overrides: Partial<VoiceDeps> = {}): VoiceDeps & { store: KVStore } {
  const store = overrides.store ?? createMemoryStore();
  return { store, accountingStore: store, resend: null, ...overrides };
}

/** What a voice route file exports. */
export interface VoiceRouteModule {
  POST(request: Request): Promise<Response>;
  runtime: string;
  maxDuration: number;
}

let routeHooksRegistered = false;

/**
 * Loads app/api/voice/<name>/route.ts as the site serves it. A route imports "next/server", which
 * Node resolves only with the hook in next-hooks.mjs: it is registered on the first call, so the
 * route has to be imported here, dynamically, not with a static import.
 */
export async function importVoiceRoute(name: "session" | "tool" | "turn" | "end"): Promise<VoiceRouteModule> {
  if (!routeHooksRegistered) {
    register("./next-hooks.mjs", import.meta.url);
    routeHooksRegistered = true;
  }
  return (await import(`@/app/api/voice/${name}/route`)) as VoiceRouteModule;
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function sessionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { tenant: "modolo", locale: "de", mode: "local", page: "/de", hp: "", ...overrides };
}

export async function readGrant(response: Response): Promise<SessionGrant> {
  const body = (await response.json()) as SessionGrant;
  if (body.ok !== true) throw new Error(`no grant: ${JSON.stringify(body)}`);
  return body;
}

export async function readError(response: Response): Promise<VoiceApiError> {
  return (await response.json()) as VoiceApiError;
}

/** Every event of a turn stream (comment frames skipped). */
export async function readEvents(response: Response): Promise<TurnStreamEvent[]> {
  const text = await response.text();
  const events: TurnStreamEvent[] = [];
  for (const frame of text.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data) events.push(JSON.parse(data) as TurnStreamEvent);
  }
  return events;
}

/** The text of the delta events, joined. */
export function spoken(events: readonly TurnStreamEvent[]): string {
  return events
    .filter((event): event is Extract<TurnStreamEvent, { type: "delta" }> => event.type === "delta")
    .map((event) => event.text)
    .join("");
}

/** Replaces one character of a token's payload, keeping the signature: a forgery. */
export function tamper(token: string): string {
  const [payload, signature] = token.split(".");
  const flipped = payload[5] === "A" ? "B" : "A";
  return `${payload.slice(0, 5)}${flipped}${payload.slice(6)}.${signature}`;
}
