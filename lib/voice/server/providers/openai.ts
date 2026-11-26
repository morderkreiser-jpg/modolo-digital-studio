// The OpenAI realtime provider ("call" kind). Server-only: it holds the API key.
//
// Our server creates each call: the browser's SDP offer and our session configuration go to
// POST /v1/realtime/calls (two plain string fields of a multipart form), the answer SDP goes back
// to the browser, and the server then opens the call's control WebSocket ("sideband") with the
// call id. The audio itself flows between the browser and OpenAI; it never passes our server.
//
// The key is sent only in the Authorization header of our own requests. It is never part of a
// result, a log line or an error, and neither is the offer, the session or an answer body: error
// bodies are read for their `error.code` only. Every request is bounded and nothing here throws.
import type { OpenAiSettings } from "../env";
import { logVoiceEvent } from "../log";
import {
  CALL_ID_RE,
  type ControlEvent,
  type ControlSocket,
  type CreateCallArgs,
  type CreateCallResult,
  type OpenControlResult,
  type RealtimeCallProvider,
} from "./types";

export interface OpenAiProviderOptions {
  apiKey: string;
  settings: OpenAiSettings;
  /** Tests only: default globalThis.fetch. */
  fetch?: typeof fetch;
  /**
   * Tests only: default opens a global WebSocket with an Authorization header. Returning null
   * means the runtime has no WebSocket.
   */
  openSocket?: (url: string, headers: Record<string, string>) => WebSocketLike | null;
}

/** The part of a WebSocket the control connection uses (Node's global WebSocket has it). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown; code?: number }) => void): void;
}

/** Longest control frame we parse; OpenAI's events are far smaller. */
export const MAX_CONTROL_FRAME_CHARS = 1_048_576;
/** Retry-After of a 429 when OpenAI does not say (seconds), and the range we accept from it. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;
const MAX_RETRY_AFTER_SECONDS = 300;
/** Outer bound of a call creation whose caller passed no signal (call.ts passes a shorter one). */
const CREATE_CALL_MAX_MS = 20_000;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 60_000;
const WS_OPEN = 1;
/** The close code when the socket did not report one. */
const CLOSE_UNKNOWN = 1006;
/** What an error code of OpenAI's may look like to be passed on (the log's value pattern). */
const PROVIDER_CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function createOpenAiProvider(options: OpenAiProviderOptions): RealtimeCallProvider {
  const { apiKey, settings } = options;
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = `https://${settings.host}`;
  const authorization = { Authorization: `Bearer ${apiKey}` };

  return {
    id: "openai",
    kind: "call",
    confirmsCalls: true,

    async createCall(args: CreateCallArgs): Promise<CreateCallResult> {
      const bound = AbortSignal.timeout(CREATE_CALL_MAX_MS);
      const signal = args.signal ? AbortSignal.any([args.signal, bound]) : bound;
      try {
        if (signal.aborted) return { ok: false, code: "timeout" };
        // Plain strings only: OpenAI refuses Blob parts. fetch sets the multipart Content-Type.
        const form = new FormData();
        form.set("sdp", args.offerSdp);
        form.set("session", JSON.stringify(args.session));
        const response = await raceAbort(
          doFetch(`${base}/v1/realtime/calls`, { method: "POST", headers: { ...authorization }, body: form, signal }),
          signal,
        );
        return await readCreateAnswer(response, signal);
      } catch {
        return { ok: false, code: signal.aborted ? "timeout" : "upstream" };
      }
    },

    openControl(callId, { signal, timeoutMs }): Promise<OpenControlResult> {
      if (!CALL_ID_RE.test(callId)) return Promise.resolve({ ok: false, code: "upstream" });
      const host = settings.host;
      return openOpenAiSocket(`wss://${host}/v1/realtime?call_id=${encodeURIComponent(callId)}`, apiKey, {
        signal,
        timeoutMs,
        openSocket: options.openSocket,
      });
    },

    async hangUp(callId, { timeoutMs }): Promise<{ ok: boolean; httpStatus?: number }> {
      // Not a call id of ours: there is nothing to hang up, and nothing goes into the URL.
      if (typeof callId !== "string" || !CALL_ID_RE.test(callId)) return { ok: true };
      let signal: AbortSignal | undefined;
      try {
        signal = AbortSignal.timeout(clampTimeout(timeoutMs));
        const response = await raceAbort(
          doFetch(`${base}/v1/realtime/calls/${callId}/hangup`, { method: "POST", headers: { ...authorization }, signal }),
          signal,
        );
        discardBody(response);
        // 404: the call has already ended.
        if ((response.status >= 200 && response.status < 300) || response.status === 404) return { ok: true };
        return { ok: false, httpStatus: response.status };
      } catch {
        return { ok: false };
      }
    },
  };
}

