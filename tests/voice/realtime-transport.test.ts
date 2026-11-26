// The realtime transport (components/voice/transports/realtime.ts) on fake browser objects
// (tests/voice/fakes/webrtc.ts), a fake fetch and node:test's mocked timers: no DOM, no
// microphone, no network. Its events are fed to the real voiceReducer as they arrive, the way
// the stage feeds them, so an event the reducer would drop shows up here.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, type TestContext } from "node:test";
import { isCallStreamEvent } from "@/components/voice/transports/http";
import {
  CLOSE_MAX_MS,
  CONNECT_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  HIDDEN_END_MS,
  MIC_HOLD_MAX_MS,
  MUTED_NOTICE_MS,
  createRealtimeTransport,
} from "@/components/voice/transports/realtime";
import { browserPlatform, createLevelMeter, isInAppBrowser, supportsRealtime } from "@/components/voice/transports/webrtc";
import type { VoiceTransport } from "@/components/voice/transports/types";
import {
  initVoiceState,
  silenceWarningVisible,
  voiceReducer,
  type VoiceEvent,
  type VoiceMachineState,
  type VoiceStatus,
  type VoiceTransportEvent,
} from "@/components/voice/voice-machine";
import type { CallStreamEvent, VoicePublicConfig } from "@/lib/voice/types";
import {
  callStream,
  FAKE_ANSWER_SDP,
  FAKE_OFFER_SDP,
  fakePlatform,
  FakeMediaStream,
  FakePeerConnection,
  FakeTrack,
} from "./fakes/webrtc";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const LIMITS = { maxCallSeconds: 180, warnBeforeEndSeconds: 20, silenceTimeoutSeconds: 10, maxTurnChars: 600 };
/** What the call stream's answer says: the server's own call length. */
const CALL_SECONDS = 240;
const START = Date.UTC(2026, 11, 2, 9);

const CONFIG: VoicePublicConfig = {
  tenant: "demo-test",
  kind: "demo",
  businessName: "Muster Test",
  sector: "hairdresser",
  locale: "de",
  locales: ["de", "it"],
  assistantName: { de: "der KI-Assistent von Muster Test" },
  greeting: { de: "Grüezi" },
  privacyUrl: { de: "/de/datenschutz" },
  limits: LIMITS,
  modes: ["realtime", "scripted"],
  endpoints: {
    session: "/api/voice/session",
    turn: "/api/voice/turn",
    end: "/api/voice/end",
    call: "/api/voice/call",
    ready: "/api/voice/ready",
  },
};

const CALL_GRANT = { connect: "call", provider: "openai", expiresAt: START + 30_000 };

function grant(realtime: Record<string, unknown> = CALL_GRANT, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    sessionToken: "token-1",
    mode: "realtime",
    locale: "de",
    expiresAt: START + 600_000,
    limits: LIMITS,
    realtime,
    ...overrides,
  };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

interface Request {
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  signal: AbortSignal | null;
  keepalive: boolean;
}

/**
 * Replaces fetch. The session is answered at once with `session` (or held until answerSession
 * with `holdSession`); the call endpoint answers with the test's event stream; the ready and end
 * endpoints with ok.
 */
function fakeServer(
  options: { session?: () => Response; holdSession?: boolean; call?: (init?: RequestInit) => Response | Promise<Response> } = {},
) {
  const requests: Request[] = [];
  const stream = callStream();
  let release: (response: Response) => void = () => undefined;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      signal: init?.signal ?? null,
      keepalive: init?.keepalive === true,
    });
    if (url === CONFIG.endpoints.session) {
      if (options.holdSession) return held;
      return options.session ? options.session() : json(grant());
    }
    if (url === CONFIG.endpoints.call) {
      if (options.call) return options.call(init);
      return new Response(stream.body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
    }
    return json({ ok: true });
  }) as typeof fetch;
  const to = (endpoint: string | undefined) => requests.filter((request) => request.url === endpoint);
  return {
    requests,
    stream,
    answerSession: (response: Response) => release(response),
    sessions: () => to(CONFIG.endpoints.session),
    calls: () => to(CONFIG.endpoints.call),
    readies: () => to(CONFIG.endpoints.ready).map((request) => request.body),
    ends: () => to(CONFIG.endpoints.end).map((request) => request.body),
  };
}

type Server = ReturnType<typeof fakeServer>;

/** Lets the transport's promises run (fetch answers, body reads, stream decoding). */
async function settle(): Promise<void> {
  for (let round = 0; round < 30; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Mocks setTimeout, setInterval and Date for one test; returns advance(ms). */
function useClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: START });
  return async function advance(ms: number, step = 50): Promise<void> {
    for (let done = 0; done < ms; done += step) {
      t.mock.timers.tick(Math.min(step, ms - done));
      await settle();
    }
  };
}

function collect(transport: VoiceTransport): VoiceTransportEvent[] {
  const events: VoiceTransportEvent[] = [];
  transport.onEvent((event) => events.push(event));
  return events;
}

/**
 * The stage's reducer, fed every event as it arrives, starting where the consent click leaves
 * it (requesting_mic). `dropped` lists the events that did not change the state.
 */
function stageOf(transport: VoiceTransport) {
  let state: VoiceMachineState = [
    { type: "START", mode: "realtime" } as VoiceEvent,
    { type: "CONSENT", input: "voice" } as VoiceEvent,
  ].reduce(voiceReducer, initVoiceState({ locale: "de", locales: ["de", "it"], limits: LIMITS }));
  const statuses: VoiceStatus[] = [state.status];
  const dropped: VoiceTransportEvent[] = [];
  const apply = (event: VoiceEvent) => {
    const next = voiceReducer(state, event);
    if (next === state && event.type !== "TICK") dropped.push(event as VoiceTransportEvent);
    state = next;
    if (statuses[statuses.length - 1] !== state.status) statuses.push(state.status);
  };
  transport.onEvent(apply);
  return {
    get state() {
      return state;
    },
    statuses,
    dropped,
    dispatch: apply,
  };
}

function types(events: VoiceTransportEvent[]): string[] {
  return events.map((event) => event.type);
}

function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

function notices(events: VoiceTransportEvent[]) {
  return events.flatMap((event) => (event.type === "NOTICE" ? [event.notice] : []));
}

