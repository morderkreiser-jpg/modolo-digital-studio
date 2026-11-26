// Fakes of OpenAI's realtime endpoints for the provider tests: no network, no key, nothing paid.
//
// fakeOpenAiFetch(routes) is a `typeof fetch` that records every request (url, method, headers,
// the multipart fields) and answers per route: "create" is POST /v1/realtime/calls, "hangup" is
// POST /v1/realtime/calls/<id>/hangup. A route takes one answer, or a list used in order (the last
// one repeats). fakeWebSocketFactory() stands in for the control WebSocket: the test opens it,
// sends frames from the provider's side and closes it.
import assert from "node:assert/strict";
import type { WebSocketLike } from "@/lib/voice/server/providers/openai";

export type FakeAnswer =
  /** An HTTP answer. A non-string body is sent as JSON. */
  | { status: number; body?: unknown; headers?: Record<string, string> }
  /** Never answers until the request's signal aborts (then rejects as fetch does). */
  | "hang"
  /** Never answers, whatever the signal does (an upstream that ignores aborts). */
  | "hang_forever"
  /** Rejects as a network failure. */
  | "network_error";

export type FakeRoute = "create" | "hangup";

export interface RecordedRequest {
  route: FakeRoute | "unknown";
  url: string;
  method: string;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  /** The multipart fields as strings (create only). */
  form: Record<string, string> | null;
  signal: AbortSignal | null;
}

export interface FakeOpenAiFetch {
  fetch: typeof fetch;
  readonly requests: RecordedRequest[];
  /** The requests of one route. */
  of(route: FakeRoute): RecordedRequest[];
}

/** A placeholder answer SDP (only its first line matters to the provider). */
export const FAKE_ANSWER_SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

/** Answers in OpenAI's shapes. */
export const answers = {
  created(callId: string, sdp: string = FAKE_ANSWER_SDP): FakeAnswer {
    return { status: 201, body: sdp, headers: { location: `/v1/realtime/calls/${callId}`, "content-type": "application/sdp" } };
  },
  error(status: number, code: string | null, extra: { callId?: string; headers?: Record<string, string> } = {}): FakeAnswer {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra.headers };
    if (extra.callId !== undefined) headers.location = `/v1/realtime/calls/${extra.callId}`;
    return { status, body: { error: { type: "invalid_request_error", code, message: "placeholder" } }, headers };
  },
  ok(status = 200): FakeAnswer {
    return { status, body: "" };
  },
};

export function fakeOpenAiFetch(routes: Partial<Record<FakeRoute, FakeAnswer | FakeAnswer[]>>): FakeOpenAiFetch {
  const requests: RecordedRequest[] = [];
  const used: Record<FakeRoute, number> = { create: 0, hangup: 0 };

  function answerFor(route: FakeRoute): FakeAnswer | undefined {
    const configured = routes[route];
    if (configured === undefined) return undefined;
    if (!Array.isArray(configured)) return configured;
    const index = Math.min(used[route], configured.length - 1);
    used[route] += 1;
    return configured[index];
  }

  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    const route: RecordedRequest["route"] = /^\/v1\/realtime\/calls$/.test(path)
      ? "create"
      : /^\/v1\/realtime\/calls\/[^/]+\/hangup$/.test(path)
        ? "hangup"
        : "unknown";
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init?.headers).entries()) headers[name.toLowerCase()] = value;
    let form: Record<string, string> | null = null;
    if (init?.body instanceof FormData) {
      form = {};
      for (const [name, value] of init.body.entries()) {
        // OpenAI refuses Blob parts: every field must be a plain string.
        assert.equal(typeof value, "string", `form field ${name} must be a plain string`);
        form[name] = value as string;
      }
      assert.equal(typeof init.body.get("sdp"), "string");
    }
    const signal = init?.signal ?? null;
    requests.push({ route, url, method: init?.method ?? "GET", headers, form, signal });

    if (route === "unknown") throw new TypeError("fetch failed");
    const answer = answerFor(route);
    if (answer === undefined) throw new TypeError("fetch failed");
    if (answer === "network_error") throw new TypeError("fetch failed");
    if (answer === "hang_forever") return new Promise<Response>(() => undefined);
    if (answer === "hang") {
      return new Promise<Response>((_, reject) => {
        const fail = (): void => reject(new DOMException("This operation was aborted", "AbortError"));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    }
    if (signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    const body = answer.body === undefined ? null : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    // 1xx/204/205/304 cannot carry a body.
    const bodyless = answer.status === 204 || answer.status === 205 || answer.status === 304;
    return new Response(bodyless ? null : body, { status: answer.status, headers: answer.headers ?? {} });
  };

  return {
    fetch: fake as typeof fetch,
    requests,
    of(route) {
      return requests.filter((request) => request.route === route);
    },
  };
}

export interface FakeWebSocket extends WebSocketLike {
  readonly url: string;
  readonly headers: Record<string, string>;
  /** Every frame the provider sent, as sent. */
  readonly sent: string[];
  /** Codes close() was called with. */
  readonly closeCalls: Array<number | undefined>;
  /** The far side accepts the connection. */
  open(): void;
  /** A frame from the provider's side (anything: the wrapper must survive it). */
  receive(data: unknown): void;
  /** The far side closes the connection. */
  serverClose(code?: number): void;
  /** The connection fails: "error", then "close" 1006, as Node's WebSocket does. */
  fail(): void;
}

export interface FakeWebSocketFactory {
  openSocket: (url: string, headers: Record<string, string>) => FakeWebSocket;
  readonly sockets: FakeWebSocket[];
  /** The socket opened last. */
  last(): FakeWebSocket;
}

type Listener = (event: { data?: unknown; code?: number }) => void;

export function fakeWebSocketFactory(): FakeWebSocketFactory {
  const sockets: FakeWebSocket[] = [];

  function create(url: string, headers: Record<string, string>): FakeWebSocket {
    const listeners: Record<"open" | "message" | "close" | "error", Listener[]> = { open: [], message: [], close: [], error: [] };
    const sent: string[] = [];
    const closeCalls: Array<number | undefined> = [];
    let readyState = 0;

    function emit(type: keyof typeof listeners, event: { data?: unknown; code?: number }): void {
      for (const listener of listeners[type]) listener(event);
    }
    function closeWith(code: number | undefined): void {
      if (readyState === 3) return;
      readyState = 3;
      emit("close", code === undefined ? {} : { code });
    }

    return {
      url,
      headers: { ...headers },
      sent,
      closeCalls,
      get readyState() {
        return readyState;
      },
      send(data: string) {
        if (readyState !== 1) throw new Error("not open");
        sent.push(data);
      },
      close(code?: number) {
        closeCalls.push(code);
        // As Node's: the close event comes later; the tests deliver it with serverClose().
        if (readyState < 2) readyState = 2;
      },
      addEventListener(type, listener) {
        listeners[type].push(listener);
      },
      open() {
        if (readyState !== 0) return;
        readyState = 1;
        emit("open", {});
      },
      receive(data: unknown) {
        if (readyState !== 1) return;
        emit("message", { data });
      },
      serverClose(code?: number) {
        closeWith(code);
      },
      fail() {
        emit("error", {});
        closeWith(1006);
      },
    };
  }

  return {
    openSocket(url, headers) {
      const socket = create(url, headers);
      sockets.push(socket);
      return socket;
    },
    sockets,
    last() {
      const socket = sockets[sockets.length - 1];
      assert.ok(socket, "no socket was opened");
      return socket;
    },
  };
}
