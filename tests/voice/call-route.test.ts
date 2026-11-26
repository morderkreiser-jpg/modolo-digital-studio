// The realtime call endpoints (lib/voice/server/call.ts) called directly with Request objects: the
// call grant of the session route, the checks of /api/voice/call in their order, the money (held
// before the create, charged at the greeting, settled to the measured seconds, given back when
// nothing was confirmed), the stream and its end, the tool path shared with the webhook, the end
// report's hang-up, the ready route, and the budgets of the route files. A fake call provider over
// the fake control socket, the memory store and the fake clock (as both deps.now and deps.timers):
// no network, no real timer, no request to any provider.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import {
  CALL_CREATE_TIMEOUT_MS,
  CALL_END_RESERVE_SECONDS,
  CALL_OPEN_WINDOW_SECONDS,
  CALL_ROUTE_MAX_DURATION_SECONDS,
  CALL_SETUP_RESERVE_SECONDS,
  callSecondsFor,
  HANGUP_TIMEOUT_MS,
  handleCallRequest,
  handleReadyRequest,
} from "@/lib/voice/server/call";
import { BREAKER_FAILURE_THRESHOLD, isOpen, recordFailure } from "@/lib/voice/server/breaker";
import { resolveVoiceLimits, getVoiceEnv } from "@/lib/voice/server/env";
import { handleEndRequest, handleSessionRequest, runToolCall, TOOL_LOCK_WAIT_MS, type VoiceDeps } from "@/lib/voice/server/handlers";
import {
  acquireSessionLock,
  confirmRealtimeCall,
  SESSION_LEASE_SECONDS,
  settleReportedCall,
  usageSnapshot,
  type SessionReservation,
} from "@/lib/voice/server/limits";
import { createMockProvider } from "@/lib/voice/server/providers/mock";
import type { CreateCallArgs, CreateCallResult, RealtimeCallProvider } from "@/lib/voice/server/providers/types";
import { toVoicePublicConfig } from "@/lib/voice/server/public-config";
import { CONTROL_OPEN_TIMEOUT_MS, HANGUP_RETRY_DELAY_MS, READBACK_TIMEOUT_MS, TOOL_DRAIN_MS } from "@/lib/voice/server/realtime/controller";
import { clearCallId, readCallId, recordCallId, rtcReadyKey } from "@/lib/voice/server/realtime/keys";
import { END_HANGUP_TIMEOUT_MS, END_LOCK_WAIT_MS, isSessionClosed } from "@/lib/voice/server/session";
import { loadState } from "@/lib/voice/server/state";
import { EMAIL_TIMEOUT_MS } from "@/lib/voice/server/summary";
import { signSessionToken, verifySessionToken, type SessionClaims } from "@/lib/voice/server/token";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import type { ToolSinks } from "@/lib/voice/tools/execute";
import { DEFAULT_VOICE_LIMITS, VOICE_REALTIME_CALL_MAX_SECONDS, type CallStreamEvent, type SessionGrant } from "@/lib/voice/types";
import { createFakeClock, drain, type FakeClock } from "./fakes/clock";
import { createFakeControlSocket, script, usageOf, type FakeControlSocket } from "./fakes/control-socket";
import {
  captureLogs,
  importVoiceRoute,
  post,
  readError,
  readGrant,
  sessionBody,
  setVoiceEnv,
  tamper,
  TEST_CALL_ID,
  TEST_OPENAI_KEY,
  TEST_PERSON,
  TEST_PHONE,
  TEST_SECRET,
  testDeps,
  type VoiceTestEnvKey,
} from "./voice-fixtures";

/** Wednesday 2 December 2026, 10:00 in Zurich (the fake clock's default start). */
const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);

/** An audio-only offer as a browser writes it (placeholder ids and keys). */
const OFFER = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0 8",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:Ab1C",
  "a=ice-pwd:placeholderPasswordAbcdefgh",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtpmap:111 opus/48000/2",
].join("\r\n") + "\r\n";

/** The provider's answer (placeholder keys). */
const ANSWER = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:Zz9Y",
  "a=ice-pwd:placeholderAnswerPassword0000",
  "a=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00",
  "a=setup:active",
  "a=mid:0",
  "a=rtpmap:111 opus/48000/2",
].join("\r\n") + "\r\n";

let restoreEnv: () => void = () => undefined;
let logs: string[] = [];
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  restoreEnv();
  restoreEnv = () => undefined;
  mock.restoreAll();
});

function openAiEnv(extra: Partial<Record<VoiceTestEnvKey, string>> = {}): () => void {
  return setVoiceEnv({
    VOICE_ENABLED: "true",
    VOICE_MODE: "realtime",
    VOICE_PROVIDER: "openai",
    VOICE_PROVIDER_API_KEY: TEST_OPENAI_KEY,
    VOICE_SESSION_SECRET: TEST_SECRET,
    ...extra,
  });
}

interface FakeCallProvider extends RealtimeCallProvider {
  socket: FakeControlSocket;
  creates: CreateCallArgs[];
  hangUps: string[];
  opens: number;
}

/** A call provider over the fake control socket; `create` and `hangUp` replace the happy path. */
function fakeCallProvider(
  options: {
    create?: (args: CreateCallArgs) => Promise<CreateCallResult>;
    hangUp?: (callId: string) => Promise<{ ok: boolean; httpStatus?: number }>;
    openFails?: boolean;
  } = {},
): FakeCallProvider {
  const socket = createFakeControlSocket();
  const provider: FakeCallProvider = {
    id: "openai",
    kind: "call",
    confirmsCalls: true,
    socket,
    creates: [],
    hangUps: [],
    opens: 0,
    async createCall(args) {
      provider.creates.push(args);
      if (options.create) return options.create(args);
      return { ok: true, callId: TEST_CALL_ID, answerSdp: ANSWER };
    },
    async openControl() {
      provider.opens += 1;
      return options.openFails ? { ok: false, code: "upstream" } : { ok: true, socket };
    },
    async hangUp(callId) {
      provider.hangUps.push(callId);
      return options.hangUp ? options.hangUp(callId) : { ok: true };
    },
  };
  return provider;
}

interface Harness {
  clock: FakeClock;
  provider: FakeCallProvider;
  deps: VoiceDeps & { store: KVStore };
}

function harness(options: { provider?: FakeCallProvider; deps?: Partial<VoiceDeps>; clock?: FakeClock } = {}): Harness {
  const clock = options.clock ?? createFakeClock(T0);
  const provider = options.provider ?? fakeCallProvider();
  const deps = testDeps({ now: clock.now, timers: clock, provider, ...options.deps });
  return { clock, provider, deps };
}

async function openGrant(deps: VoiceDeps, body: Record<string, unknown> = sessionBody({ mode: "realtime" })): Promise<SessionGrant> {
  const response = await handleSessionRequest(post("/api/voice/session", body), deps);
  assert.equal(response.status, 200, `session refused: ${await response.clone().text()}`);
  return readGrant(response);
}

function claimsOf(grant: SessionGrant, now = T0): SessionClaims {
  const verified = verifySessionToken(grant.sessionToken, TEST_SECRET, now);
  assert.equal(verified.ok, true);
  if (!verified.ok) throw new Error("unreachable");
  return verified.claims;
}

function callRequest(token: string, sdp: unknown = OFFER, headers: Record<string, string> = {}): Request {
  return post("/api/voice/call", { sessionToken: token, sdp }, headers);
}

/** Reads a call stream in the background; `events` grows as frames arrive. */
function collect(response: Response): { events: CallStreamEvent[]; done: Promise<void> } {
  const events: CallStreamEvent[] = [];
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const done = (async () => {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (frame.startsWith("data:")) events.push(JSON.parse(frame.slice(5).trim()) as CallStreamEvent);
      }
    }
  })();
  return { events, done };
}

/** What the controller expects the read-back to show, from the session the provider received. */
function expectedOf(provider: FakeCallProvider): { instructionsChars: number; toolCount: number } {
  const session = provider.creates[0].session;
  return { instructionsChars: String(session.instructions).length, toolCount: (session.tools as unknown[]).length };
}

