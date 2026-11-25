// A fake realtime provider for tests and local development. It makes no network call, costs
// nothing and hands out tokens that are obviously fake ("mock_" + session id), which no real SDK
// accepts. It can be told to fail or to be slow, so the breaker and timeout paths can be tested.
import type { VoiceLocale } from "@/lib/voice/types";
import type { CreateWebSessionArgs, CreateWebSessionResult, RealtimeProvider } from "./types";

export type MockFailure = "unavailable" | "upstream" | "timeout";

/** What the mock saw of one call. No prompt text: its length is enough for tests. */
export interface MockProviderCall {
  tenantId: string;
  sessionId: string;
  locale: VoiceLocale;
  maxSeconds: number;
  toolNames: string[];
  systemPromptChars: number;
  greetingChars: number;
  toolWebhookUrl: string;
}

export interface MockRealtimeProvider extends RealtimeProvider {
  readonly id: "mock";
  /** The most recent calls (at most MAX_RECORDED_CALLS), oldest first. */
  readonly calls: MockProviderCall[];
  /** Provider session ids passed to endSession(). */
  readonly ended: string[];
  /** From now on, fail with this code (null: succeed again). */
  failWith(code: MockFailure | null): void;
  /** From now on, wait this long before answering (0: answer at once). Honours the abort signal. */
  delay(ms: number): void;
}

/** Lifetime of a mock token: like a real provider's, a minute to open the connection. */
export const MOCK_TOKEN_TTL_SECONDS = 60;
// The process-wide mock (VOICE_PROVIDER=mock in development) must not grow without bound.
const MAX_RECORDED_CALLS = 100;

export function createMockProvider(
  options: { failWith?: MockFailure | null; delayMs?: number; now?: () => number } = {},
): MockRealtimeProvider {
  let failure: MockFailure | null = options.failWith ?? null;
  let delayMs = toDelay(options.delayMs);
  const clock = options.now ?? Date.now;
  const calls: MockProviderCall[] = [];
  const ended: string[] = [];

  return {
    id: "mock",
    calls,
    ended,
    failWith(code) {
      failure = code;
    },
    delay(ms) {
      delayMs = toDelay(ms);
    },
    async createWebSession(args: CreateWebSessionArgs): Promise<CreateWebSessionResult> {
      calls.push({
        tenantId: args.tenantId,
        sessionId: args.sessionId,
        locale: args.locale,
        maxSeconds: args.maxSeconds,
        toolNames: args.tools.map((tool) => tool.name),
        systemPromptChars: args.systemPrompt.length,
        greetingChars: args.greeting.length,
        toolWebhookUrl: args.toolWebhookUrl,
      });
      if (calls.length > MAX_RECORDED_CALLS) calls.splice(0, calls.length - MAX_RECORDED_CALLS);

      if (delayMs > 0 && !(await wait(delayMs, args.signal))) return { ok: false, code: "timeout" };
      if (args.signal?.aborted) return { ok: false, code: "timeout" };
      if (failure !== null) return { ok: false, code: failure };
      return {
        ok: true,
        token: `mock_${args.sessionId}`,
        expiresAt: clock() + MOCK_TOKEN_TTL_SECONDS * 1000,
        params: { provider: "mock" },
      };
    },
    async endSession(providerSessionId: string): Promise<void> {
      ended.push(providerSessionId);
      if (ended.length > MAX_RECORDED_CALLS) ended.splice(0, ended.length - MAX_RECORDED_CALLS);
    },
  };
}

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toDelay(ms: number | undefined): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : 0;
}
