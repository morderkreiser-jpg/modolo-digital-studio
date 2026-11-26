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
//
// THE "CALL" KIND (RealtimeCallProvider)
//
//   Our server creates the call itself: the browser sends its SDP offer to /api/voice/call, the
//   server passes it to the provider with the session configuration and the API key, and hands the
//   answer back. The server then holds a control connection of its own to the call (ControlSocket):
//   it sends the greeting and the tool outputs, and sees every event of the conversation. Such a
//   provider confirms and settles its calls through OUR call controller (confirmRealtimeCall and
//   settleReportedCall), not through toolWebhookUrl: guarantee 8 does not apply to it, guarantees
//   1, 3, 4 and 7 do (the key never leaves the server, every network call is bounded and honours
//   `signal`, nothing throws, nothing personal is logged).
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

/** Call ids of the "call" kind as OpenAI issues them (rtc_u0_… seen; '-' allowed in case of base64url). */
export const CALL_ID_RE = /^rtc_[A-Za-z0-9_-]{6,120}$/;

/** Opaque JSON event of the provider's control connection. */
export type ControlEvent = Record<string, unknown>;

/** The server-held control connection of one call (OpenAI: the "sideband" WebSocket). */
export interface ControlSocket {
  /** False when the socket is not open (the event was not sent). Never throws. */
  send(event: ControlEvent): boolean;
  /** Idempotent. Never throws. Does not wait for the close to complete. */
  close(code?: number): void;
  onEvent(listener: (event: ControlEvent) => void): void;
  /** Called once, whatever closed it. */
  onClose(listener: (info: { code: number }) => void): void;
}

/** Time source of the call controller; tests pass a fake one. */
export interface ControllerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CreateCallArgs {
  tenantId: string;
  sessionId: string;
  locale: VoiceLocale;
  /** The provider's session configuration (built by the adapter's own builder; opaque here). */
  session: Record<string, unknown>;
  /** Validated and normalised SDP offer (CRLF line ends). */
  offerSdp: string;
  signal?: AbortSignal;
}

export type CreateCallResult =
  | { ok: true; callId: string; answerSdp: string }
  | {
      ok: false;
      /** bad_request: the provider refused the OFFER (not its fault, not counted by the breaker). */
      code: "unavailable" | "upstream" | "timeout" | "busy" | "bad_request";
      /** A failed create may still have created a call: the caller hangs it up. */
      callId?: string;
      retryAfter?: number;
      /** HTTP status of the provider's answer, for the log only. */
      httpStatus?: number;
      /** The provider's own error code of a refused request (4xx), for the log only. */
      providerCode?: string;
    };

export type OpenControlResult = { ok: true; socket: ControlSocket } | { ok: false; code: "timeout" | "upstream" | "no_websocket" };

/**
 * A provider whose calls our server creates and controls ("call" kind). Guarantees: the API key
 * never leaves the server; every network call is bounded and honours `signal`; nothing throws;
 * confirmsCalls is true because OUR controller confirms and settles the call (it calls
 * confirmRealtimeCall and settleReportedCall itself; guarantee 8 of RealtimeProvider does not apply).
 */
export interface RealtimeCallProvider {
  readonly id: string;
  readonly kind: "call";
  readonly confirmsCalls: true;
  createCall(args: CreateCallArgs): Promise<CreateCallResult>;
  openControl(callId: string, options: { signal?: AbortSignal; timeoutMs: number }): Promise<OpenControlResult>;
  /** Best effort, never throws, gives up after timeoutMs (404 counts as done). */
  hangUp(callId: string, options: { timeoutMs: number }): Promise<{ ok: boolean; httpStatus?: number }>;
}

export type VoiceProvider = RealtimeProvider | RealtimeCallProvider;

export function isCallProvider(provider: VoiceProvider | null | undefined): provider is RealtimeCallProvider {
  return provider !== null && provider !== undefined && (provider as { kind?: unknown }).kind === "call";
}