function logLines(): Array<Record<string, unknown>> {
  return logs.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function linesOf(field: "op" | "warn", value: string): Array<Record<string, unknown>> {
  return logLines().filter((line) => line[field] === value);
}

async function sendReady(h: Harness, token: string): Promise<Response> {
  return handleReadyRequest(post("/api/voice/ready", { sessionToken: token }), h.deps);
}

/**
 * Opens a session, creates its call and brings it live: read-back answered, ready signal sent (or
 * not), greeting sent. Returns the stream reader and the session's ids.
 */
async function liveCall(h: Harness, options: { ready?: boolean; greet?: boolean } = {}) {
  const grant = await openGrant(h.deps);
  const claims = claimsOf(grant);
  const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
  // The body of a refusal is JSON; a stream would only end with the call.
  if (response.status !== 200) assert.fail(`call refused: ${await response.text()}`);
  const stream = collect(response);
  await h.clock.advance(0);
  h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
  if (options.ready !== false) assert.equal((await sendReady(h, grant.sessionToken)).status, 200);
  await h.clock.advance(options.ready === false ? 4_000 : 250);
  if (options.greet !== false) {
    assert.equal(h.provider.socket.sentOfType("response.create").length, 1, "the greeting was sent");
    h.provider.socket.serverSends(script.responseCreated("resp_greet"));
    h.provider.socket.serverSends(script.audioStarted("resp_greet"));
    h.provider.socket.serverSends(script.responseDone("resp_greet"));
    h.provider.socket.serverSends(script.audioStopped("resp_greet"));
    await drain();
  }
  return { grant, claims, response, stream, sid: claims.sid };
}

/** Moves the clock past the call's deadline and waits for the stream to close. */
async function runToDeadline(h: Harness, stream: { done: Promise<void> }): Promise<void> {
  await h.clock.advance((VOICE_REALTIME_CALL_MAX_SECONDS + 5) * 1000);
  await h.clock.advance(TOOL_DRAIN_MS + 1_000);
  await stream.done;
}

describe("the call grant and the public config", () => {
  it("a realtime session with the openai provider gets a call grant, the capped call length and no provider call", async () => {
    restoreEnv = openAiEnv({ VOICE_MAX_CALL_SECONDS: "600" });
    const h = harness();
    const grant = await openGrant(h.deps);
    assert.equal(grant.mode, "realtime");
    assert.deepEqual(grant.realtime, { connect: "call", provider: "openai", expiresAt: T0 + CALL_OPEN_WINDOW_SECONDS * 1000 });
    assert.equal(grant.limits.maxCallSeconds, VOICE_REALTIME_CALL_MAX_SECONDS);
    // The token lives as long as the tenant's call allows: only the call is capped.
    assert.equal(grant.expiresAt, T0 + (600 + 60) * 1000);
    assert.equal(h.provider.creates.length, 0);
    assert.equal(h.provider.opens, 0);
  });

  it("the public config names the call and ready endpoints and caps the call length only when realtime is offered", () => {
    const limits = { ...DEFAULT_VOICE_LIMITS, maxCallSeconds: 600 };
    const live = toVoicePublicConfig(MODOLO_VOICE_TENANT, { locale: "de", limits, modes: ["realtime", "scripted"] });
    assert.equal(live.endpoints.call, "/api/voice/call");
    assert.equal(live.endpoints.ready, "/api/voice/ready");
    assert.equal(live.limits.maxCallSeconds, VOICE_REALTIME_CALL_MAX_SECONDS);
    const local = toVoicePublicConfig(MODOLO_VOICE_TENANT, { locale: "de", limits, modes: ["local", "scripted"] });
    assert.deepEqual(local.endpoints, { session: "/api/voice/session", turn: "/api/voice/turn", end: "/api/voice/end" });
    assert.equal(local.limits.maxCallSeconds, 600);
    const short = toVoicePublicConfig(MODOLO_VOICE_TENANT, { locale: "de", limits: DEFAULT_VOICE_LIMITS, modes: ["realtime"] });
    assert.equal(short.limits.maxCallSeconds, DEFAULT_VOICE_LIMITS.maxCallSeconds);
  });

  it("callSecondsFor and the session's grant cap agree", async () => {
    for (const seconds of [30, 45, 180, 252, 253, 600, 1800]) {
      restoreEnv = openAiEnv({ VOICE_MAX_CALL_SECONDS: String(seconds) });
      const h = harness();
      const grant = await openGrant(h.deps);
      const limits = resolveVoiceLimits(MODOLO_VOICE_TENANT, getVoiceEnv());
      assert.equal(grant.limits.maxCallSeconds, callSecondsFor(limits), `maxCallSeconds ${seconds}`);
      assert.ok(grant.limits.maxCallSeconds <= VOICE_REALTIME_CALL_MAX_SECONDS);
      assert.ok(grant.limits.maxCallSeconds >= 30);
      restoreEnv();
      restoreEnv = () => undefined;
    }
    assert.equal(callSecondsFor({ maxCallSeconds: 10 }), 30);
  });
});

describe("POST /api/voice/call: the checks", () => {
  it("refuses a call when voice is off, the mode is not realtime, or the provider is not a call provider", async () => {
    restoreEnv = setVoiceEnv({ VOICE_ENABLED: "false", VOICE_SESSION_SECRET: TEST_SECRET });
    let h = harness();
    let response = await handleCallRequest(callRequest("x"), h.deps);
    assert.equal(response.status, 503);
    assert.equal((await readError(response)).error, "unavailable");
    restoreEnv();

    restoreEnv = setVoiceEnv({ VOICE_ENABLED: "true", VOICE_MODE: "local", VOICE_BRAIN: "mock", VOICE_SESSION_SECRET: TEST_SECRET });
    h = harness();
    const local = await openGrant(h.deps, sessionBody({ mode: "local" }));
    response = await handleCallRequest(callRequest(local.sessionToken), h.deps);
    assert.equal(response.status, 503);
    restoreEnv();

    // The token kind of provider (the mock) has no calls of ours.
    restoreEnv = setVoiceEnv({ VOICE_ENABLED: "true", VOICE_MODE: "realtime", VOICE_PROVIDER: "mock", VOICE_SESSION_SECRET: TEST_SECRET });
    const deps = testDeps({ now: () => T0, provider: createMockProvider({ now: () => T0 }) });
    const grant = await openGrant(deps);
    response = await handleCallRequest(callRequest(grant.sessionToken), deps);
    assert.equal(response.status, 503);
    assert.equal((await readError(response)).error, "unavailable");
  });

  it("refuses a forged, expired, foreign-mode or closed session's token", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const claims = claimsOf(grant);

    let response = await handleCallRequest(callRequest(tamper(grant.sessionToken)), h.deps);
    assert.equal(response.status, 403);
    assert.equal((await readError(response)).error, "forbidden");

    const expired = signSessionToken({ ...claims, iat: claims.iat - 600, exp: claims.iat - 1 }, TEST_SECRET);
    response = await handleCallRequest(callRequest(expired), h.deps);
    assert.equal(response.status, 401);
    assert.equal((await readError(response)).error, "expired");

    const local = signSessionToken({ ...claims, mode: "local" }, TEST_SECRET);
    response = await handleCallRequest(callRequest(local), h.deps);
    assert.equal(response.status, 403);

    response = await handleCallRequest(callRequest(grant.sessionToken, OFFER, { Origin: "https://elsewhere.example" }), h.deps);
    assert.equal(response.status, 403);

    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps)).status, 200);
    response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 401);
    assert.equal((await readError(response)).error, "expired");
    assert.equal(h.provider.creates.length, 0);
  });

  it("refuses a call opened more than 30 seconds after admission", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    await h.clock.advance(CALL_OPEN_WINDOW_SECONDS * 1000 + 1_000);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 401);
    assert.equal((await readError(response)).error, "expired");
    assert.equal(h.provider.creates.length, 0);
  });

  it("refuses a bad offer before anything is reserved or created", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const withDataChannel = OFFER.replace("a=mid:0\r\n", "a=mid:0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n");
    let response = await handleCallRequest(callRequest(grant.sessionToken, withDataChannel), h.deps);
    assert.equal(response.status, 400);
    assert.equal((await readError(response)).error, "bad_request");
    response = await handleCallRequest(callRequest(grant.sessionToken, `v=0\r\n${"a=x\r\n".repeat(3_000)}`), h.deps);
    assert.equal(response.status, 413);
    assert.equal(h.provider.creates.length, 0);
    // Nothing held: past the admission's lease the session is not counted as running.
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0 + (SESSION_LEASE_SECONDS + 60) * 1000)).running, 0);
    const refused = linesOf("op", "call_open");
    assert.equal(refused[0].outcome, "bad_request");
    assert.equal(refused[0].code, "media");
    // The refused offer did not use the session's one call.
    response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 200);
    const stream = collect(response);
    await runToDeadline(h, stream);
  });

  it("refuses a second call for the same session with 409", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const { grant, stream } = await liveCall(h);
    const second = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(second.status, 409);
    assert.equal((await readError(second)).error, "refused");
    assert.equal(h.provider.creates.length, 1);
    await runToDeadline(h, stream);
  });
});

