// The OpenAI provider (lib/voice/server/providers/openai.ts) against fakes of OpenAI's endpoints:
// call creation and its error mapping, the control WebSocket, the hang-up, and getVoiceProvider().
// No request leaves the process: fetch and the WebSocket are injected fakes, the key is a
// placeholder, and globalThis.fetch and globalThis.WebSocket are never touched.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { getVoiceEnv, type OpenAiSettings, type VoiceEnv } from "@/lib/voice/server/env";
import { getRealtimeProvider, getVoiceProvider, isCallProvider } from "@/lib/voice/server/providers";
import {
  createOpenAiProvider,
  MAX_CONTROL_FRAME_CHARS,
  openOpenAiSocket,
  type OpenAiProviderOptions,
  socketOpenerFor,
} from "@/lib/voice/server/providers/openai";
import { buildOpenAiSession } from "@/lib/voice/server/providers/openai-session";
import type { ControlEvent, CreateCallArgs, CreateCallResult } from "@/lib/voice/server/providers/types";
import { answers, FAKE_ANSWER_SDP, fakeOpenAiFetch, fakeWebSocketFactory, type FakeAnswer } from "./fakes/openai-fetch";
import { captureLogs, setVoiceEnv, TEST_CALL_ID, TEST_OPENAI_KEY } from "./voice-fixtures";

const INSTRUCTIONS = "You are the AI assistant of a fictional moving company. Secret rule 42.";
const OFFER =
  "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n" +
  "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:offerufrag\r\na=ice-pwd:offerpasswordplaceholder\r\n" +
  "a=fingerprint:sha-256 AA:BB\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\n";

let logLines: string[] = [];
let restoreEnv: (() => void) | null = null;
beforeEach(() => {
  logLines = captureLogs();
});
afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  mock.restoreAll();
  const reached = networkReached;
  networkReached = 0;
  assert.equal(reached, 0, "a test used the real fetch or WebSocket");
});

/** The settings a deployment without any VOICE_OPENAI_* variable runs with. */
function defaultSettings(overrides: Partial<OpenAiSettings> = {}): OpenAiSettings {
  restoreEnv?.();
  restoreEnv = setVoiceEnv({});
  return { ...getVoiceEnv().openai, ...overrides };
}

// Stand-ins for the real fetch and WebSocket where a test injects no fake of its own: they are
// counted (afterEach checks none was used) and fail, so nothing can reach the network.
let networkReached = 0;
const noFetch = (() => {
  networkReached += 1;
  throw new TypeError("no network in tests");
}) as unknown as typeof fetch;
const noNetworkSocket = (): never => {
  networkReached += 1;
  throw new Error("no network in tests");
};

function provider(options: Partial<OpenAiProviderOptions> = {}) {
  return createOpenAiProvider({ apiKey: TEST_OPENAI_KEY, settings: defaultSettings(), fetch: noFetch, openSocket: noNetworkSocket, ...options });
}

function callArgs(overrides: Partial<CreateCallArgs> = {}): CreateCallArgs {
  const settings = defaultSettings();
  return {
    tenantId: "demo-umzug",
    sessionId: "AAAAAAAAAAAAAAAAAAAAAA",
    locale: "de",
    session: buildOpenAiSession({ settings, instructions: INSTRUCTIONS, tools: [], locale: "de", locales: ["de"], transport: "webrtc" }),
    offerSdp: OFFER,
    ...overrides,
  };
}

async function createWith(answer: FakeAnswer | FakeAnswer[], args: Partial<CreateCallArgs> = {}): Promise<CreateCallResult> {
  const fake = fakeOpenAiFetch({ create: answer });
  return provider({ fetch: fake.fetch }).createCall(callArgs(args));
}