/**
 * Opens the control WebSocket of a call. Resolves ok on "open"; "timeout" after timeoutMs or when
 * `signal` aborts (the socket is then closed); "upstream" when it errors or closes before it opens;
 * "no_websocket" when the runtime has none. Never rejects.
 */
export function openOpenAiSocket(
  url: string,
  apiKey: string,
  options: { signal?: AbortSignal; timeoutMs: number; openSocket?: OpenAiProviderOptions["openSocket"] },
): Promise<OpenControlResult> {
  const { signal } = options;
  if (signal?.aborted) return Promise.resolve({ ok: false, code: "timeout" });

  let ws: WebSocketLike | null;
  try {
    const open = options.openSocket ?? openGlobalWebSocket;
    ws = open(url, { Authorization: `Bearer ${apiKey}` });
  } catch {
    return Promise.resolve({ ok: false, code: "upstream" });
  }
  if (ws === null) return Promise.resolve({ ok: false, code: "no_websocket" });
  const socket = ws;
  const control = wrapSocket(socket);

  return new Promise<OpenControlResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), clampTimeout(options.timeoutMs));
    const onAbort = (): void => finish({ ok: false, code: "timeout" });

    function finish(result: OpenControlResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!result.ok) control.close(1000);
      resolve(result);
    }

    try {
      socket.addEventListener("open", () => finish({ ok: true, socket: control }));
      socket.addEventListener("error", () => finish({ ok: false, code: "upstream" }));
      socket.addEventListener("close", () => finish({ ok: false, code: "upstream" }));
    } catch {
      finish({ ok: false, code: "upstream" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The default socket opener: the runtime's global WebSocket (null when it has none). */
function openGlobalWebSocket(url: string, headers: Record<string, string>): WebSocketLike | null {
  return socketOpenerFor((globalThis as { WebSocket?: unknown }).WebSocket)(url, headers);
}

/**
 * A socket opener around a WebSocket constructor such as Node's, which takes request headers in
 * its second argument. The opener returns null when `ctor` is not a constructor. Exported for tests.
 */
export function socketOpenerFor(ctor: unknown): (url: string, headers: Record<string, string>) => WebSocketLike | null {
  return (url, headers) => {
    if (typeof ctor !== "function") return null;
    // TypeScript's DOM lib types the second argument as sub-protocols; Node's accepts { headers }.
    const NodeWebSocket = ctor as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocketLike;
    return new NodeWebSocket(url, { headers });
  };
}

/** The ControlSocket around one WebSocket. */
function wrapSocket(ws: WebSocketLike): ControlSocket {
  const eventListeners: Array<(event: ControlEvent) => void> = [];
  const closeListeners: Array<(info: { code: number }) => void> = [];
  let closedWith: number | null = null;
  let closeCalled = false;

  function reportClose(code: number): void {
    if (closedWith !== null) return;
    closedWith = code;
    for (const listener of closeListeners) callSafely(() => listener({ code }));
  }

  try {
    ws.addEventListener("message", (event) => {
      const parsed = parseFrame(event?.data);
      if (parsed === null) return;
      for (const listener of eventListeners) callSafely(() => listener(parsed));
    });
    ws.addEventListener("close", (event) => {
      const code = event?.code;
      reportClose(typeof code === "number" && Number.isInteger(code) ? code : CLOSE_UNKNOWN);
    });
  } catch {
    // A socket that cannot take listeners never opens either: openOpenAiSocket reports it.
  }

  return {
    send(event) {
      try {
        if (closedWith !== null || closeCalled || ws.readyState !== WS_OPEN) return false;
        ws.send(JSON.stringify(event));
        return true;
      } catch {
        return false;
      }
    },
    close(code = 1000) {
      if (closeCalled) return;
      closeCalled = true;
      try {
        ws.close(code);
      } catch {
        // A code the socket refuses, or a socket already gone: nothing left to close.
      }
    },
    onEvent(listener) {
      eventListeners.push(listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
      const code = closedWith;
      if (code !== null) queueMicrotask(() => callSafely(() => listener({ code })));
    },
  };
}

/** A control frame as an event: a string of bounded size holding an object with a string type. */
function parseFrame(data: unknown): ControlEvent | null {
  if (typeof data !== "string" || data.length > MAX_CONTROL_FRAME_CHARS) return null;
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return typeof (value as { type?: unknown }).type === "string" ? (value as ControlEvent) : null;
  } catch {
    return null;
  }
}

/** Maps the answer of POST /v1/realtime/calls onto a CreateCallResult. */
async function readCreateAnswer(response: Response, signal: AbortSignal): Promise<CreateCallResult> {
  const httpStatus = response.status;
  const callId = callIdFrom(response.headers.get("location"));
  // A failed create may still have created a call: its id goes back so that it can be hung up.
  const withId = callId !== null ? { callId } : {};

  try {
    if (httpStatus === 201) {
      const body = await raceAbort(response.text(), signal);
      if (callId !== null && body.startsWith("v=0")) return { ok: true, callId, answerSdp: body };
      return { ok: false, code: "upstream", httpStatus, ...withId };
    }
    if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 401 && httpStatus !== 403 && httpStatus !== 429) {
      const code = await errorCodeOf(response, signal);
      if (httpStatus === 400 && code === "invalid_offer") return { ok: false, code: "bad_request", httpStatus, ...withId };
      // Another refusal of the request (a session setting of ours, say): its error code goes back
      // for the call_open line, when it looks like a code.
      return {
        ok: false,
        code: "upstream",
        httpStatus,
        ...withId,
        ...(code !== null && PROVIDER_CODE_RE.test(code) ? { providerCode: code } : {}),
      };
    }
  } catch {
    return { ok: false, code: signal.aborted ? "timeout" : "upstream", httpStatus, ...withId };
  }
  discardBody(response);
  if (httpStatus === 401 || httpStatus === 403) {
    logVoiceEvent({ warn: "provider_auth", httpStatus });
    return { ok: false, code: "unavailable", httpStatus, ...withId };
  }
  if (httpStatus === 429) {
    return { ok: false, code: "busy", retryAfter: retryAfterOf(response.headers.get("retry-after")), httpStatus, ...withId };
  }
  return { ok: false, code: "upstream", httpStatus, ...withId };
}

/** The last path segment of a Location header, when it is a call id. */
function callIdFrom(location: string | null): string | null {
  if (typeof location !== "string" || location === "") return null;
  const path = location.split(/[?#]/)[0];
  const segments = path.split("/").filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  return last !== undefined && CALL_ID_RE.test(last) ? last : null;
}

/** `error.code` of an error body, or null. Nothing else of the body is kept. */
async function errorCodeOf(response: Response, signal: AbortSignal): Promise<string | null> {
  try {
    const body: unknown = JSON.parse(await raceAbort(response.text(), signal));
    if (typeof body !== "object" || body === null) return null;
    const error = (body as { error?: unknown }).error;
    if (typeof error !== "object" || error === null) return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    if (signal.aborted) throw new Error("aborted");
    return null;
  }
}

function retryAfterOf(header: string | null): number {
  if (header === null || !/^\s*\d+(\.\d+)?\s*$/.test(header)) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Math.ceil(Number(header));
  if (!Number.isFinite(seconds) || seconds < 1) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, seconds);
}

/** Lets go of an answer body we do not read. */
function discardBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Already read or locked: nothing to free.
  }
}

/** `work`, or a rejection as soon as `signal` aborts, whichever comes first. */
async function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    throw new Error("aborted");
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    work.catch(() => undefined);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function callSafely(fn: () => void): void {
  try {
    fn();
  } catch {
    // One listener's failure must not stop the others, nor reach the socket.
  }
}

function clampTimeout(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MAX_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}