describe("POST /api/voice/call: the call and its money", () => {
  it("registers the session as running before the call is created, so the concurrency cap holds", async () => {
    restoreEnv = openAiEnv();
    const later = T0 + (SESSION_LEASE_SECONDS + 60) * 1000;
    let runningAtCreate = -1;
    const store = createMemoryStore();
    const provider = fakeCallProvider({
      async create() {
        runningAtCreate = (await usageSnapshot(store, "modolo", later)).running;
        return { ok: true, callId: TEST_CALL_ID, answerSdp: ANSWER };
      },
    });
    const h = harness({ provider, deps: { store, accountingStore: store } });
    const grant = await openGrant(h.deps);
    // The admission alone registers one lease: two minutes later nothing would be counted.
    assert.equal((await usageSnapshot(store, "modolo", later)).running, 0);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 200);
    assert.equal(runningAtCreate, 1, "held for the session's whole life before the create");
    // Charged nothing yet.
    assert.equal((await usageSnapshot(store, "modolo", T0)).minutesToday, 0);
    await runToDeadline(h, collect(response));
  });

  it("answers with an event stream whose first frame is the answer and the call length", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const stream = collect(response);
    await h.clock.advance(0);
    assert.deepEqual(stream.events[0], { type: "answer", sdp: ANSWER, maxSeconds: DEFAULT_VOICE_LIMITS.maxCallSeconds });
    // The provider got the normalised offer, the session for speech and the session's ids.
    const create = h.provider.creates[0];
    assert.equal(create.offerSdp, OFFER);
    assert.equal(create.tenantId, "modolo");
    assert.equal(create.locale, "de");
    assert.equal(create.session.type, "realtime");
    assert.match(String(create.session.instructions), /# Live voice/);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await runToDeadline(h, stream);
    assert.equal(stream.events.filter((event) => event.type === "answer").length, 1);
    // The greeting is never answered and nobody speaks: the silence backstop ends the call.
    assert.deepEqual(stream.events[stream.events.length - 1], { type: "ended", reason: "silence" });
  });

  it("bounds the call by the token's expiry", async () => {
    // A call of 30 s: the token lives 90 s. A create that takes 40 s (fake time) after an offer sent
    // 25 s after admission leaves 25 s of token, minus the margin.
    restoreEnv = openAiEnv({ VOICE_MAX_CALL_SECONDS: "30" });
    const clock = createFakeClock(T0);
    const provider = fakeCallProvider({
      async create() {
        await clock.advance(40_000);
        return { ok: true, callId: TEST_CALL_ID, answerSdp: ANSWER };
      },
    });
    const h = harness({ clock, provider });
    const grant = await openGrant(h.deps);
    await clock.advance(25_000);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 200);
    const stream = collect(response);
    await clock.advance(0);
    const answer = stream.events[0];
    assert.equal(answer.type, "answer");
    if (answer.type === "answer") assert.equal(answer.maxSeconds, 20);
    assert.ok(grant.expiresAt - 5_000 <= T0 + 90_000);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await clock.advance(20_000);
    await clock.advance(TOOL_DRAIN_MS);
    await stream.done;
    assert.deepEqual(stream.events[stream.events.length - 1], { type: "ended", reason: "timeout" });
    assert.ok(clock.now() <= grant.expiresAt + TOOL_DRAIN_MS);
  });

  it("gives the slot back and hangs up a half-created call when the create fails", async () => {
    restoreEnv = openAiEnv();
    const kept: Array<Promise<unknown>> = [];
    const provider = fakeCallProvider({ create: async () => ({ ok: false, code: "upstream", callId: TEST_CALL_ID, httpStatus: 500 }) });
    const h = harness({ provider, deps: { keepAlive: (work) => void kept.push(work) } });
    const grant = await openGrant(h.deps);
    // The session route's own keepAlive calls (spend alerts) are not the call's.
    kept.length = 0;
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 502);
    assert.equal((await readError(response)).error, "upstream");
    // The hang-up is handed to keepAlive, so it outlives the response.
    assert.equal(kept.length, 1);
    await Promise.all(kept);
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
    const usage = await usageSnapshot(h.deps.store, "modolo", T0);
    assert.equal(usage.running, 0, "the slot is free again");
    assert.equal(usage.minutesToday, 0);
    assert.equal(provider.opens, 0);
    const line = linesOf("op", "call_open")[0];
    assert.equal(line.outcome, "upstream");
    assert.equal(line.httpStatus, 500);
    // The session's one call is used: a retry needs a new session.
    assert.equal((await handleCallRequest(callRequest(grant.sessionToken), h.deps)).status, 409);
  });

  it("maps create failures to 502, 503 and 504", async () => {
    restoreEnv = openAiEnv();
    const cases: Array<[CreateCallResult, number, string, number | undefined]> = [
      [{ ok: false, code: "upstream" }, 502, "upstream", undefined],
      [{ ok: false, code: "timeout" }, 504, "timeout", undefined],
      [{ ok: false, code: "unavailable", httpStatus: 401 }, 503, "unavailable", undefined],
      [{ ok: false, code: "busy", retryAfter: 12 }, 503, "busy", 12],
      [{ ok: false, code: "bad_request", httpStatus: 400 }, 400, "bad_request", undefined],
      // Malformed answers of the adapter: no call id, or no SDP answer.
      [{ ok: true, callId: "not-a-call-id", answerSdp: ANSWER }, 502, "upstream", undefined],
      [{ ok: true, callId: TEST_CALL_ID, answerSdp: "nonsense" }, 502, "upstream", undefined],
    ];
    for (const [result, status, error, retryAfter] of cases) {
      const provider = fakeCallProvider({ create: async () => result });
      const h = harness({ provider });
      const grant = await openGrant(h.deps);
      const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
      assert.equal(response.status, status, JSON.stringify(result));
      const body = await readError(response);
      assert.equal(body.error, error);
      assert.equal(body.retryAfter, retryAfter);
      if (retryAfter !== undefined) assert.equal(response.headers.get("retry-after"), String(retryAfter));
      assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).running, 0);
    }
    // A created call without a usable answer is hung up.
    const provider = fakeCallProvider({ create: async () => ({ ok: true, callId: TEST_CALL_ID, answerSdp: "nonsense" }) });
    const h = harness({ provider });
    await handleCallRequest(callRequest((await openGrant(h.deps)).sessionToken), h.deps);
    await drain();
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
  });

  it("counts upstream failures in the breaker, not busy ones, and creates no call while it is open", async () => {
    restoreEnv = openAiEnv();
    const store = createMemoryStore();
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD - 1; i++) await recordFailure(store, "modolo", "openai", T0);

    // A busy answer is the provider's own limit, not a fault: the breaker stays closed.
    const busy = harness({ provider: fakeCallProvider({ create: async () => ({ ok: false, code: "busy", retryAfter: 5 }) }), deps: { store } });
    assert.equal((await handleCallRequest(callRequest((await openGrant(busy.deps)).sessionToken), busy.deps)).status, 503);
    assert.equal(await isOpen(store, "modolo", "openai", T0), false);

    // One more upstream failure opens it, and says so once.
    const failing = harness({ provider: fakeCallProvider({ create: async () => ({ ok: false, code: "upstream", httpStatus: 500 }) }), deps: { store } });
    assert.equal((await handleCallRequest(callRequest((await openGrant(failing.deps)).sessionToken), failing.deps)).status, 502);
    assert.equal(await isOpen(store, "modolo", "openai", T0), true);
    assert.equal(linesOf("warn", "breaker_opened").length, 1);

    // While it is open, no call is created: 503 unavailable, the slot given back.
    const h = harness({ deps: { store } });
    const response = await handleCallRequest(callRequest((await openGrant(h.deps)).sessionToken), h.deps);
    assert.equal(response.status, 503);
    assert.equal((await readError(response)).error, "unavailable");
    assert.equal(h.provider.creates.length, 0);
    assert.equal(h.provider.hangUps.length, 0);
    assert.equal((await usageSnapshot(store, "modolo", T0)).running, 0);
    assert.equal(linesOf("op", "call_open").at(-1)?.outcome, "unavailable");
  });

  it("records the call id and clears it at the end; goes on when it cannot be recorded", async () => {
    restoreEnv = openAiEnv();
    let h = harness();
    let call = await liveCall(h);
    assert.equal(await readCallId(h.deps.store, call.sid), TEST_CALL_ID);
    await runToDeadline(h, call.stream);
    assert.equal(await readCallId(h.deps.store, call.sid), null);

    // A store that refuses to keep the call id: the call goes on, and the controller still hangs up.
    const memory = createMemoryStore();
    const refusing: KVStore = {
      kind: memory.kind,
      incrBy: (key, by, ttl) => memory.incrBy(key, by, ttl),
      get: (key) => memory.get(key),
      set: async (key, value, ttl) => (key.endsWith(":call") && value !== "" ? false : memory.set(key, value, ttl)),
    };
    h = harness({ deps: { store: refusing, accountingStore: refusing } });
    call = await liveCall(h);
    assert.equal(linesOf("warn", "call_step_failed").some((line) => line.kind === "record"), true);
    await runToDeadline(h, call.stream);
    assert.deepEqual(h.provider.hangUps, [TEST_CALL_ID]);
    // Nobody speaks after the greeting: the silence backstop ends it before the deadline.
    assert.deepEqual(call.stream.events[call.stream.events.length - 1], { type: "ended", reason: "silence" });
  });

  it("charges at the greeting and settles to the measured seconds at the end", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    const stream = collect(response);
    await h.clock.advance(0);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await h.clock.advance(0);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday, 0, "nothing before the greeting");
    await sendReady(h, grant.sessionToken);
    await h.clock.advance(250);
    assert.equal(h.provider.socket.sentOfType("response.create").length, 1);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60, DEFAULT_VOICE_LIMITS.maxCallSeconds, "the whole call at the greeting");
    assert.ok(stream.events.some((event) => event.type === "remaining"));
    // One minute later the caller hangs up.
    await h.clock.advance(60_000);
    h.provider.socket.drop();
    await h.clock.advance(2_000);
    await h.clock.advance(TOOL_DRAIN_MS);
    await stream.done;
    const seconds = (await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60;
    assert.ok(seconds >= 60 && seconds <= 62, `settled to ${seconds} s`);
    const end = linesOf("op", "call_end")[0];
    assert.equal(end.confirmed, true);
    assert.equal(end.reason, "provider");
    // Past buckets no longer count: the slot is checked as of now.
    assert.equal((await usageSnapshot(h.deps.store, "modolo", h.clock.now())).running, 0);
  });

  it("an unconfirmed call keeps nothing", async () => {
    restoreEnv = openAiEnv();
    const provider = fakeCallProvider({ openFails: true });
    const h = harness({ provider });
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    const stream = collect(response);
    await h.clock.advance(CONTROL_OPEN_TIMEOUT_MS);
    await h.clock.advance(TOOL_DRAIN_MS);
    await stream.done;
    assert.deepEqual(stream.events[stream.events.length - 1], { type: "error", code: "upstream" });
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
    const usage = await usageSnapshot(h.deps.store, "modolo", T0);
    assert.equal(usage.minutesToday, 0);
    assert.equal(usage.spendChfThisMonth, 0);
    assert.equal(usage.running, 0);
    const end = linesOf("op", "call_end")[0];
    assert.equal(end.confirmed, false);
    assert.equal(end.seconds, 0);
    assert.equal(end.reason, "control");
  });

  it("an unconfirmed call that lasted three seconds is settled at zero", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    const stream = collect(response);
    // The control socket opens, but the read-back never comes.
    await h.clock.advance(0);
    assert.equal(h.provider.opens, 1);
    await h.clock.advance(READBACK_TIMEOUT_MS);
    await h.clock.advance(TOOL_DRAIN_MS);
    await stream.done;
    assert.deepEqual(stream.events[stream.events.length - 1], { type: "error", code: "upstream" });
    assert.equal(h.provider.socket.sentOfType("response.create").length, 0);
    const usage = await usageSnapshot(h.deps.store, "modolo", T0);
    assert.equal(usage.minutesToday, 0);
    assert.equal(usage.spendChfThisMonth, 0);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", h.clock.now())).running, 0);
    const end = linesOf("op", "call_end")[0];
    assert.equal(end.reason, "control");
    assert.equal(end.confirmed, false);
    assert.equal(end.seconds, 0);
  });

  it("a tenant call length above what the route can hold: admitted, held, charged and settled with the capped length", async () => {
    // Five minutes a day: room for the capped call, not for the tenant's ten-minute one.
    restoreEnv = openAiEnv({ VOICE_MAX_CALL_SECONDS: "600", VOICE_MINUTES_PER_DAY: "5" });
    const h = harness();
    const { stream } = await liveCall(h);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60, VOICE_REALTIME_CALL_MAX_SECONDS, "the capped call at the greeting");
    await runToDeadline(h, stream);
    const seconds = (await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60;
    assert.ok(seconds > 0 && seconds <= VOICE_REALTIME_CALL_MAX_SECONDS, `settled to ${seconds} s`);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", h.clock.now())).running, 0);
  });

  it("a tool's confirmation charges the length it is given", async () => {
    restoreEnv = openAiEnv({ VOICE_MAX_CALL_SECONDS: "600" });
    const h = harness();
    const grant = await openGrant(h.deps);
    const env = getVoiceEnv();
    const tenant = getVoiceTenant("modolo");
    assert.ok(tenant);
    await runToolCall({
      claims: claimsOf(grant),
      tenant,
      env,
      deps: h.deps,
      store: h.deps.store,
      now: T0,
      call: { id: "call_1", name: "not_a_tool", input: {} },
      callLimits: { maxCallSeconds: callSecondsFor(resolveVoiceLimits(tenant, env)) },
    });
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60, VOICE_REALTIME_CALL_MAX_SECONDS);
  });

  it("a settlement that lands while the confirmation waits for the store: the confirmation charges nothing", async () => {
    restoreEnv = openAiEnv();
    const memory = createMemoryStore();
    let reservation: SessionReservation | null = null;
    // The settlement runs right after the confirmation's marker was set, before its charge.
    const racing: KVStore = {
      kind: memory.kind,
      get: (key) => memory.get(key),
      set: (key, value, ttl) => memory.set(key, value, ttl),
      incrBy: async (key, by, ttl) => {
        const value = await memory.incrBy(key, by, ttl);
        if (key.startsWith("mva:conf:") && reservation) {
          await settleReportedCall({ store: memory, reservation, reportedSeconds: 0, limits: DEFAULT_VOICE_LIMITS, now: T0 });
        }
        return value;
      },
    };
    const h = harness({ deps: { store: racing, accountingStore: racing } });
    const grant = await openGrant(h.deps);
    reservation = (await loadState(memory, claimsOf(grant).sid))?.reservation ?? null;
    assert.ok(reservation);
    const spend = await confirmRealtimeCall({ store: racing, reservation, limits: DEFAULT_VOICE_LIMITS, now: T0 });
    assert.equal(spend, null);
    const usage = await usageSnapshot(memory, "modolo", T0);
    assert.equal(usage.minutesToday, 0);
    assert.equal(usage.spendChfThisMonth, 0);
    // Not registered as running after its settlement either.
    assert.equal((await usageSnapshot(memory, "modolo", T0 + (SESSION_LEASE_SECONDS + 60) * 1000)).running, 0);
  });

  it("the deadline follows the route's own time when the setup was slow", async () => {
    restoreEnv = openAiEnv({ VOICE_MAX_CALL_SECONDS: "600" });
    const clock = createFakeClock(T0);
    const slowSetup = 20_000;
    const provider = fakeCallProvider({
      async create() {
        await clock.advance(slowSetup);
        return { ok: true, callId: TEST_CALL_ID, answerSdp: ANSWER };
      },
    });
    const h = harness({ clock, provider });
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    const stream = collect(response);
    await clock.advance(0);
    const answer = stream.events[0];
    assert.equal(answer.type, "answer");
    // The capped call (252 s) would end after the route's budget: the route's term is the smaller.
    if (answer.type === "answer") assert.equal(answer.maxSeconds, CALL_ROUTE_MAX_DURATION_SECONDS - CALL_END_RESERVE_SECONDS - slowSetup / 1000);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await runToDeadline(h, stream);
  });

  it("the session sent to the provider lists the tenant's languages, the session's first", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps, sessionBody({ mode: "realtime", locale: "it" }));
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    const stream = collect(response);
    await h.clock.advance(0);
    const session = h.provider.creates[0].session as { audio: { input: { transcription: Record<string, unknown> } } };
    assert.equal(h.provider.creates[0].locale, "it");
    assert.deepEqual(session.audio.input.transcription.languages, ["it", ...MODOLO_VOICE_TENANT.locales.filter((locale) => locale !== "it")]);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await runToDeadline(h, stream);
  });

  it("the session sent to the provider carries the speech model's tool texts: no example phone number", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    const stream = collect(response);
    await h.clock.advance(0);
    const tools = JSON.stringify(h.provider.creates[0].session.tools);
    assert.ok(tools.includes("phone"), "the tenant has a tool that takes a phone number");
    assert.ok(tools.includes("a Swiss number with its area code (ten digits, starting with 0) or in the +41 form"), tools);
    assert.equal(tools.includes("079"), false, tools);
    assert.equal(/\+41 \d/.test(tools), false, tools);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await runToDeadline(h, stream);
  });

  it("refusals of the request (4xx) do not open the breaker and name the provider's code; 5xx still count", async () => {
    restoreEnv = openAiEnv();
    const store = createMemoryStore();
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD - 1; i++) await recordFailure(store, "modolo", "openai", T0);
    // The shape the OpenAI adapter gives a 400 that is not a refused offer.
    const refusal = { ok: false as const, code: "upstream" as const, httpStatus: 400, providerCode: "unknown_parameter" };
    for (let i = 0; i < 3; i++) {
      const h = harness({ provider: fakeCallProvider({ create: async () => refusal }), deps: { store } });
      const response = await handleCallRequest(callRequest((await openGrant(h.deps)).sessionToken), h.deps);
      assert.equal(response.status, 502);
      assert.equal(JSON.stringify(await readError(response)).includes("unknown_parameter"), false, "the code stays out of the answer");
    }
    assert.equal(await isOpen(store, "modolo", "openai", T0), false);
    const lines = linesOf("op", "call_open");
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.equal(line.httpStatus, 400);
      assert.equal(line.outcome, "upstream");
      assert.equal(line.code, "unknown_parameter");
      assert.equal(line.dropped, undefined);
    }
    // A code that does not look like one is not logged.
    const oddRefusal = { ...refusal, providerCode: "a code with spaces" };
    const odd = harness({ provider: fakeCallProvider({ create: async () => oddRefusal }), deps: { store } });
    await handleCallRequest(callRequest((await openGrant(odd.deps)).sessionToken), odd.deps);
    const oddLine = linesOf("op", "call_open").at(-1);
    assert.equal(oddLine?.code, undefined);
    assert.equal(oddLine?.dropped, undefined);
    assert.equal(await isOpen(store, "modolo", "openai", T0), false);
    // An outage still counts.
    const failing = harness({ provider: fakeCallProvider({ create: async () => ({ ok: false, code: "upstream", httpStatus: 503 }) }), deps: { store } });
    await handleCallRequest(callRequest((await openGrant(failing.deps)).sessionToken), failing.deps);
    assert.equal(await isOpen(store, "modolo", "openai", T0), true);
  });

  it("a request aborted during the create: 504 at once, the breaker not counted, the slot given back, and a call created afterwards is hung up", async () => {
    restoreEnv = openAiEnv();
    const store = createMemoryStore();
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD - 1; i++) await recordFailure(store, "modolo", "openai", T0);
    let finish: (result: CreateCallResult) => void = () => undefined;
    const provider = fakeCallProvider({ create: () => new Promise((resolve) => (finish = resolve)) });
    const kept: Array<Promise<unknown>> = [];
    const h = harness({ provider, deps: { store, accountingStore: store, keepAlive: (work) => void kept.push(work) } });
    const grant = await openGrant(h.deps);
    kept.length = 0;
    const abort = new AbortController();
    const request = new Request(callRequest(grant.sessionToken).url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: grant.sessionToken, sdp: OFFER }),
      signal: abort.signal,
    });
    const pending = handleCallRequest(request, h.deps);
    await drain();
    assert.equal(provider.creates.length, 1);
    abort.abort();
    const response = await pending;
    assert.equal(response.status, 504);
    assert.equal((await readError(response)).error, "timeout");
    // The caller's leaving does not cut the create: it may already have made the call.
    assert.equal(provider.creates[0].signal?.aborted, false);
    assert.equal(await isOpen(store, "modolo", "openai", T0), false);
    assert.equal(linesOf("op", "call_open").at(-1)?.callerGone, true);
    assert.equal((await usageSnapshot(store, "modolo", T0)).running, 0);
    assert.equal(provider.hangUps.length, 0);
    // The provider answers after all: the late call is hung up, through keepAlive.
    assert.equal(kept.length, 1);
    finish({ ok: true, callId: TEST_CALL_ID, answerSdp: ANSWER });
    await Promise.all(kept);
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
  });

  it("the create timeout fires: the route answers 504 without waiting, and a late call is hung up", async () => {
    restoreEnv = openAiEnv();
    let finish: (result: CreateCallResult) => void = () => undefined;
    const provider = fakeCallProvider({ create: () => new Promise((resolve) => (finish = resolve)) });
    const kept: Array<Promise<unknown>> = [];
    const h = harness({ provider, deps: { createTimeoutMs: 20, keepAlive: (work) => void kept.push(work) } });
    const grant = await openGrant(h.deps);
    kept.length = 0;
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 504);
    assert.equal((await readError(response)).error, "timeout");
    assert.equal(provider.creates[0].signal?.aborted, true, "the create got the timeout as its signal");
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).running, 0);
    assert.equal(kept.length, 1);
    finish({ ok: false, code: "upstream", callId: TEST_CALL_ID });
    await Promise.all(kept);
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
  });
});

