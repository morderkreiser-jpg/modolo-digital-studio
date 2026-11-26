// Network code shared by the live transports: the session request, the turn stream (Server-Sent
// Events), the realtime call stream, the ready signal and the end report. Every function here
// resolves instead of throwing, so a transport never has an unhandled rejection between it and
// the widget.
//
// Wire format of both streams (TurnStreamEvent and CallStreamEvent in lib/voice/types.ts): frames
// separated by a blank line, each "data: <json>"; lines starting with ":" are comments (": ping"
// keep-alives while the model thinks or the call runs) and are skipped.
import {
  isVoiceLocale,
  isVoiceToolName,
  type CallEndReason,
  type CallRequestBody,
  type CallStreamEvent,
  type EndRequestBody,
  type ReadyRequestBody,
  type SessionGrant,
  type SessionRequestBody,
  type TurnStreamEvent,
  type VoiceApiError,
  type VoiceErrorCode,
  type VoiceLocale,
  type VoiceMode,
} from "@/lib/voice/types";
import { VOICE_SERVER_ERROR_CODES, type VoiceFailureCode } from "../voice-machine";

const MODES: readonly VoiceMode[] = ["scripted", "local", "realtime"];
/** A frame larger than this is not ours: the decoder drops it instead of growing without end. */
const MAX_FRAME_CHARS = 256 * 1024;
const SESSION_TIMEOUT_MS = 15_000;
/** The call route answers with its headers once the provider created the call (about a second). */
const CALL_OPEN_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 5_000;
/** A browser's answer SDP is a few kilobytes; anything far larger is not one. */
const MAX_ANSWER_SDP_CHARS = 20_000;
const CALL_END_REASONS: readonly CallEndReason[] = ["assistant", "timeout", "silence", "user", "error", "limit"];
/** Our caption ids: "a-<n>" for the assistant, "c-<n>" for the caller. */
const CAPTION_ID_RE = /^[ac]-\d{1,6}$/;

export type SessionResult =
  | { ok: true; grant: SessionGrant }
  | { ok: false; code: VoiceFailureCode; retryAfter?: number };

/**
 * POST config.endpoints.session. Resolves with the grant or a failure code; never throws.
 *
 * The live transports pass no `signal`: once sent, a session request runs to its answer even if
 * the visitor stops meanwhile, because the server may already have admitted the session (minutes,
 * spend and a concurrency slot reserved) and only the token in the answer can hand it back. Only
 * the request's own deadline (SESSION_TIMEOUT_MS) cuts it short. An example (scripted) may abort:
 * it reserves nothing.
 */
export async function requestSession(
  endpoint: string,
  body: SessionRequestBody,
  signal?: AbortSignal,
): Promise<SessionResult> {
  if (isOffline()) return { ok: false, code: "offline" };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SESSION_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: timeout.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await readJson(response);
    if (response.ok && isSessionGrant(payload)) return { ok: true, grant: payload };
    return failureFrom(response, payload);
  } catch {
    if (signal?.aborted) return { ok: false, code: "network" };
    // Our own deadline ran out: the server did not answer in time.
    if (timeout.signal.aborted) return { ok: false, code: "timeout" };
    return { ok: false, code: isOffline() ? "offline" : "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** The failure carried by a non-stream answer of the turn endpoint (a JSON VoiceApiError). */
export async function readFailure(response: Response): Promise<{ code: VoiceFailureCode; retryAfter?: number }> {
  const payload = await readJson(response);
  const failure = failureFrom(response, payload);
  return { code: failure.code, retryAfter: failure.retryAfter };
}

export function isEventStream(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}

export type StreamOutcome = "done" | "error" | "eof" | "aborted" | "idle" | "network";

/**
 * Reads an SSE body and hands each decoded event to `onEvent`. Resolves with how it ended:
 * after a `done` or `error` event ("done" / "error"), at the end of the body without either
 * ("eof"), when `signal` aborts ("aborted"), when no byte arrived for `idleTimeoutMs` ("idle"),
 * or on a broken connection ("network"). Never throws.
 */
export async function readTurnStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TurnStreamEvent) => void,
  options: { signal: AbortSignal; idleTimeoutMs: number },
): Promise<StreamOutcome> {
  return readStream(body, onEvent, options, isTurnStreamEvent, (event) =>
    event.type === "done" ? "done" : event.type === "error" ? "error" : null,
  );
}