/** Resolves after the pending socket events and timers of a few turns. */
function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createCall", () => {
  it("creates a call with two plain string fields and the key only in the Authorization header", async () => {
    const fake = fakeOpenAiFetch({ create: answers.created(TEST_CALL_ID) });
    const args = callArgs();
    const result = await provider({ fetch: fake.fetch }).createCall(args);
    assert.equal(result.ok, true);

    assert.equal(fake.requests.length, 1);
    const [request] = fake.requests;
    assert.equal(request.url, "https://api.openai.com/v1/realtime/calls");
    assert.equal(request.method, "POST");
    assert.deepEqual(request.form, { sdp: OFFER, session: JSON.stringify(args.session) });
    assert.equal(request.headers.authorization, `Bearer ${TEST_OPENAI_KEY}`);
    // fetch sets the multipart Content-Type itself; no other header is ours.
    assert.deepEqual(Object.keys(request.headers), ["authorization"]);
    assert.ok(!request.url.includes(TEST_OPENAI_KEY));
    assert.ok(!JSON.stringify(request.form).includes(TEST_OPENAI_KEY));
    assert.ok(request.signal !== null);
  });

  it("uses the host of the settings", async () => {
    const fake = fakeOpenAiFetch({ create: answers.created(TEST_CALL_ID), hangup: answers.ok() });
    const eu = createOpenAiProvider({
      apiKey: TEST_OPENAI_KEY,
      settings: defaultSettings({ host: "eu.api.openai.com" }),
      fetch: fake.fetch,
      openSocket: noNetworkSocket,
    });
    await eu.createCall(callArgs());
    await eu.hangUp(TEST_CALL_ID, { timeoutMs: 1000 });
    assert.deepEqual(
      fake.requests.map((request) => request.url),
      ["https://eu.api.openai.com/v1/realtime/calls", `https://eu.api.openai.com/v1/realtime/calls/${TEST_CALL_ID}/hangup`],
    );
  });

  it("reads the call id from the Location header and the answer from the body", async () => {
    const result = await createWith(answers.created(TEST_CALL_ID));
    assert.deepEqual(result, { ok: true, callId: TEST_CALL_ID, answerSdp: FAKE_ANSWER_SDP });

    const absolute = await createWith({
      status: 201,
      body: FAKE_ANSWER_SDP,
      headers: { location: `https://api.openai.com/v1/realtime/calls/${TEST_CALL_ID}?x=1` },
    });
    assert.deepEqual(absolute, { ok: true, callId: TEST_CALL_ID, answerSdp: FAKE_ANSWER_SDP });
  });

  it("accepts a call id with a dash", async () => {
    const dashed = "rtc_u0_TEST-0000000000000000000000000002";
    assert.deepEqual(await createWith(answers.created(dashed)), { ok: true, callId: dashed, answerSdp: FAKE_ANSWER_SDP });
  });

  it("refuses a 201 without a valid call id or SDP as upstream", async () => {
    assert.deepEqual(await createWith({ status: 201, body: FAKE_ANSWER_SDP }), { ok: false, code: "upstream", httpStatus: 201 });
    assert.deepEqual(await createWith({ status: 201, body: FAKE_ANSWER_SDP, headers: { location: "/v1/realtime/calls/rtc_x" } }), {
      ok: false,
      code: "upstream",
      httpStatus: 201,
    });
    assert.deepEqual(
      await createWith({ status: 201, body: FAKE_ANSWER_SDP, headers: { location: "/v1/realtime/calls/sess_TEST0000000001" } }),
      { ok: false, code: "upstream", httpStatus: 201 },
    );
    assert.deepEqual(await createWith(answers.created(TEST_CALL_ID, "<html>not sdp</html>")), {
      ok: false,
      code: "upstream",
      httpStatus: 201,
      callId: TEST_CALL_ID,
    });
    assert.deepEqual(await createWith(answers.created(TEST_CALL_ID, "")), {
      ok: false,
      code: "upstream",
      httpStatus: 201,
      callId: TEST_CALL_ID,
    });
  });

  it("maps invalid_offer to bad_request, other 400 and 5xx to upstream, 401 to unavailable, 429 to busy with retryAfter", async () => {
    assert.deepEqual(await createWith(answers.error(400, "invalid_offer")), { ok: false, code: "bad_request", httpStatus: 400 });
    // Another refusal of the request names the provider's error code (for the call_open line).
    assert.deepEqual(await createWith(answers.error(400, "unknown_parameter")), {
      ok: false,
      code: "upstream",
      httpStatus: 400,
      providerCode: "unknown_parameter",
    });
    assert.deepEqual(await createWith({ status: 400, body: "not json" }), { ok: false, code: "upstream", httpStatus: 400 });
    for (const status of [500, 502, 503, 504]) {
      assert.deepEqual(await createWith(answers.error(status, "server_error")), { ok: false, code: "upstream", httpStatus: status });
    }
    assert.deepEqual(await createWith(answers.error(404, "not_found")), { ok: false, code: "upstream", httpStatus: 404, providerCode: "not_found" });
    assert.deepEqual(await createWith(answers.error(422, "invalid_offer")), { ok: false, code: "upstream", httpStatus: 422, providerCode: "invalid_offer" });
    // A code that does not look like one is not passed on.
    assert.deepEqual(await createWith(answers.error(400, "spaces and <html>")), { ok: false, code: "upstream", httpStatus: 400 });
    assert.deepEqual(await createWith(answers.error(400, "x".repeat(65))), { ok: false, code: "upstream", httpStatus: 400 });
    for (const status of [401, 403]) {
      assert.deepEqual(await createWith(answers.error(status, "invalid_api_key")), { ok: false, code: "unavailable", httpStatus: status });
    }
    const auth = logLines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.warn === "provider_auth");
    assert.deepEqual(
      auth.map((line) => line.httpStatus),
      [401, 403],
    );
    assert.ok(auth.every((line) => line.dropped === undefined));

    assert.deepEqual(await createWith(answers.error(429, "rate_limit_exceeded", { headers: { "retry-after": "12" } })), {
      ok: false,
      code: "busy",
      retryAfter: 12,
      httpStatus: 429,
    });
    assert.deepEqual(await createWith(answers.error(429, "rate_limit_exceeded")), { ok: false, code: "busy", retryAfter: 30, httpStatus: 429 });
    for (const [header, expected] of [
      ["soon", 30],
      ["0", 30],
      ["-5", 30],
      ["9000", 300],
      ["1.2", 2],
    ] as const) {
      const result = await createWith(answers.error(429, "rate_limit_exceeded", { headers: { "retry-after": header } }));
      assert.equal(result.ok === false && result.retryAfter, expected, header);
    }
  });

  it("returns the call id of a failed create so it can be hung up", async () => {
    assert.deepEqual(await createWith(answers.error(400, "invalid_offer", { callId: TEST_CALL_ID })), {
      ok: false,
      code: "bad_request",
      httpStatus: 400,
      callId: TEST_CALL_ID,
    });
    assert.deepEqual(await createWith(answers.error(500, "server_error", { callId: TEST_CALL_ID })), {
      ok: false,
      code: "upstream",
      httpStatus: 500,
      callId: TEST_CALL_ID,
    });
    assert.deepEqual(await createWith(answers.error(429, null, { callId: TEST_CALL_ID })), {
      ok: false,
      code: "busy",
      retryAfter: 30,
      httpStatus: 429,
      callId: TEST_CALL_ID,
    });
  });

  it("turns an aborted or timed-out create into timeout", async () => {
    const controller = new AbortController();
    const pending = createWith("hang", { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    assert.deepEqual(await pending, { ok: false, code: "timeout" });

    // Already aborted: no request at all.
    const fake = fakeOpenAiFetch({ create: answers.created(TEST_CALL_ID) });
    const gone = new AbortController();
    gone.abort();
    assert.deepEqual(await provider({ fetch: fake.fetch }).createCall(callArgs({ signal: gone.signal })), { ok: false, code: "timeout" });
    assert.equal(fake.requests.length, 0);

    // An upstream that ignores the abort is cut all the same.
    const started = Date.now();
    assert.deepEqual(await createWith("hang_forever", { signal: AbortSignal.timeout(30) }), { ok: false, code: "timeout" });
    assert.ok(Date.now() - started < 2_000);

    // A network failure without an abort is the provider's.
    assert.deepEqual(await createWith("network_error"), { ok: false, code: "upstream" });
  });

  it("never puts the key, the offer or the session into a result or a log line", async () => {
    const fake = fakeOpenAiFetch({
      create: [
        answers.created(TEST_CALL_ID),
        answers.error(400, "invalid_offer"),
        answers.error(401, "invalid_api_key"),
        answers.error(429, null),
        answers.error(500, null, { callId: TEST_CALL_ID }),
        "network_error",
      ],
      hangup: [answers.error(500, null), "network_error"],
    });
    const openai = provider({ fetch: fake.fetch });
    const results: unknown[] = [];
    for (let i = 0; i < 6; i++) results.push(await openai.createCall(callArgs()));
    results.push(await openai.hangUp(TEST_CALL_ID, { timeoutMs: 500 }), await openai.hangUp(TEST_CALL_ID, { timeoutMs: 500 }));
    const factory = fakeWebSocketFactory();
    const control = provider({ openSocket: factory.openSocket });
    results.push(await control.openControl(TEST_CALL_ID, { timeoutMs: 20 }));

    const everything = JSON.stringify(results) + "\n" + logLines.join("\n");
    for (const secret of [TEST_OPENAI_KEY, "Secret rule 42", "offerpasswordplaceholder", "a=ice-pwd", "Bearer"]) {
      assert.ok(!everything.includes(secret), secret);
    }
    // The answer SDP of a successful call is the one thing that goes back.
    assert.equal((results[0] as { ok: boolean }).ok, true);
  });
});