describe("POST /api/voice/call: tools and the end", () => {
  it("runs a tool through the webhook's code path, once, under the session lock", async () => {
    restoreEnv = openAiEnv();
    const callbacks: Array<{ name: string; phone: string }> = [];
    let release: () => void = () => undefined;
    const sinks: ToolSinks = {
      lead: async () => ({ ok: true, ref: "LD-TEST" }),
      callback: async (record) => {
        callbacks.push({ name: record.name, phone: record.phone });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true };
      },
      transfer: async () => ({ connected: false }),
    };
    const h = harness({ deps: { sinks: () => sinks } });
    const { sid, stream } = await liveCall(h);
    const socket = h.provider.socket;
    socket.serverSends(script.responseCreated("resp_1"));
    socket.serverSends(script.functionCall("resp_1", "call_1", "request_callback", { name: TEST_PERSON, phone: TEST_PHONE, topic: "Website" }));
    socket.serverSends(script.responseDone("resp_1"));
    await drain();
    assert.equal(callbacks.length, 1);
    // The tool holds the session's lock while it runs.
    assert.equal(await acquireSessionLock(h.deps.store, sid, { clock: h.clock.now, waitMs: 0 }), null);
    release();
    await drain();
    const outputs = socket.sentOfType("conversation.item.create");
    assert.equal(outputs.length, 1);
    const item = outputs[0].item as Record<string, unknown>;
    assert.equal(item.call_id, "call_1");
    assert.match(String(item.output), /"ok":true/);
    assert.equal(socket.sentOfType("response.create").length, 2, "the greeting and the answer to the tool");
    assert.deepEqual(
      stream.events.filter((event) => event.type === "tool"),
      [
        { type: "tool", name: "request_callback", status: "started" },
        { type: "tool", name: "request_callback", status: "ok" },
      ],
    );
    assert.ok(stream.events.some((event) => event.type === "handoff"));
    const state = await loadState(h.deps.store, sid);
    assert.equal(state?.outcomes.length, 1);
    assert.equal(state?.outcomes[0].kind, "callback");
    const lock = await acquireSessionLock(h.deps.store, sid, { clock: h.clock.now, waitMs: 0 });
    assert.notEqual(lock, null, "released after the tool");
    await lock?.release();
    await runToDeadline(h, stream);
    assert.equal(callbacks.length, 1, "once");
    assert.equal(linesOf("op", "call_end")[0].tools, 1);
  });

  it("a tool's refusal of a number is worded for the speech model: no example phone number", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const { stream } = await liveCall(h);
    const socket = h.provider.socket;
    socket.serverSends(script.responseCreated("resp_1"));
    socket.serverSends(script.functionCall("resp_1", "call_1", "request_callback", { name: TEST_PERSON, phone: "12345", topic: "Website" }));
    socket.serverSends(script.responseDone("resp_1"));
    await drain();
    const outputs = socket.sentOfType("conversation.item.create");
    assert.equal(outputs.length, 1);
    const output = String((outputs[0].item as Record<string, unknown>).output);
    const answer = JSON.parse(output) as { ok: boolean; code: string; say: string };
    assert.equal(answer.ok, false);
    assert.equal(answer.code, "invalid_input");
    assert.ok(answer.say.includes('"phone" must be a phone number with area code (ten digits, starting with 0).'), answer.say);
    assert.equal(output.includes("079"), false, output);
    await runToDeadline(h, stream);
  });

  it("the end report hangs up the recorded call in parallel with closing", async () => {
    restoreEnv = openAiEnv();
    let finishHangUp: () => void = () => undefined;
    const provider = fakeCallProvider({
      hangUp: () =>
        new Promise((resolve) => {
          finishHangUp = () => resolve({ ok: true });
        }),
    });
    const h = harness({ provider });
    const grant = await openGrant(h.deps);
    const { sid } = claimsOf(grant);
    assert.equal(await recordCallId(h.deps.store, sid, TEST_CALL_ID, 300), true);
    const ending = handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps);
    await drain();
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
    // The hang-up is still running, and the session is already closed and finished.
    assert.equal(await isSessionClosed(h.deps.store, sid), true);
    assert.equal(linesOf("op", "end").length, 1);
    finishHangUp();
    const response = await ending;
    assert.equal(response.status, 200);
    assert.equal(await readCallId(h.deps.store, sid), null);
  });

  it("the end report during a call: the controller ends within two seconds, settles, and the summary goes out once", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const { grant, stream, sid } = await liveCall(h);
    await h.clock.advance(10_000);
    const report = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps);
    assert.equal(report.status, 200);
    // The end route hung up the recorded call itself.
    assert.deepEqual(h.provider.hangUps, [TEST_CALL_ID]);
    await h.clock.advance(2_000);
    assert.deepEqual(stream.events[stream.events.length - 1], { type: "ended", reason: "user" });
    await h.clock.advance(TOOL_DRAIN_MS);
    await stream.done;
    // The end route hung up and cleared the id: the controller's hook skips its own hang-up.
    assert.equal(h.provider.hangUps.length, 1, "the controller did not hang up a second time");
    assert.equal(linesOf("warn", "call_hangup_failed").length, 0);
    assert.equal(linesOf("op", "end").length, 1, "one summary");
    const end = linesOf("op", "call_end")[0];
    assert.equal(end.delivery, "closed_before");
    assert.equal(end.reason, "user");
    const seconds = (await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60;
    assert.ok(seconds >= 10 && seconds <= 12, `settled to ${seconds} s`);
    assert.equal(await readCallId(h.deps.store, sid), null);
  });

  it("a client that never sends ready or end and never reads the stream is still ended at the deadline, hung up, settled and finished", async () => {
    restoreEnv = openAiEnv();
    const kept: Array<Promise<unknown>> = [];
    const h = harness({ deps: { keepAlive: (work) => void kept.push(work) } });
    const grant = await openGrant(h.deps);
    const { sid } = claimsOf(grant);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 200);
    await h.clock.advance(0);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await h.clock.advance(4_000);
    assert.equal(h.provider.socket.sentOfType("response.create").length, 1, "greeted after the fallback");
    let finished = false;
    void kept[kept.length - 1].then(() => {
      finished = true;
    });
    // The microphone keeps sending sound (the silence backstop never fires); nothing else comes.
    for (let minute = 0; minute < 3; minute += 1) {
      await h.clock.advance(60_000);
      h.provider.socket.serverSends(script.speechStarted());
      h.provider.socket.serverSends(script.speechStopped());
    }
    await h.clock.advance(TOOL_DRAIN_MS);
    assert.equal(finished, true);
    assert.deepEqual(h.provider.hangUps, [TEST_CALL_ID]);
    assert.equal(await isSessionClosed(h.deps.store, sid), true);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", h.clock.now())).running, 0);
    const usage = await usageSnapshot(h.deps.store, "modolo", T0);
    assert.equal(usage.minutesToday * 60, DEFAULT_VOICE_LIMITS.maxCallSeconds - 4);
    const end = linesOf("op", "call_end")[0];
    assert.equal(end.reason, "timeout");
    assert.equal(end.delivery, "done");
    assert.equal(end.readyMs, -1);
    assert.equal(linesOf("op", "end")[0].reason, "timeout");
  });

  it("the store fails at settlement: the call is still hung up and finishSession runs", async () => {
    restoreEnv = openAiEnv();
    const memory = createMemoryStore();
    let failSettle = false;
    const failing: KVStore = {
      kind: memory.kind,
      incrBy: async (key, by, ttl) => {
        if (failSettle && key.startsWith("mva:settled:")) throw new Error("store down");
        return memory.incrBy(key, by, ttl);
      },
      get: (key) => memory.get(key),
      set: (key, value, ttl) => memory.set(key, value, ttl),
    };
    const h = harness({ deps: { store: failing, accountingStore: failing } });
    const { stream, sid } = await liveCall(h);
    failSettle = true;
    await runToDeadline(h, stream);
    assert.deepEqual(h.provider.hangUps, [TEST_CALL_ID]);
    assert.equal(linesOf("warn", "call_step_failed").some((line) => line.kind === "settle"), true);
    assert.equal(await isSessionClosed(memory, sid), true);
    assert.equal(linesOf("op", "end").length, 1);
    assert.equal(linesOf("op", "call_end")[0].delivery, "done");
  });

  it("the call route passes keepAlive a promise that is still pending while the controller runs, before the response is returned", async () => {
    restoreEnv = openAiEnv();
    let returned = false;
    let calledBeforeReturn: boolean | null = null;
    let work: Promise<unknown> | null = null;
    const h = harness({
      deps: {
        keepAlive: (promise) => {
          calledBeforeReturn = !returned;
          work = promise;
        },
      },
    });
    const grant = await openGrant(h.deps);
    // The session route's own keepAlive calls (spend alerts) are not the call's.
    calledBeforeReturn = null;
    work = null;
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    returned = true;
    assert.equal(calledBeforeReturn, true);
    assert.ok(work);
    let settled = false;
    void (work as Promise<unknown>).then(() => {
      settled = true;
    });
    const stream = collect(response);
    await h.clock.advance(0);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    await h.clock.advance(60_000);
    assert.equal(settled, false, "pending while the call runs");
    await runToDeadline(h, stream);
    await drain();
    assert.equal(settled, true);
  });

  it("logs only numbers and codes (captureLogs: no SDP, no call id, no caption text)", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const { stream } = await liveCall(h);
    const socket = h.provider.socket;
    socket.serverSends(script.speechStarted("item_c1"));
    socket.serverSends(script.speechStopped("item_c1"));
    socket.serverSends(script.committed("item_c1"));
    socket.serverSends(script.callerCompleted("item_c1", `Ich bin ${TEST_PERSON}, ${TEST_PHONE}`));
    socket.serverSends(script.responseCreated("resp_2"));
    socket.serverSends(script.assistantDelta("item_a1", `Danke ${TEST_PERSON}`, "resp_2"));
    socket.serverSends(script.assistantDone("item_a1", `Danke ${TEST_PERSON}`, "resp_2"));
    socket.serverSends(script.responseDone("resp_2"));
    await drain();
    assert.ok(stream.events.some((event) => event.type === "caption" && event.text.includes(TEST_PERSON)), "the captions reach the browser");
    await runToDeadline(h, stream);
    const all = logs.join("\n");
    for (const secret of [TEST_PERSON, TEST_PHONE, TEST_CALL_ID, "rtc_", "v=0", "a=ice", "Danke", TEST_OPENAI_KEY]) {
      assert.equal(all.includes(secret), false, `a log line carries ${secret}`);
    }
    for (const op of ["call_open", "call_end"]) {
      const line = linesOf("op", op)[0];
      assert.ok(line, op);
      assert.equal(line.dropped, undefined, `${op} lost a field to the guard`);
    }
    const end = linesOf("op", "call_end")[0];
    for (const field of ["seconds", "responses", "turns", "inTok", "outAuTok", "transcribeSec", "transcribeInTok", "transcribeOutTok", "usdHigh", "usdEst", "brakeChf", "sidebandMs", "readyMs", "greetMs"]) {
      assert.equal(typeof end[field], "number", field);
    }
    assert.equal(end.turns, 1);
    assert.equal(end.responses, 2);
  });
});