/**
 * Reads the body of a realtime call (POST /api/voice/call) as readTurnStream reads a turn: it
 * ends with "done" after an `ended` event and with "error" after an `error` event; the other
 * outcomes are the same. Never throws.
 */
export async function readCallStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: CallStreamEvent) => void,
  options: { signal: AbortSignal; idleTimeoutMs: number },
): Promise<StreamOutcome> {
  return readStream(body, onEvent, options, isCallStreamEvent, (event) =>
    event.type === "ended" ? "done" : event.type === "error" ? "error" : null,
  );
}

async function readStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  options: { signal: AbortSignal; idleTimeoutMs: number },
  isEvent: (value: unknown) => value is T,
  settles: (event: T) => StreamOutcome | null,
): Promise<StreamOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseDecoder(isEvent);
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idle = true;
      reader.cancel().catch(() => undefined);
    }, options.idleTimeoutMs);
  };
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  options.signal.addEventListener("abort", onAbort, { once: true });

  const deliver = (events: T[]): StreamOutcome | null => {
    for (const event of events) {
      onEvent(event);
      const settled = settles(event);
      if (settled) return settled;
    }
    return null;
  };

  try {
    armIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (options.signal.aborted) return "aborted";
      if (idle) return "idle";
      if (done) break;
      armIdle();
      const settled = deliver(sse.push(decoder.decode(value, { stream: true })));
      if (settled) {
        reader.cancel().catch(() => undefined);
        return settled;
      }
    }
    return deliver(sse.push(decoder.decode()).concat(sse.flush())) ?? "eof";
  } catch {
    if (options.signal.aborted) return "aborted";
    return idle ? "idle" : "network";
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Incremental SSE decoder: push text as it arrives, get back the complete events. Comment
 * frames, unknown fields, malformed JSON and events outside the contract (`isEvent`, the turn
 * stream's by default) are skipped.
 */
export function createSseDecoder<T = TurnStreamEvent>(
  isEvent: (value: unknown) => value is T = isTurnStreamEvent as never,
): { push: (chunk: string) => T[]; flush: () => T[] } {
  let buffer = "";

  const decodeFrame = (frame: string, events: T[]) => {
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue; // comment, e.g. ": ping"
      if (line === "data" || line.startsWith("data:")) {
        const value = line.slice(5);
        data.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    if (data.length === 0) return;
    try {
      const parsed: unknown = JSON.parse(data.join("\n"));
      if (isEvent(parsed)) events.push(parsed);
    } catch {
      // Not JSON: not one of ours.
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      // CRLF and CR line ends count as LF. A CR at the very end may be half of a CRLF split
      // across two chunks: it waits for the next chunk.
      const held = buffer.endsWith("\r") ? "\r" : "";
      let text = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, "\n");
      const events: T[] = [];
      let boundary = text.indexOf("\n\n");
      while (boundary !== -1) {
        decodeFrame(text.slice(0, boundary), events);
        text = text.slice(boundary + 2);
        boundary = text.indexOf("\n\n");
      }
      buffer = text.length > MAX_FRAME_CHARS ? "" : text + held;
      return events;
    },
    flush() {
      const events: T[] = [];
      const rest = buffer.replace(/\r\n?/g, "\n").trim();
      buffer = "";
      if (rest) decodeFrame(rest, events);
      return events;
    },
  };
}

export type CallOpenResult =
  | { ok: true; body: ReadableStream<Uint8Array> }
  | { ok: false; code: VoiceFailureCode; retryAfter?: number };

/**
 * POST config.endpoints.call with the browser's SDP offer. Resolves with the event stream's body
 * once the headers are there, or a failure code; never throws. Our own deadline covers only the
 * wait for the headers (CALL_OPEN_TIMEOUT_MS): the body is the whole call and runs until the
 * server ends it or `signal` aborts.
 */
export async function openCall(endpoint: string, body: CallRequestBody, signal: AbortSignal): Promise<CallOpenResult> {
  if (isOffline()) return { ok: false, code: "offline" };
  const request = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, CALL_OPEN_TIMEOUT_MS);
  // Stays attached for the life of the body: aborting `signal` also cuts the running stream.
  const onAbort = () => request.abort();
  if (signal.aborted) request.abort();
  else signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: request.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    clearTimeout(timer);
    if (response.ok && isEventStream(response) && response.body) return { ok: true, body: response.body };
    signal.removeEventListener("abort", onAbort);
    return failureFrom(response, await readJson(response));
  } catch {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (signal.aborted) return { ok: false, code: "network" };
    if (timedOut) return { ok: false, code: "timeout" };
    return { ok: false, code: isOffline() ? "offline" : "network" };
  }
}