describe("control socket", () => {
  it("opens the control socket with the call id and the Authorization header, and times out", async () => {
    const factory = fakeWebSocketFactory();
    const openai = provider({ openSocket: factory.openSocket });
    const pending = openai.openControl(TEST_CALL_ID, { timeoutMs: 1000 });
    const socket = factory.last();
    assert.equal(socket.url, `wss://api.openai.com/v1/realtime?call_id=${TEST_CALL_ID}`);
    assert.deepEqual(socket.headers, { Authorization: `Bearer ${TEST_OPENAI_KEY}` });
    socket.open();
    const result = await pending;
    assert.equal(result.ok, true);
    assert.ok(result.ok);

    // send() serialises while open and reports false otherwise.
    const event: ControlEvent = { type: "session.update", session: { type: "realtime" } };
    assert.equal(result.socket.send(event), true);
    assert.deepEqual(socket.sent, [JSON.stringify(event)]);

    // A socket that never opens is closed at the timeout.
    const slow = provider({ openSocket: factory.openSocket });
    const started = Date.now();
    assert.deepEqual(await slow.openControl(TEST_CALL_ID, { timeoutMs: 20 }), { ok: false, code: "timeout" });
    assert.ok(Date.now() - started < 2_000);
    assert.deepEqual(factory.last().closeCalls, [1000]);

    // The caller's signal ends the wait too.
    const controller = new AbortController();
    const waiting = provider({ openSocket: factory.openSocket }).openControl(TEST_CALL_ID, { timeoutMs: 5000, signal: controller.signal });
    controller.abort();
    assert.deepEqual(await waiting, { ok: false, code: "timeout" });
    assert.deepEqual(factory.last().closeCalls, [1000]);

    // An error or a close before "open" is the provider's.
    const failing = provider({ openSocket: factory.openSocket }).openControl(TEST_CALL_ID, { timeoutMs: 5000 });
    factory.last().fail();
    assert.deepEqual(await failing, { ok: false, code: "upstream" });
    const refused = provider({ openSocket: factory.openSocket }).openControl(TEST_CALL_ID, { timeoutMs: 5000 });
    factory.last().serverClose(1006);
    assert.deepEqual(await refused, { ok: false, code: "upstream" });

    // A call id that is not one opens nothing.
    const before = factory.sockets.length;
    assert.deepEqual(await openai.openControl("rtc_../../x", { timeoutMs: 100 }), { ok: false, code: "upstream" });
    assert.equal(factory.sockets.length, before);
  });

  it("reports no_websocket when the runtime has no WebSocket", async () => {
    const noSocket = socketOpenerFor(undefined);
    assert.deepEqual(await openOpenAiSocket("wss://api.openai.com/v1/realtime?call_id=x", TEST_OPENAI_KEY, { timeoutMs: 100, openSocket: noSocket }), {
      ok: false,
      code: "no_websocket",
    });
    assert.deepEqual(await provider({ openSocket: noSocket }).openControl(TEST_CALL_ID, { timeoutMs: 100 }), { ok: false, code: "no_websocket" });

    // With a constructor, the headers go in its second argument (as Node's WebSocket takes them).
    const seen: unknown[][] = [];
    class RecordingSocket {
      readyState = 0;
      constructor(...args: unknown[]) {
        seen.push(args);
      }
      send(): void {}
      close(): void {}
      addEventListener(): void {}
    }
    const opened = socketOpenerFor(RecordingSocket)("wss://example.test/x", { Authorization: "Bearer placeholder" });
    assert.ok(opened instanceof RecordingSocket);
    assert.deepEqual(seen, [["wss://example.test/x", { headers: { Authorization: "Bearer placeholder" } }]]);

    // An opener that throws is an upstream failure, not an exception.
    const throwing = () => {
      throw new Error(`refused ${TEST_OPENAI_KEY}`);
    };
    assert.deepEqual(await openOpenAiSocket("wss://x.test", TEST_OPENAI_KEY, { timeoutMs: 100, openSocket: throwing }), {
      ok: false,
      code: "upstream",
    });
  });

  it("drops oversized or non-JSON frames and reports the close once", async () => {
    const factory = fakeWebSocketFactory();
    const pending = provider({ openSocket: factory.openSocket }).openControl(TEST_CALL_ID, { timeoutMs: 1000 });
    const ws = factory.last();
    ws.open();
    const result = await pending;
    assert.ok(result.ok);
    const control = result.socket;

    const events: ControlEvent[] = [];
    const closes: number[] = [];
    control.onEvent((event) => events.push(event));
    control.onEvent(() => {
      throw new Error("a listener that fails");
    });
    control.onClose((info) => closes.push(info.code));

    const good = { type: "session.updated", session: { type: "realtime" } };
    ws.receive(JSON.stringify(good));
    ws.receive("not json");
    ws.receive(JSON.stringify([good]));
    ws.receive(JSON.stringify({ kind: "no type" }));
    ws.receive(JSON.stringify({ type: 7 }));
    ws.receive(JSON.stringify("text"));
    ws.receive(JSON.stringify(null));
    ws.receive(new Uint8Array([123, 125]));
    ws.receive(undefined);
    const big = JSON.stringify({ type: "response.output_audio.delta", delta: "x".repeat(MAX_CONTROL_FRAME_CHARS) });
    assert.ok(big.length > MAX_CONTROL_FRAME_CHARS);
    ws.receive(big);
    const atLimit = { type: "edge", pad: "" };
    atLimit.pad = "x".repeat(MAX_CONTROL_FRAME_CHARS - JSON.stringify(atLimit).length);
    ws.receive(JSON.stringify(atLimit));
    assert.deepEqual(events, [good, atLimit]);

    // Our close is idempotent and does not wait; the far side's close is reported once.
    control.close();
    control.close(4000);
    assert.deepEqual(ws.closeCalls, [1000]);
    assert.equal(control.send({ type: "after.close" }), false);
    ws.serverClose(1006);
    ws.serverClose(1000);
    assert.deepEqual(closes, [1006]);

    // A listener added after the close still hears it, once.
    const late: number[] = [];
    control.onClose((info) => late.push(info.code));
    await tick();
    assert.deepEqual(late, [1006]);

    // A close without a code counts as 1006.
    const second = provider({ openSocket: factory.openSocket }).openControl(TEST_CALL_ID, { timeoutMs: 1000 });
    const ws2 = factory.last();
    ws2.open();
    const result2 = await second;
    assert.ok(result2.ok);
    const codes: number[] = [];
    result2.socket.onClose((info) => codes.push(info.code));
    ws2.serverClose();
    assert.deepEqual(codes, [1006]);
    assert.equal(result2.socket.send({ type: "x" }), false);
  });
});