const answer: CallStreamEvent = { type: "answer", sdp: FAKE_ANSWER_SDP, maxSeconds: CALL_SECONDS };

/**
 * A call up to the given point: "session" (the call request is out), "answer" (applied, not yet
 * connected), "connected" (the remote audio plays and the peer is connected).
 */
async function callUntil(
  until: "session" | "answer" | "connected",
  options: { platform?: Parameters<typeof fakePlatform>[0]; blocked?: boolean; server?: Server } = {},
) {
  const fake = fakePlatform(options.platform);
  const server = options.server ?? fakeServer();
  const transport = createRealtimeTransport({ config: CONFIG, locale: "de", page: "/de/test" }, fake.platform);
  const events = collect(transport);
  const stage = stageOf(transport);
  transport.start();
  if (fake.audios[0]) fake.audios[0].blocked = options.blocked === true;
  await settle();
  if (until !== "session") {
    server.stream.push(answer);
    await settle();
  }
  if (until === "connected") {
    fake.peers[0].fireTrack(fake.remote);
    await settle();
    fake.peers[0].setState("connected");
    await settle();
  }
  return { fake, server, transport, events, stage, peer: fake.peers[0], audio: fake.audios[0], track: fake.media.track };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network in tests");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------------------------
// Before the call
// ---------------------------------------------------------------------------------------------

describe("realtime transport: before the call", () => {
  it("asks for the microphone before any session, and fails as unsupported without WebRTC", async (t) => {
    useClock(t);
    const fake = fakePlatform();
    const server = fakeServer();
    const transport = createRealtimeTransport({ config: CONFIG, locale: "de", page: "/de/test" }, fake.platform);
    const events = collect(transport);
    transport.start();
    assert.equal(fake.media.requests.length, 1, "the microphone is asked for inside the click");
    assert.deepEqual(fake.media.requests[0], {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    assert.equal(server.requests.length, 0, "no session before the microphone");
    assert.equal(fake.contexts[0].resumeCalls, 1, "the audio context is unlocked in the gesture");
    assert.equal(fake.audios[0].autoplay, true);
    await settle();
    assert.deepEqual(types(events).slice(0, 1), ["MIC_GRANTED"]);
    assert.deepEqual(server.sessions()[0].body, { tenant: "demo-test", locale: "de", mode: "realtime", page: "/de/test", hp: "" });
    assert.equal(server.sessions()[0].signal?.aborted, false);
    transport.stop("user");

    const bare = fakePlatform({ without: ["createPeerConnection"] });
    assert.equal(supportsRealtime(bare.platform), false);
    const unsupported = createRealtimeTransport({ config: CONFIG, locale: "de" }, bare.platform);
    const failed = collect(unsupported);
    unsupported.start();
    await settle();
    assert.deepEqual(failed, [{ type: "FAIL", code: "unsupported" }]);
    assert.equal(bare.media.requests.length, 0, "no microphone prompt for a call that cannot be made");
    unsupported.stop("error");
    assert.equal(server.ends().length, 1, "only the first transport held a session");
  });

  it("names an in-app browser instead of unsupported or a refused microphone", async (t) => {
    useClock(t);
    fakeServer();
    assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148 Instagram 300.0"), true);
    assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) AppleWebKit [FBAN/FBIOS;FBAV/450.0]"), true);
    assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/131 Mobile"), true);
    assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Line/14.0"), true);
    assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"), false);
    assert.equal(isInAppBrowser(undefined), false);

    const app = "Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148 Instagram 300.0";
    const noRtc = fakePlatform({ userAgent: app, without: ["createPeerConnection"] });
    const first = createRealtimeTransport({ config: CONFIG, locale: "de" }, noRtc.platform);
    const firstEvents = collect(first);
    first.start();
    assert.deepEqual(firstEvents, [{ type: "FAIL", code: "in_app_browser" }]);

    for (const deny of ["NotAllowedError", "NotFoundError"]) {
      const refused = fakePlatform({ userAgent: app, deny });
      const transport = createRealtimeTransport({ config: CONFIG, locale: "de" }, refused.platform);
      const events = collect(transport);
      transport.start();
      await settle();
      assert.deepEqual(events, [{ type: "MIC_FAILED", code: "in_app_browser" }], deny);
    }
  });

  it("reports a refused or missing microphone and opens no session", async (t) => {
    useClock(t);
    const server = fakeServer();
    for (const [deny, code] of [
      ["NotAllowedError", "mic_denied"],
      ["SecurityError", "mic_denied"],
      ["NotFoundError", "mic_unavailable"],
      ["NotReadableError", "mic_unavailable"],
    ] as const) {
      const fake = fakePlatform({ deny });
      const transport = createRealtimeTransport({ config: CONFIG, locale: "de" }, fake.platform);
      const stage = stageOf(transport);
      const events = collect(transport);
      transport.start();
      await settle();
      assert.deepEqual(events, [{ type: "MIC_FAILED", code }], deny);
      assert.equal(stage.state.status, "error");
      assert.equal(stage.state.errorCode, code);
      assert.equal(fake.contexts[0].closeCount, 1, "the audio context is released");
      transport.stop("error");
    }
    assert.equal(server.requests.length, 0, "no session, no end report");
  });

  it("hands back a session the server admits after the visitor stopped (sicurezza F8)", async (t) => {
    useClock(t);
    const server = fakeServer({ holdSession: true });
    const fake = fakePlatform();
    const transport = createRealtimeTransport({ config: CONFIG, locale: "de" }, fake.platform);
    const events = collect(transport);
    transport.start();
    await settle();
    assert.equal(server.sessions().length, 1);
    transport.stop("user");
    assert.equal(server.sessions()[0].signal?.aborted, false, "stopping does not cut the request: its answer is needed");
    assert.equal(fake.media.track.stopCount, 1, "the microphone is released at once");
    server.answerSession(json(grant()));
    await settle();
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
    assert.equal(server.calls().length, 0, "no call for a stopped transport");
    assert.deepEqual(types(events), ["MIC_GRANTED"], "nothing reaches the widget after stop");

    // Stopped while the microphone prompt is still open: the late stream is closed, nothing is asked.
    const slow = fakePlatform({ holdMic: true });
    const late = createRealtimeTransport({ config: CONFIG, locale: "de" }, slow.platform);
    late.start();
    late.stop("user");
    slow.media.release();
    await settle();
    assert.equal(slow.media.track.stopCount, 1);
    assert.equal(server.sessions().length, 1);
  });

  it("keeps today's behaviour for a token grant: not available yet, session handed back once", async (t) => {
    useClock(t);
    const server = fakeServer({
      session: () => json(grant({ provider: "mock", token: "mock-token", expiresAt: START + 60_000 })),
    });
    const fake = fakePlatform();
    const transport = createRealtimeTransport({ config: CONFIG, locale: "de" }, fake.platform);
    const events = collect(transport);
    transport.start();
    await settle();
    assert.deepEqual(types(events), ["MIC_GRANTED", "FAIL"]);
    assert.deepEqual(last(events), { type: "FAIL", code: "not_available_yet", retryAfter: null });
    assert.equal(fake.peers.length, 0, "no peer connection for a grant it cannot use");
    assert.equal(fake.media.track.stopCount, 1, "the microphone is released");
    transport.stop("error");
    transport.stop("error");
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "error" }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------------------------

describe("realtime transport: connecting", () => {
  it("sends an audio-only offer without a data channel to the call endpoint", async (t) => {
    useClock(t);
    const { server, peer, track, transport } = await callUntil("session");
    assert.equal(server.calls().length, 1);
    const call = server.calls()[0];
    assert.deepEqual(call.body, { sessionToken: "token-1", sdp: FAKE_OFFER_SDP });
    assert.equal(call.headers.Accept, "text/event-stream");
    assert.equal(peer.added.length, 1);
    assert.equal(peer.added[0].track, track, "the microphone track, nothing else");
    assert.equal(peer.dataChannels, 0, "no data channel");
    const media = FAKE_OFFER_SDP.split("\r\n").filter((line) => line.startsWith("m="));
    assert.deepEqual(media.map((line) => line.split(" ")[0]), ["m=audio"]);
    transport.stop("user");
  });

  it("applies the answer, emits CONNECTED with the server's call length and then THINKING", async (t) => {
    useClock(t);
    const { peer, events, stage, transport } = await callUntil("answer");
    assert.deepEqual(peer.remoteDescription, { type: "answer", sdp: FAKE_ANSWER_SDP });
    assert.equal(events.some((event) => event.type === "CONNECTED"), false, "not before the peer is connected");
    peer.setState("connected");
    await settle();
    const connectedAt = events.findIndex((event) => event.type === "CONNECTED");
    assert.deepEqual(events[connectedAt], { type: "CONNECTED", limits: { ...LIMITS, maxCallSeconds: CALL_SECONDS } });
    assert.deepEqual(events[connectedAt + 1], { type: "THINKING" });
    assert.equal(stage.state.status, "thinking");
    assert.equal(stage.state.secondsLeft, CALL_SECONDS);
    assert.deepEqual(stage.dropped, []);
    // A browser without connectionState: the ICE state counts.
    transport.stop("user");
    const ice = await callUntil("answer", { platform: { noConnectionState: true } });
    ice.peer.setIceState("checking");
    ice.peer.setIceState("completed");
    await settle();
    assert.equal(ice.stage.state.status, "thinking");
    ice.transport.stop("user");
  });

  it("holds the microphone until the greeting speaks, or six seconds at most", async (t) => {
    const advance = useClock(t);
    const first = await callUntil("answer");
    assert.equal(first.track.enabled, false, "held from the moment it is granted");
    first.peer.setState("connected");
    await settle();
    assert.equal(first.track.enabled, false, "connected, the greeting not yet heard");
    first.server.stream.push({ type: "status", status: "speaking" });
    await settle();
    assert.equal(first.track.enabled, true, "the greeting speaks: the caller may answer");
    first.transport.stop("user");

    // A greeting the visitor cannot hear yet (sent before the connection) does not open it before
    // the connection; once connected it does, at once.
    const early = await callUntil("answer");
    early.server.stream.push({ type: "status", status: "speaking" });
    await settle();
    assert.equal(early.track.enabled, false);
    early.peer.setState("connected");
    await settle();
    assert.equal(early.track.enabled, true, "connected while the greeting speaks: released at once");
    early.transport.stop("user");

    const second = await callUntil("connected");
    second.transport.setMuted(true); // during the hold: stored, applied at the release
    await advance(MIC_HOLD_MAX_MS - 100);
    assert.equal(second.track.enabled, false);
    await advance(200);
    assert.equal(second.track.enabled, false, "released, but the visitor muted it");
    second.transport.setMuted(false);
    assert.equal(second.track.enabled, true);
    second.transport.stop("user");
  });

  it("sends ready once, only when connected and playing", async (t) => {
    useClock(t);
    const playing = await callUntil("answer");
    playing.peer.fireTrack(playing.fake.remote);
    await settle();
    assert.equal(playing.audio.srcObject, playing.fake.remote);
    assert.deepEqual(playing.server.readies(), [], "playing, not connected yet");
    playing.peer.setState("connected");
    await settle();
    assert.deepEqual(playing.server.readies(), [{ sessionToken: "token-1" }]);
    const ready = playing.server.requests.find((request) => request.url === CONFIG.endpoints.ready);
    assert.equal(ready?.keepalive, true);
    playing.peer.setState("disconnected");
    playing.peer.setState("connected");
    playing.transport.resumeAudio?.();
    await settle();
    assert.equal(playing.server.readies().length, 1, "once");
    playing.transport.stop("user");

    const blocked = await callUntil("connected", { blocked: true });
    assert.deepEqual(blocked.server.readies(), [], "connected, but the browser refused to play");
    blocked.audio.blocked = false;
    blocked.transport.resumeAudio?.();
    await settle();
    assert.deepEqual(blocked.server.readies(), [{ sessionToken: "token-1" }]);
    blocked.transport.stop("user");
  });
});

// ---------------------------------------------------------------------------------------------
// The conversation, as the widget's reducer sees it
// ---------------------------------------------------------------------------------------------

describe("realtime transport: the conversation", () => {
  it("emits the reducer-legal sequence of a whole call (checked by feeding voiceReducer)", async (t) => {
    const advance = useClock(t);
    const { server, stage, transport } = await callUntil("connected");
    const frames: CallStreamEvent[] = [
      { type: "status", status: "speaking" }, // the greeting
      { type: "caption", id: "a-1", role: "assistant", text: "Grüezi, hier ist", final: false },
      { type: "caption", id: "a-1", role: "assistant", text: "Grüezi, hier ist der KI-Assistent.", final: true },
      { type: "status", status: "listening" },
      { type: "activity", speech: "started" },
    ];
    for (const frame of frames) server.stream.push(frame);
    await settle();
    await advance(1_000);
    for (const frame of [
      { type: "activity", speech: "stopped" },
      { type: "status", status: "thinking" },
      { type: "status", status: "speaking" },
      { type: "caption", id: "a-2", role: "assistant", text: "Gerne, ich", final: false },
      // The caller's words, transcribed after the reply had started: placed above it.
      { type: "caption", id: "c-1", role: "caller", text: "Ich möchte einen Termin.", final: true, before: "a-2" },
      // The commentary stops while its tool runs: thinking, not listening.
      { type: "status", status: "thinking" },
      { type: "tool", name: "check_availability", status: "started" },
      { type: "tool", name: "check_availability", status: "ok" },
      { type: "status", status: "speaking" },
      // Barge-in.
      { type: "interrupted" },
      { type: "activity", speech: "started" },
      { type: "status", status: "thinking" },
      { type: "status", status: "speaking" },
      { type: "ended", reason: "assistant" },
    ] as CallStreamEvent[]) {
      server.stream.push(frame);
    }
    await settle();
    assert.deepEqual(stage.statuses, [
      "requesting_mic",
      "connecting",
      "listening",
      "thinking",
      "speaking",
      "listening",
      "thinking",
      "speaking",
      "thinking",
      "speaking",
      "listening",
      "thinking",
      "speaking",
      "ended",
    ]);
    assert.equal(stage.state.endReason, "assistant");
    assert.deepEqual(stage.state.captions.map((caption) => caption.id), ["a-1", "c-1", "a-2"]);
    // Only repeated activity may leave the state as it was (the silence count was already 0).
    assert.deepEqual(stage.dropped.filter((event) => event.type !== "ACTIVITY"), []);
    transport.stop("assistant");
  });

  it("a 20 second caller turn never shows the silence warning (fed to voiceReducer)", async (t) => {
    const advance = useClock(t);
    const { server, stage, transport } = await callUntil("connected");
    server.stream.push({ type: "status", status: "speaking" });
    server.stream.push({ type: "status", status: "listening" });
    server.stream.push({ type: "activity", speech: "started" });
    await settle();
    for (let second = 0; second < 20; second += 1) {
      await advance(1_000, 100);
      stage.dispatch({ type: "TICK" }); // the stage's clock, once per second
      assert.equal(silenceWarningVisible(stage.state), false, `second ${second + 1}`);
      assert.equal(stage.state.status, "listening", `second ${second + 1}`);
    }
    server.stream.push({ type: "activity", speech: "stopped" });
    server.stream.push({ type: "status", status: "thinking" });
    await settle();
    assert.equal(stage.state.status, "thinking");
    transport.stop("user");
  });

  it("passes captions with their place and removals, tools, handoff and remaining through", async (t) => {
    useClock(t);
    const { server, events, stage, transport } = await callUntil("connected");
    for (const frame of [
      { type: "status", status: "speaking" },
      { type: "caption", id: "a-1", role: "assistant", text: "Buongiorno.", final: true, locale: "it" },
      { type: "caption", id: "c-1", role: "caller", text: "Hallo", final: false, before: "a-1" },
      { type: "caption", id: "c-2", role: "caller", text: "äh", final: false },
      { type: "caption", id: "c-2", role: "caller", text: "", final: true },
      { type: "tool", name: "request_callback", status: "started" },
      { type: "tool", name: "request_callback", status: "ok" },
      { type: "handoff", handoff: { kind: "callback" } },
      { type: "remaining", seconds: 30 },
      { type: "remaining", seconds: 100 },
    ] as CallStreamEvent[]) {
      server.stream.push(frame);
    }
    await settle();
    const captions = events.filter((event) => event.type === "CAPTION");
    assert.deepEqual(captions[0], {
      type: "CAPTION",
      caption: { id: "a-1", role: "assistant", text: "Buongiorno.", final: true, locale: "it" },
    });
    assert.deepEqual(captions[1], {
      type: "CAPTION",
      caption: { id: "c-1", role: "caller", text: "Hallo", final: false, locale: "de" },
      before: "a-1",
    });
    assert.deepEqual(stage.state.captions.map((caption) => caption.id), ["c-1", "a-1"], "placed above, c-2 removed");
    assert.deepEqual(
      events.filter((event) => event.type === "TOOL"),
      [
        { type: "TOOL", name: "request_callback", status: "started" },
        { type: "TOOL", name: "request_callback", status: "ok" },
      ],
    );
    assert.deepEqual(stage.state.handoff, { kind: "callback" });
    assert.deepEqual(
      events.filter((event) => event.type === "REMAINING"),
      [
        { type: "REMAINING", seconds: 30 },
        { type: "REMAINING", seconds: 100 },
      ],
    );
    assert.equal(stage.state.secondsLeft, 30, "the lower count wins");
    transport.stop("user");
  });

  it("decodes only the call stream's own frames", () => {
    assert.equal(isCallStreamEvent(answer), true);
    assert.equal(isCallStreamEvent({ type: "answer", sdp: "x".repeat(20_001), maxSeconds: 10 }), false);
    assert.equal(isCallStreamEvent({ type: "answer", sdp: "v=0", maxSeconds: 0 }), false);
    assert.equal(isCallStreamEvent({ type: "status", status: "dreaming" }), false);
    assert.equal(isCallStreamEvent({ type: "activity", speech: "started" }), true);
    assert.equal(isCallStreamEvent({ type: "caption", id: "item_123", role: "caller", text: "x", final: true }), false);
    assert.equal(isCallStreamEvent({ type: "caption", id: "c-1", role: "caller", text: "x", final: true, before: "a-1" }), true);
    assert.equal(isCallStreamEvent({ type: "caption", id: "c-1", role: "caller", text: "x", final: true, locale: "xx" }), false);
    assert.equal(isCallStreamEvent({ type: "tool", name: "rm_rf", status: "ok" }), false);
    assert.equal(isCallStreamEvent({ type: "remaining", seconds: -1 }), false);
    assert.equal(isCallStreamEvent({ type: "ended", reason: "assistant" }), true);
    assert.equal(isCallStreamEvent({ type: "ended", reason: "complete" }), false);
    assert.equal(isCallStreamEvent({ type: "error", code: "teapot" }), false);
    assert.equal(isCallStreamEvent({ type: "done", ended: true, remainingTurns: 0, remainingSeconds: 0 }), false);
  });
});

// ---------------------------------------------------------------------------------------------
// The end, failures and notices
// ---------------------------------------------------------------------------------------------

describe("realtime transport: the end and what can go wrong", () => {
  it("ends with the server's reason after the goodbye and closes the peer connection once the audio is quiet, at most 1.5 s later", async (t) => {
    const advance = useClock(t);
    const quiet = await callUntil("connected");
    const context = quiet.fake.contexts[0];
    quiet.server.stream.push({ type: "status", status: "speaking" });
    await settle();
    context.setLevel(quiet.fake.remote, 0.3); // the goodbye is still playing
    quiet.server.stream.push({ type: "ended", reason: "assistant" });
    await settle();
    assert.deepEqual(last(quiet.events), { type: "END", reason: "assistant" });
    assert.equal(quiet.track.enabled, false, "the microphone goes quiet at once");
    assert.equal(quiet.peer.closeCount, 0, "the goodbye plays on");
    quiet.transport.stop("assistant"); // what the stage does on END
    assert.deepEqual(quiet.server.ends(), [{ sessionToken: "token-1", reason: "assistant" }]);
    await advance(600);
    assert.equal(quiet.peer.closeCount, 0);
    context.setLevel(quiet.fake.remote, 0);
    await advance(400);
    assert.equal(quiet.peer.closeCount, 1, "closed once the audio was quiet");
    assert.equal(quiet.audio.paused, true);
    assert.equal(quiet.track.stopCount, 1);
    assert.equal(context.closeCount, 1);

    const loud = await callUntil("connected");
    loud.fake.contexts[0].setLevel(loud.fake.remote, 0.3);
    loud.server.stream.push({ type: "ended", reason: "limit" });
    await settle();
    assert.deepEqual(last(loud.events), { type: "END", reason: "limit" });
    await advance(CLOSE_MAX_MS - 100);
    assert.equal(loud.peer.closeCount, 0);
    await advance(150);
    assert.equal(loud.peer.closeCount, 1, "never later than CLOSE_MAX_MS");
    loud.transport.stop("limit");
    assert.deepEqual(loud.server.ends(), [{ sessionToken: "token-1", reason: "assistant" }]);

    const timeout = await callUntil("connected");
    timeout.server.stream.push({ type: "ended", reason: "timeout" });
    await settle();
    assert.deepEqual(last(timeout.events), { type: "END", reason: "timeout" });
    assert.equal(timeout.peer.closeCount, 1, "every other end closes at once");
    timeout.transport.stop("timeout");
  });

  it("fails with connection_failed when the peer never connects, and connection_lost when it drops", async (t) => {
    const advance = useClock(t);
    const never = await callUntil("answer");
    await advance(CONNECT_TIMEOUT_MS - 100, 500);
    assert.equal(never.events.some((event) => event.type === "FAIL"), false);
    await advance(200);
    assert.deepEqual(last(never.events), { type: "FAIL", code: "connection_failed", retryAfter: null });
    assert.equal(never.peer.closeCount, 1);
    assert.equal(never.server.stream.cancelled(), true, "the call stream is let go");
    never.transport.stop("error");
    assert.deepEqual(never.server.ends(), [{ sessionToken: "token-1", reason: "error" }]);

    const refused = await callUntil("answer");
    refused.peer.setState("failed");
    await settle();
    assert.deepEqual(last(refused.events), { type: "FAIL", code: "connection_failed", retryAfter: null });
    refused.transport.stop("error");

    const badAnswer = fakeServer();
    const bad = await callUntil("session", { server: badAnswer });
    bad.peer.refuseAnswer = true;
    badAnswer.stream.push(answer);
    await settle();
    assert.deepEqual(last(bad.events), { type: "FAIL", code: "connection_failed", retryAfter: null });
    bad.transport.stop("error");

    const dropped = await callUntil("connected");
    dropped.peer.setState("failed");
    await settle();
    assert.deepEqual(last(dropped.events), { type: "FAIL", code: "connection_lost", retryAfter: null });
    assert.equal(dropped.stage.state.errorCode, "connection_lost");
    dropped.transport.stop("error");

    const faded = await callUntil("connected");
    faded.peer.setState("disconnected");
    await advance(DISCONNECT_GRACE_MS + 100, 500);
    assert.deepEqual(last(faded.events), { type: "FAIL", code: "connection_lost", retryAfter: null });
    faded.transport.stop("error");
  });

  it("shows connection_weak while disconnected and clears it when back", async (t) => {
    const advance = useClock(t);
    const { peer, events, stage, transport } = await callUntil("connected");
    peer.setState("disconnected");
    await settle();
    assert.equal(stage.state.notice, "connection_weak");
    await advance(DISCONNECT_GRACE_MS - 1_000, 500);
    peer.setState("connected");
    await settle();
    assert.equal(stage.state.notice, null);
    await advance(DISCONNECT_GRACE_MS, 500);
    assert.equal(events.some((event) => event.type === "FAIL"), false, "the grace timer was cleared");
    assert.deepEqual(notices(events), ["connection_weak", null]);
    assert.equal(events.filter((event) => event.type === "CONNECTED").length, 1, "connected once");
    transport.stop("user");
  });

  it("keeps audio_blocked above other notices and through a barge-in, until playback works", async (t) => {
    useClock(t);
    const { server, peer, audio, events, stage, transport } = await callUntil("connected", { blocked: true });
    assert.equal(stage.state.notice, "audio_blocked");
    peer.setState("disconnected");
    await settle();
    assert.deepEqual(notices(events), ["audio_blocked"], "a lower notice does not replace it");
    server.stream.push({ type: "status", status: "speaking" });
    server.stream.push({ type: "interrupted" });
    await settle();
    assert.equal(stage.state.status, "listening");
    assert.equal(stage.state.notice, "audio_blocked", "a barge-in does not remove its cause");
    audio.blocked = false;
    transport.resumeAudio?.();
    await settle();
    assert.equal(stage.state.notice, "connection_weak", "the next one still true shows");
    peer.setState("connected");
    await settle();
    assert.deepEqual(notices(events), ["audio_blocked", "connection_weak", null]);
    transport.stop("user");
  });

  it("resumes playback from the button and from any later gesture, then sends ready", async (t) => {
    useClock(t);
    const { fake, server, audio, transport } = await callUntil("connected", { blocked: true });
    const context = fake.contexts[0];
    assert.equal(fake.gestures.count(), 1, "any tap or key press on the page tries again");
    const before = audio.playCalls;
    fake.gestures.fire();
    await settle();
    assert.equal(audio.playCalls, before + 1);
    assert.equal(fake.gestures.count(), 1, "still blocked: the listener stays (no once)");
    transport.resumeAudio?.();
    await settle();
    assert.equal(audio.playCalls, before + 2, "the button tries too");
    assert.ok(context.resumeCalls >= 2, "the button resumes the audio context in its gesture");
    assert.deepEqual(server.readies(), []);
    audio.blocked = false;
    fake.gestures.fire();
    await settle();
    assert.equal(fake.gestures.count(), 0, "playing: the page listener is gone");
    assert.deepEqual(server.readies(), [{ sessionToken: "token-1" }]);
    transport.stop("user");
  });

  it("fails with mic_unavailable when the microphone track ends, and shows mic_paused while it is muted by the system", async (t) => {
    useClock(t);
    const { peer, track, events, stage, transport } = await callUntil("connected");
    track.fire("mute");
    await settle();
    assert.equal(stage.state.notice, "mic_paused");
    track.fire("unmute");
    await settle();
    assert.equal(stage.state.notice, null);
    track.fire("ended");
    await settle();
    assert.deepEqual(last(events), { type: "FAIL", code: "mic_unavailable", retryAfter: null });
    assert.equal(stage.state.errorCode, "mic_unavailable");
    assert.equal(peer.closeCount, 1);
    transport.stop("error");
  });

  it("ends with unload when the page comes back after a long hidden time with the microphone interrupted", async (t) => {
    const advance = useClock(t);
    const locked = await callUntil("connected");
    locked.fake.visibility.set(true);
    locked.track.fire("mute");
    await advance(HIDDEN_END_MS + 1_000, 1_000);
    locked.track.fire("unmute");
    locked.fake.visibility.set(false);
    await settle();
    assert.deepEqual(last(locked.events), { type: "END", reason: "unload" });
    assert.equal(locked.stage.state.endReason, "unload");
    locked.transport.stop("unload");
    assert.deepEqual(locked.server.ends(), [{ sessionToken: "token-1", reason: "unload" }]);

    // A desktop tab in the background keeps its microphone, and the call.
    const background = await callUntil("connected");
    background.fake.visibility.set(true);
    await advance(HIDDEN_END_MS + 1_000, 1_000);
    background.fake.visibility.set(false);
    await settle();
    assert.equal(background.events.some((event) => event.type === "END"), false);

    // A short interruption (a notification) keeps it too.
    background.fake.visibility.set(true);
    background.track.fire("mute");
    await advance(5_000, 1_000);
    background.track.fire("unmute");
    background.fake.visibility.set(false);
    await settle();
    assert.equal(background.events.some((event) => event.type === "END"), false);
    background.transport.stop("user");
  });

  it("shows mic_off_long after a minute muted", async (t) => {
    const advance = useClock(t);
    const { server, events, stage, transport } = await callUntil("connected");
    transport.setMuted(true);
    stage.dispatch({ type: "MUTE", muted: true });
    // The server's keep-alive every 15 s holds the stream open meanwhile.
    for (let waited = 0; waited < MUTED_NOTICE_MS - 1_000; waited += 15_000) {
      await advance(Math.min(15_000, MUTED_NOTICE_MS - 1_000 - waited), 1_000);
      server.stream.ping();
    }
    assert.equal(stage.state.notice, null);
    await advance(2_000, 1_000);
    assert.equal(events.some((event) => event.type === "FAIL"), false, "the stream stayed open");
    assert.equal(stage.state.notice, "mic_off_long");
    transport.setMuted(false);
    await settle();
    assert.equal(stage.state.notice, null);
    assert.deepEqual(notices(events), ["mic_off_long", null]);
    transport.stop("user");
  });

  it("fails with connection_lost when the stream ends without an end", async (t) => {
    useClock(t);
    const cut = await callUntil("connected");
    cut.server.stream.end();
    await settle();
    assert.deepEqual(last(cut.events), { type: "FAIL", code: "connection_lost", retryAfter: null });
    assert.equal(cut.peer.closeCount, 1);
    cut.transport.stop("error");

    const broken = await callUntil("connected");
    broken.server.stream.fail();
    await settle();
    assert.deepEqual(last(broken.events), { type: "FAIL", code: "connection_lost", retryAfter: null });
    broken.transport.stop("error");

    const early = await callUntil("session");
    early.server.stream.end();
    await settle();
    assert.deepEqual(last(early.events), { type: "FAIL", code: "upstream", retryAfter: null }, "before the answer");
    early.transport.stop("error");

    const refused = fakeServer({ call: () => json({ ok: false, error: "busy", retryAfter: 20 }, 503) });
    const busy = await callUntil("session", { server: refused });
    assert.deepEqual(last(busy.events), { type: "FAIL", code: "busy", retryAfter: 20 });
    busy.transport.stop("error");

    const errored = await callUntil("connected");
    errored.server.stream.push({ type: "error", code: "upstream" });
    await settle();
    assert.deepEqual(last(errored.events), { type: "FAIL", code: "upstream", retryAfter: null });
    assert.equal(errored.peer.closeCount, 1, "closed at once");
    errored.transport.stop("error");
  });

  it("mutes by disabling the microphone track", async (t) => {
    useClock(t);
    const { server, track, transport } = await callUntil("connected");
    server.stream.push({ type: "status", status: "speaking" });
    await settle();
    assert.equal(track.enabled, true);
    transport.setMuted(true);
    assert.equal(track.enabled, false);
    transport.setMuted(false);
    assert.equal(track.enabled, true);
    assert.equal(track.stopCount, 0, "muting never stops the track");
    transport.stop("user");
  });

  it("stops everything once and tells the end endpoint once", async (t) => {
    const advance = useClock(t);
    const { fake, server, peer, audio, track, events, transport } = await callUntil("connected");
    const count = events.length;
    transport.stop("user");
    transport.stop("user");
    assert.equal(peer.closeCount, 1);
    assert.equal(track.stopCount, 1);
    assert.equal(audio.paused, true);
    assert.equal(audio.srcObject, null);
    assert.equal(fake.contexts[0].closeCount, 1);
    assert.equal(fake.visibility.count(), 0);
    assert.equal(fake.gestures.count(), 0);
    await settle();
    assert.equal(server.stream.cancelled(), true, "the call request is aborted");
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
    // Nothing after stop: not from the peer, the track, the page or a timer.
    peer.setState("failed");
    track.fire("ended");
    fake.visibility.set(true);
    transport.setMuted(true);
    await advance(MUTED_NOTICE_MS + 1_000, 5_000);
    assert.equal(events.length, count);
    assert.equal(transport.getLevel(), 0);
    assert.deepEqual(server.ends().length, 1);
  });

  it("reads the level from the right meter, and never throws", async (t) => {
    const advance = useClock(t);
    const { fake, server, transport } = await callUntil("connected");
    const context = fake.contexts[0];
    const mic = fake.media.stream;
    context.setLevel(mic, 0.05);
    context.setLevel(fake.remote, 0.05);
    assert.equal(transport.getLevel(), 0, "thinking: nobody speaks");
    server.stream.push({ type: "status", status: "speaking" });
    await settle();
    const speaking = transport.getLevel();
    assert.ok(speaking > 0.1 && speaking < 0.4, `the remote meter: ${speaking}`);
    // The remote stream reads silent in Web Audio (some browsers): a pulse after a second.
    context.setLevel(fake.remote, 0);
    assert.equal(transport.getLevel(), 0);
    await advance(1_200);
    const pulse = transport.getLevel();
    assert.ok(pulse >= 0.1 && pulse <= 0.4, `the pulse: ${pulse}`);
    server.stream.push({ type: "status", status: "listening" });
    await settle();
    assert.ok(Math.abs(transport.getLevel() - speaking) < 1e-9, "listening: the microphone meter");
    transport.setMuted(true);
    assert.equal(transport.getLevel(), 0, "muted");
    transport.setMuted(false);
    // A meter that throws reads 0.
    for (const analyser of context.analysers) {
      analyser.getByteTimeDomainData = () => {
        throw new Error("detached");
      };
    }
    assert.equal(transport.getLevel(), 0);
    transport.stop("user");
    assert.equal(transport.getLevel(), 0, "stopped");
    assert.equal(createLevelMeter(null, new FakeMediaStream([new FakeTrack()]) as unknown as MediaStream).level(), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// The caller's turn, the moment of the connection, the close after the goodbye
// ---------------------------------------------------------------------------------------------

describe("realtime transport: the caller's turn and the connection", () => {
  it("counts no silence while the caller speaks through a barge-in, until the server hears them stop (fed to voiceReducer)", async (t) => {
    const advance = useClock(t);
    const { server, stage, transport } = await callUntil("connected");
    server.stream.push({ type: "status", status: "speaking" });
    await settle();
    // A barge-in: the caller starts, the reply is cut, the cancelled reply leaves "listening".
    server.stream.push({ type: "activity", speech: "started" });
    server.stream.push({ type: "interrupted" });
    server.stream.push({ type: "status", status: "listening" });
    await settle();
    for (let second = 1; second <= 25; second += 1) {
      await advance(1_000, 100);
      stage.dispatch({ type: "TICK" });
      assert.equal(silenceWarningVisible(stage.state), false, `second ${second}`);
      assert.equal(stage.state.status, "listening", `second ${second}`);
    }
    // The caller stops: from now on their silence counts again.
    server.stream.push({ type: "activity", speech: "stopped" });
    await settle();
    for (let second = 1; second <= LIMITS.silenceTimeoutSeconds; second += 1) {
      await advance(1_000, 100);
      stage.dispatch({ type: "TICK" });
    }
    assert.equal(stage.state.status, "ended");
    assert.equal(stage.state.endReason, "silence");
    transport.stop("silence");
  });

  it("at CONNECTED shows the last status the server sent, and a greeting already speaking opens the microphone", async (t) => {
    useClock(t);
    const afterConnected = (events: VoiceTransportEvent[]) => types(events.slice(events.findIndex((event) => event.type === "CONNECTED")));

    const speaking = await callUntil("answer");
    speaking.server.stream.push({ type: "status", status: "speaking" });
    await settle();
    speaking.peer.setState("connected");
    await settle();
    assert.deepEqual(afterConnected(speaking.events), ["CONNECTED", "SPEAKING"]);
    assert.equal(speaking.stage.state.status, "speaking");
    assert.equal(speaking.track.enabled, true, "the hold is released at once");
    speaking.transport.stop("user");

    const listening = await callUntil("answer");
    listening.server.stream.push({ type: "status", status: "speaking" });
    listening.server.stream.push({ type: "status", status: "listening" });
    await settle();
    listening.peer.setState("connected");
    await settle();
    assert.deepEqual(afterConnected(listening.events), ["CONNECTED"], "CONNECTED already means listening");
    assert.equal(listening.stage.state.status, "listening");
    listening.transport.stop("user");

    const none = await callUntil("answer");
    none.peer.setState("connected");
    await settle();
    assert.deepEqual(afterConnected(none.events), ["CONNECTED", "THINKING"], "no status yet: the server greets now");
    assert.equal(none.track.enabled, false);
    none.transport.stop("user");
  });

  it("keeps the server's count of the time left when it arrives before CONNECTED (fed to voiceReducer)", async (t) => {
    useClock(t);
    const { server, peer, stage, transport } = await callUntil("answer");
    server.stream.push({ type: "remaining", seconds: 200 });
    await settle();
    peer.setState("connected");
    await settle();
    assert.equal(stage.state.status, "thinking");
    assert.equal(stage.state.secondsLeft, 200);
    transport.stop("user");
  });

  it("tries playback again on the taps of a touch screen too, and removes every page listener", () => {
    const added: Array<{ type: string; capture: boolean }> = [];
    const removed: string[] = [];
    const handlers: Array<() => void> = [];
    const page = {
      addEventListener(type: string, handler: () => void, options?: { capture?: boolean }) {
        added.push({ type, capture: options?.capture === true });
        handlers.push(handler);
      },
      removeEventListener(type: string) {
        removed.push(type);
      },
    };
    const scope = globalThis as { window?: unknown };
    const hadWindow = "window" in scope;
    const previous = scope.window;
    scope.window = page;
    try {
      const platform = browserPlatform();
      let tries = 0;
      const unsubscribe = platform.addGestureListener?.(() => {
        tries += 1;
      });
      assert.ok(unsubscribe, "a page gives the gesture listener");
      assert.deepEqual(added.map((entry) => entry.type).sort(), ["keydown", "pointerdown", "pointerup", "touchend"]);
      assert.ok(added.every((entry) => entry.capture), "in the capture phase");
      for (const handler of handlers) handler();
      assert.equal(tries, 4);
      unsubscribe();
      assert.deepEqual(removed.sort(), ["keydown", "pointerdown", "pointerup", "touchend"]);
    } finally {
      if (hadWindow) scope.window = previous;
      else delete scope.window;
    }
  });
});

describe("realtime transport: the close after the goodbye", () => {
  it("waits the full CLOSE_MAX_MS without a remote meter", async (t) => {
    const advance = useClock(t);
    const { server, peer, transport } = await callUntil("connected", { platform: { without: ["createAudioContext"] } });
    server.stream.push({ type: "status", status: "speaking" });
    server.stream.push({ type: "ended", reason: "assistant" });
    await settle();
    await advance(CLOSE_MAX_MS - 100);
    assert.equal(peer.closeCount, 0, "no meter: its silence says nothing");
    await advance(150);
    assert.equal(peer.closeCount, 1);
    transport.stop("assistant");
    assert.equal(peer.closeCount, 1);
  });

  it("waits the full CLOSE_MAX_MS when the remote meter has never read above zero, and not when it has", async (t) => {
    const advance = useClock(t);
    const silent = await callUntil("connected");
    silent.server.stream.push({ type: "status", status: "speaking" });
    await settle();
    assert.equal(silent.transport.getLevel(), 0);
    silent.server.stream.push({ type: "ended", reason: "limit" });
    await settle();
    await advance(CLOSE_MAX_MS - 100);
    assert.equal(silent.peer.closeCount, 0, "a meter that never heard anything");
    await advance(150);
    assert.equal(silent.peer.closeCount, 1);
    silent.transport.stop("limit");

    // The meter heard the assistant earlier in the call: its quiet now is real.
    const heard = await callUntil("connected");
    heard.server.stream.push({ type: "status", status: "speaking" });
    await settle();
    heard.fake.contexts[0].setLevel(heard.fake.remote, 0.3);
    assert.ok(heard.transport.getLevel() > 0);
    heard.fake.contexts[0].setLevel(heard.fake.remote, 0);
    heard.server.stream.push({ type: "ended", reason: "assistant" });
    await settle();
    await advance(500);
    assert.equal(heard.peer.closeCount, 1, "closed once the audio was quiet");
    heard.transport.stop("assistant");
  });
});

// ---------------------------------------------------------------------------------------------
// stop() in every phase of the setup
// ---------------------------------------------------------------------------------------------

describe("realtime transport: stop() while the call is being set up", () => {
  it("during the offer: the peer connection closed once, the microphone stopped, no call request, the session handed back once", async (t) => {
    useClock(t);
    const server = fakeServer();
    const fake = fakePlatform();
    let releaseOffer: () => void = () => undefined;
    const create = fake.platform.createPeerConnection!;
    fake.platform.createPeerConnection = () => {
      const peer = create() as unknown as FakePeerConnection;
      const offer = peer.createOffer.bind(peer);
      peer.createOffer = () =>
        new Promise((resolve) => {
          releaseOffer = () => resolve(offer());
        });
      return peer as unknown as RTCPeerConnection;
    };
    const transport = createRealtimeTransport({ config: CONFIG, locale: "de" }, fake.platform);
    const events = collect(transport);
    transport.start();
    await settle();
    assert.equal(fake.peers.length, 1, "the offer is being made");
    transport.stop("user");
    transport.stop("user");
    releaseOffer();
    await settle();
    assert.equal(fake.peers[0].closeCount, 1);
    assert.equal(fake.peers[0].localDescription, null, "the late offer is not used");
    assert.equal(fake.media.track.stopCount, 1);
    assert.equal(server.calls().length, 0);
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
    assert.deepEqual(types(events), ["MIC_GRANTED"]);
  });

  it("while the call request waits for its headers: the request aborted, nothing emitted, the session handed back once", async (t) => {
    const advance = useClock(t);
    const waiting = fakeServer({
      call: (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });
    const { fake, events, peer, track, transport } = await callUntil("session", { server: waiting });
    assert.equal(waiting.calls().length, 1);
    assert.equal(waiting.calls()[0].signal?.aborted, false);
    transport.stop("user");
    await settle();
    assert.equal(waiting.calls()[0].signal?.aborted, true);
    assert.equal(peer.closeCount, 1);
    assert.equal(track.stopCount, 1);
    assert.equal(fake.contexts[0].closeCount, 1);
    await advance(CONNECT_TIMEOUT_MS + 100, 1_000);
    transport.stop("user");
    assert.deepEqual(waiting.ends(), [{ sessionToken: "token-1", reason: "user" }]);
    assert.deepEqual(types(events), ["MIC_GRANTED"]);
  });

  it("between the answer and the connection: closed once, and nothing from the peer or a timer after stop", async (t) => {
    const advance = useClock(t);
    const { server, events, peer, track, transport } = await callUntil("answer");
    const count = events.length;
    transport.stop("user");
    transport.stop("user");
    await settle();
    assert.equal(peer.closeCount, 1);
    assert.equal(track.stopCount, 1);
    assert.equal(server.stream.cancelled(), true, "the call stream is let go");
    peer.setState("connected");
    server.stream.push({ type: "status", status: "speaking" });
    await advance(CONNECT_TIMEOUT_MS + 100, 1_000);
    assert.equal(events.length, count, "no event after stop");
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
    assert.equal(transport.getLevel(), 0);
  });
});
