// Network code shared by the live transports: the session request, the turn stream (Server-Sent
// Events) and the end report. Every function here resolves instead of throwing, so a transport
// never has an unhandled rejection between it and the widget.
//
// Wire format of the turn stream (see TurnStreamEvent in lib/voice/types.ts): frames separated by
// a blank line, each "data: <json>"; lines starting with ":" are comments (": ping" keep-alives
// while the model thinks) and are skipped.
import {
  isVoiceLocale,
  isVoiceToolName,
  type EndRequestBody,
  type SessionGrant,
  type SessionRequestBody,
  type TurnStreamEvent,
  type VoiceApiError,
  type VoiceErrorCode,
  type VoiceMode,
} from "@/lib/voice/types";
import { VOICE_SERVER_ERROR_CODES, type VoiceFailureCode } from "../voice-machine";

const MODES: readonly VoiceMode[] = ["scripted", "local", "realtime"];
/** A frame larger than this is not ours: the decoder drops it instead of growing without end. */
const MAX_FRAME_CHARS = 256 * 1024;
const SESSION_TIMEOUT_MS = 15_000;

export type SessionResult =
  | { ok: true; grant: SessionGrant }
  | { ok: false; code: VoiceFailureCode; retryAfter?: number };

/** POST config.endpoints.session. Resolves with the grant or a failure code; never throws. */
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
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseDecoder();
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

  const deliver = (events: TurnStreamEvent[]): StreamOutcome | null => {
    for (const event of events) {
      onEvent(event);
      if (event.type === "done") return "done";
      if (event.type === "error") return "error";
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
 * frames, unknown fields, malformed JSON and events outside the contract are skipped.
 */
export function createSseDecoder(): { push: (chunk: string) => TurnStreamEvent[]; flush: () => TurnStreamEvent[] } {
  let buffer = "";

  const decodeFrame = (frame: string, events: TurnStreamEvent[]) => {
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
      if (isTurnStreamEvent(parsed)) events.push(parsed);
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
      const events: TurnStreamEvent[] = [];
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
      const events: TurnStreamEvent[] = [];
      const rest = buffer.replace(/\r\n?/g, "\n").trim();
      buffer = "";
      if (rest) decodeFrame(rest, events);
      return events;
    },
  };
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

export function isSessionGrant(value: unknown): value is SessionGrant {
  if (!isRecord(value) || value.ok !== true) return false;
  if (typeof value.sessionToken !== "string" || value.sessionToken === "") return false;
  if (typeof value.mode !== "string" || !(MODES as readonly string[]).includes(value.mode)) return false;
  if (!isVoiceLocale(value.locale) || typeof value.expiresAt !== "number") return false;
  const limits = value.limits;
  return (
    isRecord(limits) &&
    isPositive(limits.maxCallSeconds) &&
    isPositive(limits.warnBeforeEndSeconds) &&
    isPositive(limits.silenceTimeoutSeconds) &&
    isPositive(limits.maxTurnChars)
  );
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
    case "handoff": {
      const handoff = value.handoff;
      if (!isRecord(handoff)) return false;
      if (handoff.kind === "transfer") return typeof handoff.targetLabel === "string";
      return handoff.kind === "callback" || handoff.kind === "written";
    }
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

function isPositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