describe("hangUp", () => {
  it("hangs up with 200 or 404 as done, gives up after its timeout, never throws", async () => {
    const fake = fakeOpenAiFetch({
      hangup: [answers.ok(200), answers.error(404, "call_id_not_found"), answers.error(500, null), "network_error"],
    });
    const openai = provider({ fetch: fake.fetch });
    assert.deepEqual(await openai.hangUp(TEST_CALL_ID, { timeoutMs: 1000 }), { ok: true });
    assert.deepEqual(await openai.hangUp(TEST_CALL_ID, { timeoutMs: 1000 }), { ok: true });
    assert.deepEqual(await openai.hangUp(TEST_CALL_ID, { timeoutMs: 1000 }), { ok: false, httpStatus: 500 });
    assert.deepEqual(await openai.hangUp(TEST_CALL_ID, { timeoutMs: 1000 }), { ok: false });

    const [request] = fake.of("hangup");
    assert.equal(request.url, `https://api.openai.com/v1/realtime/calls/${TEST_CALL_ID}/hangup`);
    assert.equal(request.method, "POST");
    assert.equal(request.form, null);
    assert.deepEqual(request.headers, { authorization: `Bearer ${TEST_OPENAI_KEY}` });

    // Gives up after its timeout, whether or not the upstream honours the abort.
    for (const answer of ["hang", "hang_forever"] as const) {
      const slow = provider({ fetch: fakeOpenAiFetch({ hangup: answer }).fetch });
      const started = Date.now();
      assert.deepEqual(await slow.hangUp(TEST_CALL_ID, { timeoutMs: 30 }), { ok: false }, answer);
      assert.ok(Date.now() - started < 2_000);
    }

    // Not a call id: nothing to hang up, no request.
    const none = fakeOpenAiFetch({ hangup: answers.ok() });
    const quiet = provider({ fetch: none.fetch });
    for (const id of ["", "sess_123456", "rtc_short", "rtc_u0_TEST/../../v1/x", `${TEST_CALL_ID}?x=1`]) {
      assert.deepEqual(await quiet.hangUp(id, { timeoutMs: 100 }), { ok: true }, id);
    }
    assert.equal(none.requests.length, 0);

    // A fetch that throws synchronously, or a nonsense timeout, still answers.
    const broken = provider({
      fetch: (() => {
        throw new Error("boom");
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(await broken.hangUp(TEST_CALL_ID, { timeoutMs: Number.NaN }), { ok: false });
    assert.deepEqual(await broken.createCall(callArgs()), { ok: false, code: "upstream" });
  });
});

describe("getVoiceProvider", () => {
  function env(overrides: Partial<VoiceEnv>): VoiceEnv {
    return { provider: "openai", providerApiKey: TEST_OPENAI_KEY, openai: defaultSettings(), ...overrides } as VoiceEnv;
  }

  it("getVoiceProvider returns the openai provider with a key, null without one, and rebuilds it after a settings change", () => {
    const first = getVoiceProvider(env({}));
    assert.ok(first !== null && isCallProvider(first));
    assert.equal(first.id, "openai");
    assert.equal(first.kind, "call");
    assert.equal(first.confirmsCalls, true);
    assert.ok(!JSON.stringify(first).includes(TEST_OPENAI_KEY));

    // Same key and settings (a fresh but equal object): the same instance.
    assert.equal(getVoiceProvider(env({})), first);
    // Another setting or another key: a new one.
    const eu = getVoiceProvider(env({ openai: defaultSettings({ host: "eu.api.openai.com" }) }));
    assert.ok(eu !== null && eu !== first);
    const rekeyed = getVoiceProvider(env({ openai: defaultSettings({ host: "eu.api.openai.com" }), providerApiKey: "test-key-not-real-2" }));
    assert.ok(rekeyed !== null && rekeyed !== eu);

    assert.equal(getVoiceProvider(env({ providerApiKey: null })), null);
    assert.equal(getVoiceProvider(env({ provider: "none" })), null);
    assert.equal(getVoiceProvider(env({ provider: "acme" as VoiceEnv["provider"] })), null);
  });

  it("getRealtimeProvider is unchanged (mock only)", () => {
    // The mock is the same singleton as getVoiceProvider's, and getRealtimeProvider ignores openai.
    const mockProvider = getRealtimeProvider(env({ provider: "mock" }));
    assert.ok(mockProvider !== null && !isCallProvider(mockProvider));
    assert.equal(mockProvider.id, "mock");
    assert.equal(getVoiceProvider(env({ provider: "mock" })), mockProvider);
    assert.equal(getRealtimeProvider(env({})), null);
    assert.equal(getRealtimeProvider(env({ provider: "none" })), null);
  });
});