describe("POST /api/voice/call: the hang-up at the end", () => {
  it("the end route hung up first: the controller skips its hang-up, with no warning and no wait", async () => {
    restoreEnv = openAiEnv();
    let attempts = 0;
    // A second hang-up of a call that is gone would only answer after its bound.
    const provider = fakeCallProvider({ hangUp: () => (++attempts === 1 ? Promise.resolve({ ok: true }) : new Promise(() => undefined)) });
    const h = harness({ provider });
    const { grant, stream, sid } = await liveCall(h);
    await h.clock.advance(10_000);
    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps)).status, 200);
    assert.equal(await readCallId(h.deps.store, sid), null, "the end route cleared the id after its hang-up");
    let closed = false;
    void stream.done.then(() => {
      closed = true;
    });
    // The closed poll ends the call; no fake time passes for a hang-up.
    await h.clock.advance(2_000);
    await drain();
    assert.equal(closed, true, "the stream ended without waiting for a hang-up");
    assert.deepEqual(stream.events[stream.events.length - 1], { type: "ended", reason: "user" });
    assert.deepEqual(provider.hangUps, [TEST_CALL_ID]);
    assert.equal(linesOf("warn", "call_hangup_failed").length, 0);
    assert.equal(linesOf("op", "call_end").length, 1);
  });

  it("a hang-up that always fails: three attempts, one warning, the id kept for a later end report", async () => {
    restoreEnv = openAiEnv();
    const provider = fakeCallProvider({ hangUp: async () => ({ ok: false, httpStatus: 500 }) });
    const h = harness({ provider });
    const { grant, stream, sid } = await liveCall(h);
    await runToDeadline(h, stream);
    assert.equal(provider.hangUps.length, 3);
    const warnings = linesOf("warn", "call_hangup_failed");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].httpStatus, 500);
    assert.equal(await readCallId(h.deps.store, sid), TEST_CALL_ID, "still recorded");
    assert.equal(linesOf("op", "call_end").length, 1);
    // A later end report tries again from the recorded id, and keeps it while it fails.
    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps)).status, 200);
    assert.equal(provider.hangUps.length, 4);
    assert.equal(await readCallId(h.deps.store, sid), TEST_CALL_ID);
  });

  it("a failed hang-up while the end route clears the id: counted as done, no retry, no warning", async () => {
    restoreEnv = openAiEnv();
    let clearIt: (() => Promise<unknown>) | null = null;
    let hungUpAt = -1;
    // The end route hangs up and clears the id while our own attempt is still out, which then fails.
    const provider = fakeCallProvider({
      hangUp: async () => {
        hungUpAt = h.clock.now();
        await clearIt?.();
        return { ok: false, httpStatus: 503 };
      },
    });
    let work: Promise<unknown> | null = null;
    const h = harness({ provider, deps: { keepAlive: (promise) => void (work = promise) } });
    const { stream, sid } = await liveCall(h);
    clearIt = () => clearCallId(h.deps.store, sid);
    assert.ok(work);
    let doneAt = -1;
    void (work as Promise<unknown>).then(() => {
      doneAt = h.clock.now();
    });
    await runToDeadline(h, stream);
    await drain();
    assert.equal(provider.hangUps.length, 1, "no retry for a call somebody else hung up");
    assert.equal(linesOf("warn", "call_hangup_failed").length, 0);
    assert.equal(await readCallId(h.deps.store, sid), null);
    assert.ok(hungUpAt > 0 && doneAt >= hungUpAt);
    assert.ok(doneAt - hungUpAt < HANGUP_RETRY_DELAY_MS, `the end waited ${doneAt - hungUpAt} ms for a retry it did not need`);
  });

  it("a failed end-route hang-up keeps the id; a successful one clears it", async () => {
    restoreEnv = openAiEnv();
    const answers = [{ ok: false, httpStatus: 503 }, { ok: true }];
    const provider = fakeCallProvider({ hangUp: async () => answers.shift() ?? { ok: true } });
    const h = harness({ provider });
    const grant = await openGrant(h.deps);
    const { sid } = claimsOf(grant);
    assert.equal(await recordCallId(h.deps.store, sid, TEST_CALL_ID, 300), true);
    const end = (): Promise<Response> => handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps);
    assert.equal((await end()).status, 200);
    assert.equal(await readCallId(h.deps.store, sid), TEST_CALL_ID);
    assert.equal((await end()).status, 200);
    assert.equal(provider.hangUps.length, 2);
    assert.equal(await readCallId(h.deps.store, sid), null);
  });

  it("a first failure and a second success: no warning, the id cleared", async () => {
    restoreEnv = openAiEnv();
    const answers = [{ ok: false, httpStatus: 500 }, { ok: true }];
    const provider = fakeCallProvider({ hangUp: async () => answers.shift() ?? { ok: true } });
    let work: Promise<unknown> | null = null;
    const h = harness({ provider, deps: { keepAlive: (promise) => void (work = promise) } });
    const { stream, sid } = await liveCall(h);
    assert.ok(work);
    let attemptsAtEnd = -1;
    void (work as Promise<unknown>).then(() => {
      attemptsAtEnd = provider.hangUps.length;
    });
    await runToDeadline(h, stream);
    await drain();
    // The end waited for the retry before it closed the stream and let the function go.
    assert.equal(attemptsAtEnd, 2);
    assert.equal(provider.hangUps.length, 2);
    assert.equal(linesOf("warn", "call_hangup_failed").length, 0);
    assert.equal(await readCallId(h.deps.store, sid), null);
  });

  it("the browser cancels the stream mid-call: hung up, settled to the measured seconds, the slot free", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const response = await handleCallRequest(callRequest(grant.sessionToken), h.deps);
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const reader = response.body.getReader();
    await reader.read();
    await h.clock.advance(0);
    h.provider.socket.serverSends(script.readback(expectedOf(h.provider)));
    assert.equal((await sendReady(h, grant.sessionToken)).status, 200);
    await h.clock.advance(250);
    assert.equal(h.provider.socket.sentOfType("response.create").length, 1, "greeted: confirmed and charged");
    await h.clock.advance(10_000);
    await reader.cancel();
    await h.clock.advance(100);
    await h.clock.advance(TOOL_DRAIN_MS + 1_000);
    assert.deepEqual(h.provider.hangUps, [TEST_CALL_ID]);
    const seconds = (await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60;
    assert.ok(seconds >= 10 && seconds <= 11, `settled to ${seconds} s`);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", h.clock.now())).running, 0);
    assert.equal(linesOf("op", "call_end")[0].reason, "unload");
  });
});