/**
 * Tells the ready endpoint that the call's audio is connected and plays. A keepalive fetch whose
 * short deadline (READY_TIMEOUT_MS) covers only the wait for the answer's headers: once they are
 * there the request is never aborted, and the body is read and discarded. Fire and forget; never
 * throws.
 */
export function sendReady(endpoint: string, body: ReadyRequestBody): void {
  try {
    const request = typeof AbortController === "function" ? new AbortController() : null;
    const timer = request ? setTimeout(() => request.abort(), READY_TIMEOUT_MS) : undefined;
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "same-origin",
      cache: "no-store",
      signal: request?.signal,
    })
      .then((response) => {
        clearTimeout(timer);
        return response.arrayBuffer();
      })
      .catch(() => {
        clearTimeout(timer);
      });
  } catch {
    // The server greets after its own fallback wait instead.
  }
}

/**
 * Tells the end endpoint the conversation is over. sendBeacon first: it survives the page being
 * closed. A refused beacon falls back to a keepalive fetch. Fire and forget; never throws.
 */
export function sendEnd(endpoint: string, body: EndRequestBody): void {
  const json = JSON.stringify(body);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(endpoint, new Blob([json], { type: "application/json" }))) return;
    }
  } catch {
    // Some browsers refuse beacons with a JSON type: the fetch below carries it instead.
  }
  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Nothing left to try; the server's session expiry covers it.
  }
}

// ---------------------------------------------------------------------------------------------
// Validation of what the server sends
// ---------------------------------------------------------------------------------------------

/**
 * A grant the widget can run. The limits are checked against what the server may really send
 * (lib/voice/server/env.ts VOICE_LIMIT_RANGES): a call length, a silence timeout and a turn size
 * above zero, and an end warning of zero or more (0 means "no warning"). Refusing a valid grant
 * would be worse than useless: the session is already admitted, and without its token the widget
 * could not even hand it back.
 */
export function isSessionGrant(value: unknown): value is SessionGrant {
  if (!isRecord(value) || value.ok !== true) return false;
  if (typeof value.sessionToken !== "string" || value.sessionToken === "") return false;
  if (typeof value.mode !== "string" || !(MODES as readonly string[]).includes(value.mode)) return false;
  if (!isVoiceLocale(value.locale) || !isFiniteNumber(value.expiresAt)) return false;
  const limits = value.limits;
  return (
    isRecord(limits) &&
    isPositive(limits.maxCallSeconds) &&
    isFiniteNumber(limits.warnBeforeEndSeconds) &&
    limits.warnBeforeEndSeconds >= 0 &&
    isPositive(limits.silenceTimeoutSeconds) &&
    isPositive(limits.maxTurnChars)
  );
}

/**
 * The language the server says a reply is in, when it says so: an optional `locale` on the
 * "start" or "done" event (not part of TurnStreamEvent yet; the decoder keeps extra fields).
 */
