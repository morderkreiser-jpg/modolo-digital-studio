// The seam between Modolo Voice AI and a realtime voice provider (the service that streams the
// caller's audio, runs speech recognition, the model and speech synthesis, and calls our tools).
// Server-only: adapters hold API keys.
//
// WHAT EVERY ADAPTER MUST GUARANTEE
//
//   1. Only short-lived credentials leave the server. createWebSession() returns a token that is
//      valid for ONE session and expires within minutes (expiresAt). The provider's API key stays
//      in the server environment (VOICE_PROVIDER_API_KEY via getVoiceEnv()): it is never returned,
//      never put into `params`, never logged, never part of an error.
//   2. The session is bounded on the provider's side too: maxSeconds is passed on as the
//      provider's own hard limit, so a browser that ignores our timers still gets cut off.
//   3. Every network call has a timeout and honours `signal`. On abort or timeout it returns
//      { ok: false, code: "timeout" } promptly; it never waits for a slow upstream.
//   4. It never throws across this interface. Any failure maps onto a code:
//        unavailable — not configured, or the breaker is open (no network call was made)
//        upstream    — the provider answered with an error or something unparseable
//        timeout     — no answer in time
//   5. Failures feed the circuit breaker (lib/voice/server/breaker.ts): the caller records
//      upstream and timeout failures with recordFailure() and successes with recordSuccess(), and
//      checks isOpen() before calling. openProviderSession() in ./index.ts does all of this, so a
//      route never calls an adapter directly.
//   6. Tool calls come back through toolWebhookUrl, signed by the provider: the receiving route
//      verifies them with verifyWebhook() and seenBefore() before executing anything.
//   7. Nothing personal in logs: ids, codes and timings only (logVoiceEvent applies a guard).
//   8. confirmsCalls is true only when the adapter delivers, signed, through toolWebhookUrl, the
//      session events "started" (the browser really connected) and "ended" with the seconds the
//      provider bills (see handleToolRequest). Admission then charges nothing until "started",
//      and "ended" settles the minutes to what was billed. An adapter that cannot deliver both
//      leaves it unset: every session then reserves its whole call up front, because an unused
//      token could not be told from a call (lib/voice/server/limits.ts, header).
import type { VoiceLocale, VoiceToolDefinition } from "@/lib/voice/types";

export interface CreateWebSessionArgs {
  tenantId: string;
  /** Our session id (the `sid` of the session token). */
  sessionId: string;
  locale: VoiceLocale;
  /** Hard limit of the conversation, enforced by the provider. */
  maxSeconds: number;
  systemPrompt: string;
  /** First sentence the assistant says (states that it is an AI assistant). */
  greeting: string;
  tools: VoiceToolDefinition[];
  /** Absolute https URL of our tool webhook. */
  toolWebhookUrl: string;
  signal?: AbortSignal;
}

export type CreateWebSessionResult =
  | {
      ok: true;
      /** Short-lived, single-session credential for the browser SDK. Never an API key. */
      token: string;
      /** Unix ms after which the token no longer opens a session. */
      expiresAt: number;
      /** Non-secret values the browser SDK needs (e.g. a region or an agent id). */
      params?: Record<string, string>;
    }
  | { ok: false; code: "unavailable" | "upstream" | "timeout" };

export interface RealtimeProvider {
  /** Stable id: "mock", later the real providers. Used in breaker keys and logs. */
  readonly id: string;
  /** The adapter reports calls that connect and their billed length (guarantee 8 above). */
  readonly confirmsCalls?: boolean;
  createWebSession(args: CreateWebSessionArgs): Promise<CreateWebSessionResult>;
  /** Ends a running session on the provider's side (best effort, never throws). */
  endSession?(providerSessionId: string): Promise<void>;
}