describe("POST /api/voice/call: a tool at the end, and after it", () => {
  function heldCallbackSinks(): { sinks: ToolSinks; calls: () => number; release: () => void } {
    let release: () => void = () => undefined;
    let calls = 0;
    const sinks: ToolSinks = {
      lead: async () => ({ ok: true, ref: "LD-TEST" }),
      callback: async () => {
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true };
      },
      transfer: async () => ({ connected: false }),
    };
    return { sinks, calls: () => calls, release: () => release() };
  }

  function startCallbackTool(h: Harness): void {
    const socket = h.provider.socket;
    socket.serverSends(script.responseCreated("resp_1"));
    socket.serverSends(script.functionCall("resp_1", "call_1", "request_callback", { name: TEST_PERSON, phone: TEST_PHONE, topic: "Website" }));
    socket.serverSends(script.responseDone("resp_1"));
  }

  it("a tool still running at the end: settlement, the summary and the keep-alive promise wait for it", async () => {
    restoreEnv = openAiEnv();
    const held = heldCallbackSinks();
    let work: Promise<unknown> | null = null;
    const h = harness({ deps: { sinks: () => held.sinks, keepAlive: (promise) => void (work = promise) } });
    const { stream, sid } = await liveCall(h);
    assert.ok(work);
    let finished = false;
    void (work as Promise<unknown>).then(() => {
      finished = true;
    });
    startCallbackTool(h);
    await drain();
    assert.equal(held.calls(), 1);
    // The deadline passes while the tool runs.
    await h.clock.advance((DEFAULT_VOICE_LIMITS.maxCallSeconds + 1) * 1000);
    await h.clock.advance(TOOL_DRAIN_MS - 2_000);
    assert.deepEqual(stream.events.filter((event) => event.type === "ended"), [{ type: "ended", reason: "timeout" }]);
    assert.equal(linesOf("op", "call_end").length, 0, "no call_end before the tool is done");
    assert.equal(linesOf("op", "end").length, 0, "no summary before the tool is done");
    assert.equal(await isSessionClosed(h.deps.store, sid), false);
    assert.equal((await usageSnapshot(h.deps.store, "modolo", T0)).minutesToday * 60, DEFAULT_VOICE_LIMITS.maxCallSeconds, "not settled yet");
    assert.equal(finished, false, "the keep-alive promise is still pending");
    held.release();
    await drain();
    await stream.done;
    await drain();
    assert.equal(linesOf("op", "call_end").length, 1);
    assert.equal(linesOf("op", "end").length, 1);
    assert.equal(finished, true);
    const state = linesOf("op", "end")[0];
    assert.equal(state.outcomes, 1, "the summary has what the tool did");
  });

  it("a tool that never finishes holds the end for TOOL_DRAIN_MS only", async () => {
    restoreEnv = openAiEnv();
    const held = heldCallbackSinks();
    const h = harness({ deps: { sinks: () => held.sinks, lockWaitMs: 0 } });
    const { stream } = await liveCall(h);
    startCallbackTool(h);
    await drain();
    assert.equal(held.calls(), 1);
    await h.clock.advance((DEFAULT_VOICE_LIMITS.maxCallSeconds + 1) * 1000);
    assert.deepEqual(h.provider.hangUps, [TEST_CALL_ID]);
    assert.equal(linesOf("op", "call_end").length, 0);
    await h.clock.advance(TOOL_DRAIN_MS - 2_000);
    assert.equal(linesOf("op", "call_end").length, 0, "still within the bound");
    await h.clock.advance(3_000);
    await stream.done;
    assert.equal(linesOf("op", "call_end").length, 1);
  });

  it("no tool runs once the session is closed", async () => {
    restoreEnv = openAiEnv();
    const held = heldCallbackSinks();
    const h = harness({ deps: { sinks: () => held.sinks } });
    const { grant, stream } = await liveCall(h);
    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), h.deps)).status, 200);
    // A function call arrives before the controller's next closed poll.
    startCallbackTool(h);
    await drain();
    assert.equal(held.calls(), 0, "the sink was not called");
    assert.equal(
      linesOf("op", "tool").some((line) => line.ok === true),
      false,
    );
    const outputs = h.provider.socket.sentOfType("conversation.item.create");
    assert.ok(outputs.every((event) => !String((event.item as Record<string, unknown>).output).includes('"ok":true')));
    await h.clock.advance(2_000);
    await h.clock.advance(TOOL_DRAIN_MS);
    await stream.done;
  });
});