export function announcedLocale(event: TurnStreamEvent): VoiceLocale | null {
  if (event.type !== "start" && event.type !== "done") return null;
  const locale = (event as { locale?: unknown }).locale;
  return isVoiceLocale(locale) ? locale : null;
}

export function isTurnStreamEvent(value: unknown): value is TurnStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "start":
      return true;
    case "delta":
      return typeof value.text === "string";
    case "tool":
      return isVoiceToolName(value.name) && (value.status === "started" || value.status === "ok" || value.status === "failed");
    case "handoff":
      return isHandoff(value.handoff);
    case "done":
      return (
        typeof value.ended === "boolean" &&
        typeof value.remainingTurns === "number" &&
        typeof value.remainingSeconds === "number"
      );
    case "error":
      return isServerErrorCode(value.code) && (value.retryAfter === undefined || typeof value.retryAfter === "number");
    default:
      return false;
  }
}

/** One frame of the realtime call stream, exactly as CallStreamEvent describes it. */
export function isCallStreamEvent(value: unknown): value is CallStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "answer":
      return (
        typeof value.sdp === "string" &&
        value.sdp.length <= MAX_ANSWER_SDP_CHARS &&
        isFiniteNumber(value.maxSeconds) &&
        value.maxSeconds > 0
      );
    case "status":
      return value.status === "listening" || value.status === "thinking" || value.status === "speaking";
    case "interrupted":
      return true;
    case "activity":
      return value.speech === "started" || value.speech === "stopped";
    case "caption":
      return (
        typeof value.id === "string" &&
        CAPTION_ID_RE.test(value.id) &&
        (value.role === "assistant" || value.role === "caller") &&
        typeof value.text === "string" &&
        typeof value.final === "boolean" &&
        (value.before === undefined || (typeof value.before === "string" && CAPTION_ID_RE.test(value.before))) &&
        (value.locale === undefined || isVoiceLocale(value.locale))
      );
    case "tool":
      return isVoiceToolName(value.name) && (value.status === "started" || value.status === "ok" || value.status === "failed");
    case "handoff":
      return isHandoff(value.handoff);
    case "remaining":
      return isFiniteNumber(value.seconds) && value.seconds >= 0;
    case "ended":
      return typeof value.reason === "string" && (CALL_END_REASONS as readonly string[]).includes(value.reason);
    case "error":
      return isServerErrorCode(value.code) && (value.retryAfter === undefined || typeof value.retryAfter === "number");
    default:
      return false;
  }
}

function isHandoff(handoff: unknown): boolean {
  if (!isRecord(handoff)) return false;
  if (handoff.kind === "transfer") return typeof handoff.targetLabel === "string";
  return handoff.kind === "callback" || handoff.kind === "written";
}

function isServerErrorCode(value: unknown): value is VoiceErrorCode {
  return typeof value === "string" && (VOICE_SERVER_ERROR_CODES as readonly string[]).includes(value);
}

function failureFrom(response: Response, payload: unknown): { ok: false; code: VoiceFailureCode; retryAfter?: number } {
  const header = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  const headerRetry = Number.isFinite(header) && header > 0 ? header : undefined;
  if (isRecord(payload) && payload.ok === false && isServerErrorCode(payload.error)) {
    const error = payload as unknown as VoiceApiError;
    const retryAfter = typeof error.retryAfter === "number" && error.retryAfter > 0 ? error.retryAfter : headerRetry;
    return { ok: false, code: error.error, retryAfter };
  }
  // Not our JSON (a proxy's error page, a platform timeout): judged by the status alone.
  const status = response.status;
  const code: VoiceFailureCode =
    status === 400
      ? "bad_request"
      : status === 403
        ? "forbidden"
        : status === 409
          ? "turn_in_progress"
          : status === 413
            ? "too_large"
            : status === 429
              ? "rate_limited"
              : status === 503 || status === 404
                ? "unavailable"
                : status === 504
                  ? "timeout"
                  : "upstream";
  return { ok: false, code, retryAfter: headerRetry };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: unknown): boolean {
  return isFiniteNumber(value) && value > 0;
}
