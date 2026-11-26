// Picks the realtime provider for the configuration, and opens provider sessions behind the
// circuit breaker and a timeout. Server-only. Routes call openProviderSession(), never an
// adapter directly, so the guarantees of ./types.ts hold for every provider. getVoiceProvider()
// also returns providers of the "call" kind (OpenAI), whose calls our own server creates.
import type { KVStore } from "@/lib/assistant/server/store";
import type { VoiceEnv } from "../env";
import { isOpen, recordFailure, recordSuccess } from "../breaker";
import { logVoiceEvent } from "../log";
import { createMockProvider, type MockRealtimeProvider } from "./mock";
import { createOpenAiProvider } from "./openai";
import type { CreateWebSessionArgs, CreateWebSessionResult, RealtimeCallProvider, RealtimeProvider, VoiceProvider } from "./types";

export type {
  ControlEvent,
  ControllerClock,
  ControlSocket,
  CreateCallArgs,
  CreateCallResult,
  CreateWebSessionArgs,
  CreateWebSessionResult,
  OpenControlResult,
  RealtimeCallProvider,
  RealtimeProvider,
  VoiceProvider,
} from "./types";
export { CALL_ID_RE, isCallProvider } from "./types";

/** How long a provider may take to mint a session token before we give up. */
export const PROVIDER_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 20_000;
// A provider token is a short opaque string; anything longer is not one.
const MAX_PROVIDER_TOKEN_CHARS = 4096;

let mock: MockRealtimeProvider | null = null;

/** The provider VOICE_PROVIDER names, or null for "none". One instance per process. */
export function getRealtimeProvider(env: VoiceEnv): RealtimeProvider | null {
  if (env.provider === "mock") return (mock ??= createMockProvider());
  return null;
}

// The OpenAI provider, with the key and the settings it was built from: a changed key or setting
// (tests, a reloaded configuration) builds a new one instead of keeping the old values.
let openai: { provider: RealtimeCallProvider; apiKey: string; settings: string } | null = null;

/**
 * The provider VOICE_PROVIDER names, of either kind: the mock (the same instance as
 * getRealtimeProvider's), the OpenAI provider when its key is set, else null.
 */
export function getVoiceProvider(env: VoiceEnv): VoiceProvider | null {
  if (env.provider === "mock") return getRealtimeProvider(env);
  if (env.provider !== "openai" || env.providerApiKey === null) return null;
  const apiKey = env.providerApiKey;
  const settings = JSON.stringify(env.openai);
  if (openai === null || openai.apiKey !== apiKey || openai.settings !== settings) {
    openai = { provider: createOpenAiProvider({ apiKey, settings: env.openai }), apiKey, settings };
  }
  return openai.provider;
}

/**
 * Asks `provider` for a web session token, with every safeguard around it:
 *   - breaker open → "unavailable" at once, the provider is not called;
 *   - the call is cut after `timeoutMs`, whether or not the adapter honours its signal;
 *   - an adapter that throws or answers with a malformed result counts as "upstream";
 *   - upstream errors and timeouts feed the breaker, successes close a half-open one. A timeout
 *     caused by the CALLER's signal (the visitor left) is not the provider's fault and is not
 *     counted.
 * Never throws.
 */
export async function openProviderSession(args: {
  provider: RealtimeProvider;
  store: KVStore;
  session: Omit<CreateWebSessionArgs, "signal">;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: number;
}): Promise<CreateWebSessionResult> {
  const { provider, store, session } = args;
  const tenantId = session.tenantId;
  if (await isOpen(store, tenantId, provider.id, args.now)) {
    logVoiceEvent({ op: "provider_session", tenant: tenantId, provider: provider.id, outcome: "breaker_open" });
    return { ok: false, code: "unavailable" };
  }

  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(clampTimeout(args.timeoutMs));
  const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
  const result = await raceAbort(
    Promise.resolve()
      .then(() => provider.createWebSession({ ...session, signal }))
      .then(checkResult, (): CreateWebSessionResult => ({ ok: false, code: "upstream" })),
    signal,
  );

  const callerGone = args.signal?.aborted === true && !timeout.aborted;
  let opened = false;
  if (result.ok) {
    await recordSuccess(store, tenantId, provider.id, args.now);
  } else if (result.code !== "unavailable" && !callerGone) {
    opened = await recordFailure(store, tenantId, provider.id, args.now);
  }
  logVoiceEvent({
    op: "provider_session",
    tenant: tenantId,
    provider: provider.id,
    outcome: result.ok ? "ok" : result.code,
    callerGone: callerGone || undefined,
    ms: Date.now() - startedAt,
  });
  if (opened) logVoiceEvent({ warn: "breaker_opened", tenant: tenantId, provider: provider.id });
  return result;
}

/** The adapter's answer, or "upstream" when it does not have the promised shape. */
function checkResult(value: unknown): CreateWebSessionResult {
  if (typeof value !== "object" || value === null) return { ok: false, code: "upstream" };
  const result = value as Record<string, unknown>;
  if (result.ok === false) {
    const code = result.code;
    return code === "unavailable" || code === "timeout" ? { ok: false, code } : { ok: false, code: "upstream" };
  }
  if (result.ok !== true) return { ok: false, code: "upstream" };
  const { token, expiresAt, params } = result;
  if (typeof token !== "string" || token === "" || token.length > MAX_PROVIDER_TOKEN_CHARS) {
    return { ok: false, code: "upstream" };
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return { ok: false, code: "upstream" };
  if (params === undefined) return { ok: true, token, expiresAt };
  if (typeof params !== "object" || params === null || Array.isArray(params)) return { ok: false, code: "upstream" };
  const clean: Record<string, string> = {};
  for (const [key, entry] of Object.entries(params)) {
    if (typeof entry !== "string") return { ok: false, code: "upstream" };
    clean[key] = entry;
  }
  return { ok: true, token, expiresAt, params: clean };
}

/** `work`, or a "timeout" result as soon as `signal` aborts, whichever comes first. */
async function raceAbort(work: Promise<CreateWebSessionResult>, signal: AbortSignal): Promise<CreateWebSessionResult> {
  const timedOut: CreateWebSessionResult = { ok: false, code: "timeout" };
  if (signal.aborted) return timedOut;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<CreateWebSessionResult>((resolve) => {
    onAbort = () => resolve(timedOut);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return PROVIDER_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}