describe("POST /api/voice/call: the brake warning", () => {
  /** A live call with one answer of this usage, ended by the provider a minute after the greeting. */
  async function callWithUsage(usage: ReturnType<typeof usageOf>): Promise<Record<string, unknown>> {
    const h = harness();
    const { stream } = await liveCall(h);
    h.provider.socket.serverSends(script.responseCreated("resp_1"));
    h.provider.socket.serverSends(script.responseDone("resp_1", { usage }));
    await drain();
    await h.clock.advance(60_000);
    h.provider.socket.drop();
    await h.clock.advance(2_000);
    await h.clock.advance(TOOL_DRAIN_MS);
    await stream.done;
    return linesOf("op", "call_end").at(-1) as Record<string, unknown>;
  }

  it("compares the estimate with the brake, not the upper bound", async () => {
    restoreEnv = openAiEnv();
    const chf = getVoiceEnv().chfPerUsd;
    // Example usage: a large prompt read from the cache.
    const end = await callWithUsage(usageOf({ inText: 200_000, inCachedText: 200_000, outText: 100, outAudio: 100 }));
    const usdHigh = end.usdHigh as number;
    const usdEst = end.usdEst as number;
    const brakeChf = end.brakeChf as number;
    assert.ok(usdHigh * chf > brakeChf && usdEst * chf <= brakeChf, `premise: ${usdHigh} ${usdEst} ${brakeChf}`);
    assert.equal(linesOf("warn", "call_cost_above_brake").length, 0);
  });

  it("warns once, with the three figures, when the estimate is above the brake", async () => {
    restoreEnv = openAiEnv();
    const chf = getVoiceEnv().chfPerUsd;
    // Example usage: the same prompt, not cached.
    const end = await callWithUsage(usageOf({ inText: 200_000, outText: 100, outAudio: 100 }));
    assert.ok((end.usdEst as number) * chf > (end.brakeChf as number));
    const warnings = linesOf("warn", "call_cost_above_brake");
    assert.equal(warnings.length, 1);
    for (const field of ["usdHigh", "usdEst", "brakeChf"]) assert.equal(warnings[0][field], end[field], field);
  });
});

describe("POST /api/voice/ready", () => {
  it("the ready route refuses a foreign origin and does not count it", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    const { sid } = claimsOf(grant);
    const foreign = await handleReadyRequest(post("/api/voice/ready", { sessionToken: grant.sessionToken }, { Origin: "https://elsewhere.example" }), h.deps);
    assert.equal(foreign.status, 403);
    assert.equal((await readError(foreign)).error, "forbidden");
    assert.equal(await h.deps.store.get(rtcReadyKey(sid)), null);
    assert.equal((await sendReady(h, grant.sessionToken)).status, 200);
    assert.equal(await h.deps.store.get(rtcReadyKey(sid)), "1");
  });

  it("the ready route counts at most five signals and refuses forged tokens", async () => {
    restoreEnv = openAiEnv();
    const h = harness();
    const grant = await openGrant(h.deps);
    for (let i = 0; i < 5; i += 1) {
      const response = await sendReady(h, grant.sessionToken);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
    const sixth = await sendReady(h, grant.sessionToken);
    assert.equal(sixth.status, 429);
    const body = await readError(sixth);
    assert.equal(body.error, "rate_limited");
    assert.equal(body.retryAfter, 10);
    assert.equal((await sendReady(h, tamper(grant.sessionToken))).status, 403);
    const local = signSessionToken({ ...claimsOf(grant), mode: "local" }, TEST_SECRET);
    assert.equal((await sendReady(h, local)).status, 403);
    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken }), h.deps)).status, 200);
    assert.equal((await sendReady(h, grant.sessionToken)).status, 401);
    const tooBig = await handleReadyRequest(post("/api/voice/ready", { sessionToken: grant.sessionToken, pad: "x".repeat(3_000) }), h.deps);
    assert.equal(tooBig.status, 413);
  });
});

describe("the budgets of the route files", () => {
  it("the call route's maxDuration equals CALL_ROUTE_MAX_DURATION_SECONDS and the reserves fit in it", async () => {
    const call = await importVoiceRoute("call");
    assert.equal(call.runtime, "nodejs");
    assert.equal(call.maxDuration, CALL_ROUTE_MAX_DURATION_SECONDS);
    const ready = await importVoiceRoute("ready");
    assert.equal(ready.runtime, "nodejs");
    assert.equal(ready.maxDuration, 10);
    assert.ok(VOICE_REALTIME_CALL_MAX_SECONDS <= CALL_ROUTE_MAX_DURATION_SECONDS - CALL_SETUP_RESERVE_SECONDS - CALL_END_RESERVE_SECONDS);
    assert.ok(
      0.4 + HANGUP_TIMEOUT_MS / 1000 + TOOL_DRAIN_MS / 1000 + 3 + END_LOCK_WAIT_MS / 1000 + EMAIL_TIMEOUT_MS / 1000 + 2 <= CALL_END_RESERVE_SECONDS,
    );
    assert.ok(TOOL_DRAIN_MS >= TOOL_LOCK_WAIT_MS + EMAIL_TIMEOUT_MS + 2000);
    // The setup: the create's own bound fits in its reserve.
    assert.ok(CALL_CREATE_TIMEOUT_MS / 1000 < CALL_SETUP_RESERVE_SECONDS);
  });

  it("the open window, the create timeout, the control open and the read-back fit in one lease", () => {
    assert.ok(CALL_OPEN_WINDOW_SECONDS + (CALL_CREATE_TIMEOUT_MS + CONTROL_OPEN_TIMEOUT_MS + READBACK_TIMEOUT_MS) / 1000 < SESSION_LEASE_SECONDS);
  });

  it("the end route still fits its maxDuration with the hang-up", async () => {
    const end = await importVoiceRoute("end");
    assert.equal(END_HANGUP_TIMEOUT_MS, 1500);
    assert.ok(Math.max(END_HANGUP_TIMEOUT_MS, END_LOCK_WAIT_MS + EMAIL_TIMEOUT_MS) + 2000 <= end.maxDuration * 1000);
    assert.ok(getVoiceTenant("modolo"));
  });
});
