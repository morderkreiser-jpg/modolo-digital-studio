// The realtime call controller (lib/voice/server/realtime/controller.ts), driven with a fake
// control socket and a fake clock: no network, no real timer. The provider's events are played
// by the test (tests/voice/fakes/control-socket.ts). The money paths come first in importance:
// the deadline in every state, the end sequence running once, the hang-up always being called,
// a tool still running at the end, malformed events never throwing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ControlEvent, OpenControlResult } from "@/lib/voice/server/providers/types";
import {
  CALLER_HOLD_MS,
  CAPTION_THROTTLE_MS,
  CLOSED_POLL_MS,
  CONTROL_OPEN_TIMEOUT_MS,
  CREATE_ANSWER_MS,
  GOODBYE_CEILING_MS,
  GOODBYE_GUARD_MS,
  GOODBYE_TAIL_MS,
  HANGUP_RETRY_DELAY_MS,
  GREETING_GUARD_MS,
  READBACK_TIMEOUT_MS,
  READY_FALLBACK_MS,
  READY_LATE_POLL_MS,
  READY_POLL_MS,
  READY_POLL_STOP_MS,
  RESEND_DELAY_MS,
  runCallController,
  type CallControllerOptions,
  type CallEndReport,
} from "@/lib/voice/server/realtime/controller";
import { addResponseUsage, emptyUsage, usageCostUsd } from "@/lib/voice/server/realtime/pricing";
import type { CallStreamEvent, ToolCall, ToolOutcome } from "@/lib/voice/types";
import { createFakeClock, type FakeClock } from "./fakes/clock";
import {
  createFakeControlSocket,
  openControlFails,
  openControlOk,
  script,
  usageOf,
  type FakeControlSocket,
} from "./fakes/control-socket";
import { TEST_PERSON, TEST_PHONE } from "./voice-fixtures";

const EXPECTED = { instructionsChars: 1_234, toolCount: 3 };
const GREETING = 'Speak exactly this greeting, word for word, in English, and nothing else. Do not add or change any word: "Hello, this is a test assistant."';
const TENANT = "demo-umzug";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  clock: FakeClock;
  socket: FakeControlSocket;
  events: CallStreamEvent[];
  logs: Record<string, unknown>[];
  abort: AbortController;
  state: { ready: boolean; closed: boolean };
  calls: { hangUp: number; confirm: number; pollReady: number; pollClosed: number; tools: ToolCall[]; createsAtConfirm: number[] };
  options: CallControllerOptions;
  answerAt: number;
  report: CallEndReport | null;
  send(event: unknown): void;
  readback(): void;
}

const ok = (say = "Done."): ToolOutcome => ({ ok: true, say });

function defaultTool(call: ToolCall): Promise<ToolOutcome> {
  if (call.name === "end_call") return Promise.resolve({ ok: true, say: "Say goodbye.", endCall: true });
  return Promise.resolve(ok());
}

/** A running controller. Pass `clock` when a hook needs the clock before the harness exists. */
function harness(overrides: Partial<CallControllerOptions> = {}, clock: FakeClock = createFakeClock()): Harness {
  const socket = createFakeControlSocket();
  const events: CallStreamEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const abort = new AbortController();
  const state = { ready: false, closed: false };
  const calls: Harness["calls"] = { hangUp: 0, confirm: 0, pollReady: 0, pollClosed: 0, tools: [], createsAtConfirm: [] };
  const answerAt = clock.now();
  const options: CallControllerOptions = {
    tenantId: TENANT,
    locale: "en",
    greetingText: GREETING,
    expected: EXPECTED,
    limits: { warnBeforeEndSeconds: 30, silenceTimeoutSeconds: 300, maxTurnChars: 200 },
    answerAt,
    deadlineAt: answerAt + 180_000,
    maxResponses: 80,
    maxCallUsd: 2,
    model: "gpt-realtime-2.1",
    host: "api.openai.com",
    transcribeModel: "gpt-transcribe",
    clock,
    signal: abort.signal,
    openControl: openControlOk(socket),
    hangUp: async () => {
      calls.hangUp += 1;
      return { ok: true };
    },
    pollReady: async () => {
      calls.pollReady += 1;
      return state.ready;
    },
    pollClosed: async () => {
      calls.pollClosed += 1;
      return state.closed;
    },
    confirm: async () => {
      calls.confirm += 1;
      calls.createsAtConfirm.push(socket.sentOfType("response.create").length);
    },
    runTool: (call) => {
      calls.tools.push(call);
      return defaultTool(call);
    },
    instructionsAt: (seconds) => `instructions with ${seconds} seconds left`,
    toolOutput: (outcome) => JSON.stringify({ ok: outcome.ok, say: outcome.say }),
    handoffOf: (name, outcome) => (name === "request_callback" && outcome.ok ? { kind: "callback" } : null),
    emit: (event) => {
      events.push(event);
    },
    log: (fields) => {
      logs.push(fields);
    },
    ...overrides,
  };
  const h: Harness = {
    clock,
    socket,
    events,
    logs,
    abort,
    state,
    calls,
    options,
    answerAt,
    report: null,
    send: (event) => socket.serverSends(event),
    readback: () => socket.serverSends(script.readback(EXPECTED)),
  };
  void runCallController(options).then((report) => {
    h.report = report;
  });
  return h;
}

function creates(h: Harness): ControlEvent[] {
  return h.socket.sentOfType("response.create");
}

function greetingCreates(h: Harness): ControlEvent[] {
  return creates(h).filter((event) => (event.response as { instructions?: unknown } | undefined)?.instructions === GREETING);
}

function plainCreates(h: Harness): ControlEvent[] {
  return creates(h).filter((event) => event.response === undefined);
}

function outputs(h: Harness): Array<{ call_id: unknown; output: unknown }> {
  return h.socket
    .sentOfType("conversation.item.create")
    .map((event) => event.item as { type: string; call_id: unknown; output: unknown })
    .filter((item) => item.type === "function_call_output");
}

function instructionUpdates(h: Harness): ControlEvent[] {
  return h.socket.sentOfType("session.update").filter((event) => (event.session as { instructions?: unknown }).instructions !== undefined);
}

function ofType<T extends CallStreamEvent["type"]>(h: Harness, type: T): Array<Extract<CallStreamEvent, { type: T }>> {
  return h.events.filter((event): event is Extract<CallStreamEvent, { type: T }> => event.type === type);
}

function statuses(h: Harness): string[] {
  return ofType(h, "status").map((event) => event.status);
}

function captions(h: Harness, id?: string): Array<Extract<CallStreamEvent, { type: "caption" }>> {
  return ofType(h, "caption").filter((event) => id === undefined || event.id === id);
}

/** The ended / error frames the browser got. */
function terminal(h: Harness): CallStreamEvent[] {
  return h.events.filter((event) => event.type === "ended" || event.type === "error");
}

function warnings(h: Harness, warn: string): Record<string, unknown>[] {
  return h.logs.filter((fields) => fields.warn === warn);
}

/** Waits for the report (the end sequence runs on the fake clock). */
async function ended(h: Harness, ms = 0): Promise<CallEndReport> {
  await h.clock.advance(ms);
  assert.ok(h.report !== null, "the controller has not ended");
  return h.report;
}

/** Socket open, read-back, ready seen: the greeting goes out (not yet answered). */
async function greet(h: Harness): Promise<void> {
  await h.clock.advance(0);
  h.readback();
  h.state.ready = true;
  await h.clock.advance(READY_POLL_MS);
  assert.equal(greetingCreates(h).length, 1, "the greeting was not sent");
}

/** The greeting has been said: the call is live and idle. */
async function goLive(h: Harness): Promise<void> {
  await greet(h);
  h.send(script.responseCreated("resp_greet"));
  h.send(script.audioStarted("resp_greet"));
  h.send(script.responseDone("resp_greet"));
  h.send(script.audioStopped("resp_greet"));
  await h.clock.advance(0);
}

/** end_call ran; its round's response.create (the goodbye) has gone out. */
async function toGoodbye(h: Harness): Promise<void> {
  await goLive(h);
  h.send(script.responseCreated("resp_1"));
  h.send(script.functionCall("resp_1", "call_end", "end_call"));
  await h.clock.advance(0);
  h.send(script.responseDone("resp_1", { usage: usageOf({ inText: 50, outText: 5 }) }));
  await h.clock.advance(0);
  assert.equal(plainCreates(h).length, 1, "the goodbye response.create was not sent");
  assert.equal(h.report, null);
}

describe("call controller: opening and greeting", () => {
  it("sends the read-back first and greets after the ready signal", async () => {
    const h = harness();
    await h.clock.advance(0);
    assert.deepEqual(h.socket.sent[0], { type: "session.update", event_id: "mva_1", session: { type: "realtime" } });
    h.readback();
    await h.clock.advance(READY_POLL_MS * 4);
    assert.equal(creates(h).length, 0, "no greeting before the ready signal");
    h.state.ready = true;
    await h.clock.advance(READY_POLL_MS);
    const greeting = greetingCreates(h);
    assert.equal(greeting.length, 1);
    assert.match(String(greeting[0].event_id), /^mva_\d+$/);
    assert.deepEqual(greeting[0].response, { instructions: GREETING });
    assert.equal(h.report, null);
  });

  it("greets after four seconds when the ready signal never comes", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(READY_FALLBACK_MS - 100);
    assert.equal(creates(h).length, 0);
    await h.clock.advance(100);
    assert.equal(greetingCreates(h).length, 1);
    // After a fallback greeting the ready poll goes on, slower, and stops after 15 s.
    const before = h.calls.pollReady;
    await h.clock.advance(READY_LATE_POLL_MS * 3);
    assert.ok(h.calls.pollReady - before >= 2 && h.calls.pollReady - before <= 4);
    await h.clock.advance(READY_POLL_STOP_MS);
    const stopped = h.calls.pollReady;
    await h.clock.advance(20_000);
    assert.equal(h.calls.pollReady, stopped);
  });

  it("repeats a fallback greeting that produced no audio once the ready signal arrives, and only once", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(READY_FALLBACK_MS);
    assert.equal(greetingCreates(h).length, 1);
    h.send(script.responseCreated("resp_greet_1"));
    h.send(script.responseDone("resp_greet_1"));
    await h.clock.advance(READY_LATE_POLL_MS * 2);
    assert.equal(greetingCreates(h).length, 1, "not repeated before the browser is ready");
    h.state.ready = true;
    await h.clock.advance(READY_LATE_POLL_MS);
    assert.equal(greetingCreates(h).length, 2);
    h.send(script.responseCreated("resp_greet_2"));
    h.send(script.responseDone("resp_greet_2"));
    await h.clock.advance(READY_LATE_POLL_MS * 5);
    assert.equal(greetingCreates(h).length, 2, "a second silent greeting is not repeated");
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.greetings, 2);
    assert.equal(report.greetMs, -1);
  });

  it("does not repeat a greeting that the browser heard", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(READY_FALLBACK_MS);
    h.send(script.responseCreated("resp_greet_1"));
    h.send(script.audioStarted("resp_greet_1"));
    h.send(script.responseDone("resp_greet_1"));
    h.state.ready = true;
    await h.clock.advance(READY_LATE_POLL_MS * 3);
    assert.equal(greetingCreates(h).length, 1);
  });

  it("does not greet, and ends, when the session was closed before the greeting", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.readback();
    h.state.closed = true;
    h.state.ready = true;
    const report = await ended(h, READY_POLL_MS);
    assert.equal(report.reason, "user");
    assert.equal(creates(h).length, 0);
    assert.equal(h.calls.confirm, 0);
    assert.equal(report.confirmedAt, null);
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "user" }]);
    assert.equal(h.calls.hangUp, 1);
  });

  it("charges the call once, right before the greeting", async () => {
    const h = harness();
    await goLive(h);
    assert.equal(h.calls.confirm, 1);
    assert.deepEqual(h.calls.createsAtConfirm, [0], "confirmed before any response.create");
    const remaining = ofType(h, "remaining");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].seconds, 179);
    const remainingAt = h.events.findIndex((event) => event.type === "remaining");
    assert.equal(remainingAt, 0, "the remaining time is the first frame");
    // Later responses, tools and a duplicate greeting answer never charge again.
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(1_000);
    assert.equal(h.calls.confirm, 1);
    const report = await ended(h, 180_000);
    assert.equal(report.confirmedAt, h.answerAt + READY_POLL_MS);
  });

  it("a caller who speaks before the greeting: confirms at that response, sends no greeting, counts it as foreign", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(1_000);
    h.send(script.speechStarted());
    h.send(script.speechStopped());
    h.send(script.responseCreated("resp_caller"));
    await h.clock.advance(0);
    assert.equal(h.calls.confirm, 1);
    assert.equal(ofType(h, "remaining").length, 1);
    h.send(script.responseDone("resp_caller"));
    h.state.ready = true;
    await h.clock.advance(READY_FALLBACK_MS * 3);
    assert.equal(creates(h).length, 0, "no greeting after the caller's own response");
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.foreign, 1);
    assert.equal(report.greetings, 0);
    assert.equal(report.confirmedAt, h.answerAt + 1_000);
    assert.equal(report.responses, 1);
  });

  it("a response before the read-back confirms too, and the call goes live once the read-back passes", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.send(script.responseCreated("resp_caller"));
    await h.clock.advance(0);
    assert.equal(h.calls.confirm, 1);
    h.readback();
    h.state.ready = true;
    await h.clock.advance(READY_FALLBACK_MS * 2);
    assert.equal(creates(h).length, 0);
    assert.equal(h.report, null, "the read-back passed: no control failure");
  });

  it("the greeting state follows the greeting's own response id", async () => {
    const h = harness();
    await greet(h);
    h.send(script.responseCreated("resp_greet"));
    // Audio and an end of some other response do not count for the greeting.
    h.send(script.audioStarted("resp_other"));
    h.send(script.audioStopped("resp_other"));
    h.send(script.responseDone("resp_other"));
    await h.clock.advance(500);
    h.send(script.audioStarted("resp_greet"));
    await h.clock.advance(GREETING_GUARD_MS);
    assert.equal(warnings(h, "call_greeting_silent").length, 0);
    h.send(script.responseDone("resp_greet"));
    h.send(script.audioStopped("resp_greet"));
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.greetMs, 500);
    assert.equal(report.greetings, 1);
  });

  it("goes live with status listening when the greeting stays silent past its guard", async () => {
    const h = harness();
    await greet(h);
    await h.clock.advance(GREETING_GUARD_MS - 1);
    assert.equal(warnings(h, "call_greeting_silent").length, 0);
    await h.clock.advance(1);
    assert.deepEqual(warnings(h, "call_greeting_silent"), [{ warn: "call_greeting_silent", tenant: TENANT }]);
    assert.deepEqual(statuses(h), ["listening"]);
    assert.equal(h.report, null);
  });

  it("re-sends a refused greeting once although no response is active", async () => {
    const h = harness();
    await greet(h);
    const first = String(greetingCreates(h)[0].event_id);
    h.send(script.error("conversation_already_has_active_response", first));
    await h.clock.advance(RESEND_DELAY_MS - 1);
    assert.equal(greetingCreates(h).length, 1);
    await h.clock.advance(1);
    assert.equal(greetingCreates(h).length, 2);
    const second = String(greetingCreates(h)[1].event_id);
    assert.notEqual(second, first);
    h.send(script.error("conversation_already_has_active_response", second));
    await h.clock.advance(RESEND_DELAY_MS * 10);
    assert.equal(greetingCreates(h).length, 2, "a second refusal gives up");
    assert.deepEqual(warnings(h, "call_openai_error"), [
      { warn: "call_openai_error", code: "conversation_already_has_active_response", tenant: TENANT },
    ]);
  });

  it("re-sends a refused response.create after the active response is done", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    await h.clock.advance(0);
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(0);
    assert.equal(plainCreates(h).length, 1);
    // The caller's own response got in first: ours is refused while that one is active.
    h.send(script.responseCreated("resp_caller"));
    h.send(script.error("conversation_already_has_active_response", String(plainCreates(h)[0].event_id)));
    await h.clock.advance(RESEND_DELAY_MS * 4);
    assert.equal(plainCreates(h).length, 1, "not re-sent while a response is active");
    h.send(script.responseDone("resp_caller"));
    await h.clock.advance(0);
    assert.equal(plainCreates(h).length, 2);
  });

  it("treats a response.create that gets neither response.created nor an error as refused: re-sent once, and the queue goes on", async () => {
    const firstTool = deferred<ToolOutcome>();
    const secondTool = deferred<ToolOutcome>();
    const h = harness({ runTool: (call) => (call.id === "call_1" ? firstTool.promise : secondTool.promise) });
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    h.send(script.responseDone("resp_1"));
    h.send(script.responseCreated("resp_2"));
    h.send(script.functionCall("resp_2", "call_2", "check_availability"));
    h.send(script.responseDone("resp_2"));
    firstTool.resolve(ok());
    await h.clock.advance(0);
    secondTool.resolve(ok());
    await h.clock.advance(0);
    // The first round's create is in flight and gets no answer; the second waits behind it.
    assert.equal(plainCreates(h).length, 1);
    const first = String(plainCreates(h)[0].event_id);
    await h.clock.advance(CREATE_ANSWER_MS - 1);
    assert.equal(plainCreates(h).length, 1, "still waiting for the answer");
    await h.clock.advance(1);
    assert.equal(plainCreates(h).length, 2, "the queued create goes out");
    const second = String(plainCreates(h)[1].event_id);
    h.send(script.responseCreated("resp_3"));
    h.send(script.responseDone("resp_3"));
    await h.clock.advance(RESEND_DELAY_MS);
    // The unanswered one is sent once more.
    assert.equal(plainCreates(h).length, 3);
    const resent = String(plainCreates(h)[2].event_id);
    assert.ok(resent !== first && resent !== second);
    // No answer again: given up, nothing more is sent, the call goes on.
    await h.clock.advance(CREATE_ANSWER_MS + RESEND_DELAY_MS * 4);
    assert.equal(plainCreates(h).length, 3, "a second unanswered create is given up");
    assert.equal(h.report, null);
    // An answer that comes late is still handled as a response.
    h.send(script.responseCreated("resp_late"));
    h.send(script.responseDone("resp_late"));
    await h.clock.advance(0);
    assert.equal(h.report, null);
  });
});

describe("call controller: control socket and tripwires", () => {
  it("hangs up through the REST hook when the control socket does not open", async () => {
    for (const code of ["timeout", "upstream", "no_websocket"] as const) {
      const h = harness({ openControl: openControlFails(code) });
      const report = await ended(h);
      assert.equal(report.reason, "control");
      assert.equal(h.calls.hangUp, 1);
      assert.equal(h.calls.confirm, 0);
      assert.deepEqual(terminal(h), [{ type: "error", code: "upstream" }]);
      assert.deepEqual(warnings(h, "call_control_failed"), [{ warn: "call_control_failed", code, tenant: TENANT }]);
    }
  });

  it("bounds an open that never answers, and closes a socket that opens after the end", async () => {
    const hanging = harness({ openControl: () => new Promise<OpenControlResult>(() => {}) });
    await hanging.clock.advance(CONTROL_OPEN_TIMEOUT_MS - 1);
    assert.equal(hanging.report, null);
    const report = await ended(hanging, 1);
    assert.equal(report.reason, "control");
    assert.equal(hanging.calls.hangUp, 1);

    const late = createFakeControlSocket();
    const clock = createFakeClock();
    const h = harness(
      {
        deadlineAt: clock.now() + 2_000,
        openControl: () => new Promise<OpenControlResult>((resolve) => clock.setTimeout(() => resolve({ ok: true, socket: late }), 4_000)),
      },
      clock,
    );
    const timedOut = await ended(h, 2_000);
    assert.equal(timedOut.reason, "timeout");
    await h.clock.advance(3_000);
    assert.deepEqual(late.closeCalls, [1000]);
    assert.equal(late.sent.length, 0);
  });

  it("ends with control when the read-back never comes", async () => {
    const h = harness();
    await h.clock.advance(READBACK_TIMEOUT_MS - 1);
    assert.equal(h.report, null);
    const report = await ended(h, 1);
    assert.equal(report.reason, "control");
    assert.deepEqual(warnings(h, "call_control_failed"), [{ warn: "call_control_failed", code: "no_readback", tenant: TENANT }]);
    assert.equal(creates(h).length, 0);
    assert.equal(h.calls.hangUp, 1);
  });

  it("ends on a read-back with tracing on, the wrong instructions length or the wrong tool count", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ tracing: "auto" }, "readback_tracing"],
      [{ tracing: undefined }, "readback_tracing"],
      [{ instructions: "x".repeat(EXPECTED.instructionsChars + 1) }, "readback_instructions"],
      [{ instructions: null }, "readback_instructions"],
      [{ tools: [] }, "readback_tools"],
      [{ tools: "none" }, "readback_tools"],
    ];
    for (const [override, code] of cases) {
      const h = harness();
      await h.clock.advance(0);
      h.send(script.readback(EXPECTED, override));
      h.state.ready = true;
      const report = await ended(h, READY_POLL_MS);
      assert.equal(report.reason, "tripwire", code);
      assert.equal(report.tripwire, code);
      assert.deepEqual(terminal(h), [{ type: "ended", reason: "error" }]);
      assert.deepEqual(warnings(h, "call_tripwire"), [{ warn: "call_tripwire", code, tenant: TENANT }]);
      assert.equal(creates(h).length, 0, "no greeting after a failed read-back");
      assert.equal(h.calls.hangUp, 1);
    }
  });

  it("ends on a session.updated it did not cause", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.sessionUpdated());
    const report = await ended(h);
    assert.equal(report.reason, "tripwire");
    assert.equal(report.tripwire, "foreign_update");
    assert.equal(h.calls.hangUp, 1);
  });

  it("a refused instructions update does not mask a later foreign update", async () => {
    const start = Date.UTC(2026, 11, 2, 9);
    const options = { deadlineAt: start + 60_000, limits: { warnBeforeEndSeconds: 50, silenceTimeoutSeconds: 300, maxTurnChars: 200 } };

    // Its echo is ours: nothing happens.
    const echoed = harness(options);
    await goLive(echoed);
    await echoed.clock.advance(10_000);
    assert.equal(instructionUpdates(echoed).length, 1);
    echoed.send(script.sessionUpdated());
    await echoed.clock.advance(0);
    assert.equal(echoed.report, null);

    // Refused: it will never be echoed, so the next session.updated is foreign.
    const h = harness(options);
    await goLive(h);
    await h.clock.advance(10_000);
    const update = instructionUpdates(h);
    assert.equal(update.length, 1);
    h.send(script.error("invalid_value", String(update[0].event_id)));
    await h.clock.advance(0);
    assert.equal(h.report, null);
    h.send(script.sessionUpdated());
    const report = await ended(h);
    assert.equal(report.tripwire, "foreign_update");
  });

  it("ends on a user text item it did not create", async () => {
    const h = harness();
    await goLive(h);
    // Items the model or the caller's audio add are fine.
    h.send({ type: "conversation.item.added", item: { type: "message", role: "user", content: [{ type: "input_audio" }] } });
    h.send({ type: "conversation.item.added", item: { type: "message", role: "assistant", content: [{ type: "output_text" }] } });
    await h.clock.advance(0);
    assert.equal(h.report, null);
    h.send(script.userTextItem());
    const report = await ended(h);
    assert.equal(report.reason, "tripwire");
    assert.equal(report.tripwire, "foreign_item");
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "error" }]);
  });
});

describe("call controller: turns, status and captions", () => {
  it("maps speech, playback and barge-in to status, activity and interrupted events", async () => {
    const h = harness();
    await goLive(h);
    const from = h.events.length;
    h.send(script.speechStarted());
    h.send(script.speechStopped());
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    h.send(script.responseDone("resp_1"));
    h.send(script.speechStarted());
    h.send(script.audioCleared("resp_1"));
    h.send(script.speechStopped());
    h.send(script.responseCreated("resp_2"));
    h.send(script.audioStarted("resp_2"));
    h.send(script.responseDone("resp_2"));
    h.send(script.audioStopped("resp_2"));
    await h.clock.advance(0);
    const seen = h.events
      .slice(from)
      .filter((event) => event.type === "status" || event.type === "activity" || event.type === "interrupted")
      .map((event) => (event.type === "status" ? event.status : event.type === "activity" ? `activity:${event.speech}` : event.type));
    assert.deepEqual(seen, [
      "activity:started",
      "activity:stopped",
      "thinking",
      "speaking",
      "activity:started",
      "interrupted",
      "activity:stopped",
      "thinking",
      "speaking",
      "listening",
    ]);
  });

  it("sends no listening while the caller is speaking, also when the cut response is done", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    const from = h.events.length;
    // A barge-in: the caller starts, the reply's audio is cleared, its response ends cancelled.
    h.send(script.speechStarted());
    h.send(script.audioCleared("resp_1"));
    h.send(script.responseDone("resp_1", { status: "cancelled" }));
    // A response that ends by itself while the caller still speaks.
    h.send(script.responseCreated("resp_2"));
    h.send(script.responseDone("resp_2"));
    await h.clock.advance(5_000);
    const during = h.events.slice(from);
    assert.deepEqual(
      during.filter((event) => event.type === "status"),
      [],
      "no status frame between speech_started and speech_stopped",
    );
    // After speech_stopped the usual rules apply again.
    h.send(script.speechStopped());
    assert.deepEqual(statuses(h).slice(-1), ["thinking"]);
    h.send(script.responseCreated("resp_3"));
    h.send(script.responseDone("resp_3"));
    await h.clock.advance(0);
    assert.deepEqual(statuses(h).slice(-1), ["listening"]);
  });

  it("sends thinking, not listening, when the commentary stops while its tool runs", async () => {
    const tool = deferred<ToolOutcome>();
    const h = harness({ runTool: () => tool.promise });
    await goLive(h);
    const from = h.events.length;
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    h.send(script.responseDone("resp_1"));
    h.send(script.audioStopped("resp_1"));
    await h.clock.advance(0);
    const after = h.events.slice(from).filter((event) => event.type === "status").map((event) => (event as { status: string }).status);
    assert.deepEqual(after, ["speaking", "thinking"]);
    tool.resolve(ok());
    await h.clock.advance(0);
    assert.equal(outputs(h).length, 1);
    assert.equal(plainCreates(h).length, 1);
  });

  it("puts a late caller caption before the reply it belongs to", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.committed("item_c1"));
    h.send(script.assistantDelta("item_a1", "Gladly"));
    h.send(script.callerDelta("item_c1", "I would"));
    const long = `I would like a callback, my name is ${TEST_PERSON}, ${TEST_PHONE}. ${"more ".repeat(100)}`;
    h.send(script.callerCompleted("item_c1", `  ${long}  `, { languages: [{ code: "de" }] }));
    await h.clock.advance(0);
    const lines = captions(h);
    assert.deepEqual(lines[0], { type: "caption", id: "a-1", role: "assistant", text: "Gladly", final: false });
    assert.deepEqual(lines[1], { type: "caption", id: "c-1", role: "caller", text: "I would", final: false, before: "a-1" });
    assert.deepEqual(lines[2], {
      type: "caption",
      id: "c-1",
      role: "caller",
      text: long.trim().slice(0, 200),
      final: true,
      before: "a-1",
      locale: "de",
    });
  });

  it("sends two caller lines in commit order", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.committed("item_c1"));
    h.send(script.committed("item_c2"));
    h.send(script.callerDelta("item_c2", "second"));
    h.send(script.callerCompleted("item_c2", "second line"));
    await h.clock.advance(0);
    assert.equal(captions(h).length, 0, "held until the earlier line is shown");
    h.send(script.callerDelta("item_c1", "first"));
    await h.clock.advance(0);
    assert.deepEqual(
      captions(h).map((c) => [c.id, c.text, c.final]),
      [
        ["c-1", "first", false],
        ["c-2", "second line", true],
      ],
    );
    h.send(script.callerCompleted("item_c1", "first line"));
    await h.clock.advance(0);
    assert.deepEqual(captions(h, "c-1").at(-1), { type: "caption", id: "c-1", role: "caller", text: "first line", final: true });

    // A held line is released CALLER_HOLD_MS after its own completion if the earlier one never comes.
    h.send(script.committed("item_c3"));
    h.send(script.committed("item_c4"));
    h.send(script.callerCompleted("item_c4", "fourth line"));
    await h.clock.advance(CALLER_HOLD_MS - 1);
    assert.equal(captions(h, "c-4").length, 0);
    await h.clock.advance(1);
    assert.deepEqual(captions(h, "c-4"), [{ type: "caption", id: "c-4", role: "caller", text: "fourth line", final: true }]);
  });

  it("removes a caller line whose transcription failed or came back empty", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.committed("item_c1"));
    h.send(script.callerDelta("item_c1", "Hel"));
    h.send(script.callerFailed("item_c1"));
    h.send(script.committed("item_c2"));
    h.send(script.callerCompleted("item_c2", "   "));
    h.send(script.committed("item_c3"));
    h.send(script.callerDelta("item_c3", "uh"));
    h.send(script.callerCompleted("item_c3", ""));
    h.send(script.committed("item_c4"));
    h.send(script.callerCompleted("item_c4", "fourth"));
    await h.clock.advance(0);
    assert.deepEqual(
      captions(h).map((c) => [c.id, c.text, c.final]),
      [
        ["c-1", "Hel", false],
        ["c-1", "", true],
        ["c-3", "uh", false],
        ["c-3", "", true],
        ["c-4", "fourth", true],
      ],
    );
  });

  it("streams assistant captions as one growing line per item, final at done", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.assistantDelta("item_a1", "Good"));
    h.send(script.assistantDelta("item_a1", " morn"));
    h.send(script.assistantDelta("item_a1", "ing"));
    await h.clock.advance(0);
    assert.deepEqual(captions(h, "a-1").map((c) => c.text), ["Good"], "throttled");
    await h.clock.advance(CAPTION_THROTTLE_MS);
    assert.deepEqual(captions(h, "a-1").map((c) => c.text), ["Good", "Good morning"]);
    h.send(script.assistantDone("item_a1", "Good morning."));
    h.send(script.assistantDelta("item_a2", "How"));
    await h.clock.advance(CAPTION_THROTTLE_MS * 2);
    assert.deepEqual(captions(h, "a-1").at(-1), { type: "caption", id: "a-1", role: "assistant", text: "Good morning.", final: true });
    assert.equal(captions(h, "a-1").length, 3, "no frame after the final one");
    assert.deepEqual(captions(h, "a-2"), [{ type: "caption", id: "a-2", role: "assistant", text: "How", final: false }]);
    // Capped at 2 000 characters.
    h.send(script.assistantDelta("item_a3", "z".repeat(2_500)));
    await h.clock.advance(0);
    assert.equal(captions(h, "a-3")[0].text.length, 2_000);
  });

  it("marks the cut reply on a barge-in and ignores its later transcript", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    h.send(script.assistantDelta("item_a1", "I can offer", "resp_1"));
    h.send(script.speechStarted());
    h.send(script.audioCleared("resp_1"));
    h.send(script.assistantDone("item_a1", "I can offer you Tuesday at nine.", "resp_1"));
    await h.clock.advance(CAPTION_THROTTLE_MS);
    assert.deepEqual(
      captions(h, "a-1").map((c) => [c.text, c.final]),
      [
        ["I can offer", false],
        ["I can offer …", true],
      ],
    );
    const cutAt = h.events.findIndex((event) => event.type === "caption" && event.final);
    assert.equal(h.events[cutAt + 1].type, "interrupted");
  });

  it("marks the lines of a cut reply whose transcript was already final, once, and leaves earlier replies alone", async () => {
    const h = harness();
    await greet(h);
    // The greeting, fully heard.
    h.send(script.responseCreated("resp_greet"));
    h.send(script.audioStarted("resp_greet"));
    h.send(script.assistantDelta("item_g", "Hello.", "resp_greet"));
    h.send(script.assistantDone("item_g", "Hello.", "resp_greet"));
    h.send(script.responseDone("resp_greet"));
    h.send(script.audioStopped("resp_greet"));
    await h.clock.advance(0);
    // The real order: the transcript ends long before the audio, then the caller cuts in.
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    h.send(script.assistantDelta("item_a1", "I can offer", "resp_1"));
    h.send(script.assistantDone("item_a1", "I can offer you Tuesday at nine.", "resp_1"));
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(1_000);
    h.send(script.speechStarted());
    h.send(script.audioCleared("resp_1"));
    h.send(script.audioCleared("resp_1"));
    await h.clock.advance(CAPTION_THROTTLE_MS);
    assert.deepEqual(
      captions(h, "a-2").map((c) => [c.text, c.final]),
      [
        ["I can offer", false],
        ["I can offer you Tuesday at nine.", true],
        ["I can offer you Tuesday at nine. …", true],
      ],
    );
    const cutAt = h.events.findIndex((event) => event.type === "caption" && event.id === "a-2" && event.text.endsWith(" …"));
    assert.equal(h.events[cutAt + 1].type, "interrupted");
    assert.deepEqual(
      captions(h, "a-1").map((c) => [c.text, c.final]),
      [
        ["Hello.", false],
        ["Hello.", true],
      ],
      "the earlier reply is never marked",
    );
  });
});

describe("call controller: tools", () => {
  it("runs a tool once, forwards name and outcome, then sends its output and one response.create after the response is done", async () => {
    const h = harness();
    await goLive(h);
    const args = { name: TEST_PERSON, phone: TEST_PHONE };
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "request_callback", args));
    h.send(script.functionCall("resp_1", "call_1", "request_callback", args));
    await h.clock.advance(0);
    assert.equal(h.calls.tools.length, 1);
    assert.deepEqual(h.calls.tools[0], { id: "call_1", name: "request_callback", input: args });
    assert.deepEqual(ofType(h, "tool"), [
      { type: "tool", name: "request_callback", status: "started" },
      { type: "tool", name: "request_callback", status: "ok" },
    ]);
    assert.equal(outputs(h).length, 0, "nothing goes out before the response is done");
    assert.equal(plainCreates(h).length, 0);
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(0);
    assert.deepEqual(outputs(h), [{ type: "function_call_output", call_id: "call_1", output: JSON.stringify(ok()) }]);
    assert.equal(plainCreates(h).length, 1);
    const sentTypes = h.socket.sent.map((event) => event.type);
    assert.ok(sentTypes.lastIndexOf("conversation.item.create") < sentTypes.lastIndexOf("response.create"));
    // The tool's arguments never reach the browser or a log line.
    const visible = JSON.stringify([h.events, h.logs]);
    assert.ok(!visible.includes(TEST_PHONE) && !visible.includes(TEST_PERSON));
    h.abort.abort();
    assert.equal((await ended(h)).tools, 1);
  });

  it("runs two function calls of one response one after the other", async () => {
    const first = deferred<ToolOutcome>();
    const second = deferred<ToolOutcome>();
    const started: string[] = [];
    const h = harness({
      runTool: (call) => {
        started.push(call.id);
        return call.id === "call_1" ? first.promise : second.promise;
      },
    });
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    h.send(script.functionCall("resp_1", "call_2", "book_appointment"));
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(0);
    assert.deepEqual(started, ["call_1"]);
    first.resolve(ok("first"));
    await h.clock.advance(0);
    assert.deepEqual(started, ["call_1", "call_2"]);
    assert.equal(outputs(h).length, 0, "the outputs of one response go out together");
    second.resolve({ ok: false, code: "not_available", say: "second" });
    await h.clock.advance(0);
    assert.deepEqual(
      outputs(h).map((o) => o.call_id),
      ["call_1", "call_2"],
    );
    assert.equal(plainCreates(h).length, 1);
    assert.deepEqual(
      ofType(h, "tool").map((t) => `${t.name}:${t.status}`),
      ["check_availability:started", "check_availability:ok", "book_appointment:started", "book_appointment:failed"],
    );
  });

  it("sends a handoff event for a callback outcome", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "request_callback", { name: TEST_PERSON }));
    await h.clock.advance(0);
    assert.deepEqual(ofType(h, "handoff"), [{ type: "handoff", handoff: { kind: "callback" } }]);
  });

  it("refreshes the instructions after a tool outcome and at the end warning", async () => {
    const h = harness({
      runTool: (call) =>
        Promise.resolve(call.id === "call_2" ? { ok: false as const, code: "not_available" as const, say: "No slot." } : ok()),
    });
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    await h.clock.advance(0);
    const afterTool = instructionUpdates(h);
    assert.equal(afterTool.length, 1);
    assert.deepEqual(afterTool[0].session, { type: "realtime", instructions: "instructions with 179 seconds left" });
    h.send(script.sessionUpdated());
    h.send(script.responseDone("resp_1"));
    // A failed tool adds no outcome: no update.
    h.send(script.responseCreated("resp_2"));
    h.send(script.functionCall("resp_2", "call_2", "check_availability"));
    await h.clock.advance(0);
    assert.equal(instructionUpdates(h).length, 1, "a failed outcome refreshes nothing");
    await h.clock.advance(150_000 - (h.clock.now() - h.answerAt));
    const all = instructionUpdates(h);
    assert.equal(all.length, 2);
    assert.deepEqual(all[1].session, { type: "realtime", instructions: "instructions with 30 seconds left" });
    h.send(script.sessionUpdated());
    await h.clock.advance(0);
    assert.equal(h.report, null, "our own echoes are no tripwire");
  });

  it("queues a response.create while a response is active", async () => {
    const tool = deferred<ToolOutcome>();
    const h = harness({ runTool: () => tool.promise });
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "check_availability"));
    h.send(script.responseDone("resp_1"));
    h.send(script.responseCreated("resp_caller"));
    tool.resolve(ok());
    await h.clock.advance(0);
    assert.equal(outputs(h).length, 1);
    assert.equal(plainCreates(h).length, 0, "queued while the caller's response is active");
    h.send(script.responseDone("resp_caller"));
    await h.clock.advance(0);
    assert.equal(plainCreates(h).length, 1);
  });

  it("exposes the running tool so the end can wait for it", async () => {
    const tool = deferred<ToolOutcome>();
    const started: string[] = [];
    const h = harness({
      runTool: (call) => {
        started.push(call.id);
        return tool.promise;
      },
    });
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.functionCall("resp_1", "call_1", "request_callback"));
    h.send(script.functionCall("resp_1", "call_2", "check_availability"));
    h.send(script.responseDone("resp_1"));
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.reason, "unload");
    assert.equal(h.calls.hangUp, 1, "the hang-up does not wait for the tool");
    let drained = false;
    void report.toolDone.then(() => {
      drained = true;
    });
    await h.clock.advance(0);
    assert.equal(drained, false);
    const sentBefore = h.socket.sent.length;
    const eventsBefore = h.events.length;
    tool.resolve(ok());
    await h.clock.advance(0);
    assert.equal(drained, true);
    assert.equal(h.socket.sent.length, sentBefore, "no output goes to the provider after the end");
    assert.equal(h.events.length, eventsBefore, "nothing goes to the browser after the end");
    assert.equal(report.tools, 1, "the queued second call never starts");
    // Nor afterwards: a function call that reaches us once the call has ended starts no tool.
    h.send(script.functionCall("resp_1", "call_3", "request_callback"));
    await h.clock.advance(10_000);
    assert.deepEqual(started, ["call_1"], "no tool runs after the end");
  });
});

describe("call controller: the goodbye", () => {
  it("after end_call, ends only when the goodbye has stopped playing, after the tail", async () => {
    const h = harness();
    await toGoodbye(h);
    assert.equal(instructionUpdates(h).length, 0, "end_call refreshes no instructions");
    h.send(script.responseCreated("resp_bye"));
    h.send(script.audioStarted("resp_bye"));
    h.send(script.responseDone("resp_bye"));
    await h.clock.advance(1_000);
    assert.equal(h.report, null, "audio still playing");
    h.send(script.audioStopped("resp_bye"));
    await h.clock.advance(0);
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "assistant" }]);
    await h.clock.advance(GOODBYE_TAIL_MS - 1);
    assert.equal(h.calls.hangUp, 0, "the tail comes before the hang-up");
    const report = await ended(h, 1);
    assert.equal(report.reason, "assistant");
    assert.equal(h.calls.hangUp, 1);
    assert.deepEqual(h.socket.closeCalls, [1000]);
  });

  it("after end_call, ends at once when the goodbye response has no audio", async () => {
    for (const usage of [usageOf({ inText: 10, outText: 5, outAudio: 0 }), null]) {
      const h = harness();
      await toGoodbye(h);
      h.send(script.responseCreated("resp_bye"));
      h.send(script.responseDone("resp_bye", { usage }));
      const report = await ended(h, GOODBYE_TAIL_MS);
      assert.equal(report.reason, "assistant");
      assert.equal(h.calls.hangUp, 1);
    }
  });

  it("after end_call, ends when the goodbye is cut by the caller", async () => {
    const h = harness();
    await toGoodbye(h);
    h.send(script.responseCreated("resp_bye"));
    h.send(script.audioStarted("resp_bye"));
    h.send(script.speechStarted());
    h.send(script.audioCleared("resp_bye"));
    const report = await ended(h, GOODBYE_TAIL_MS);
    assert.equal(report.reason, "assistant");

    // Cancelled before any audio: ends too.
    const cancelled = harness();
    await toGoodbye(cancelled);
    cancelled.send(script.responseCreated("resp_bye"));
    cancelled.send(script.responseDone("resp_bye", { status: "cancelled" }));
    assert.equal((await ended(cancelled, GOODBYE_TAIL_MS)).reason, "assistant");
  });

  it("after end_call, ends after the guard when the goodbye never plays", async () => {
    const h = harness();
    await toGoodbye(h);
    await h.clock.advance(GOODBYE_GUARD_MS - 1);
    assert.equal(h.report, null);
    await h.clock.advance(1);
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "assistant" }]);
    const report = await ended(h, GOODBYE_TAIL_MS);
    assert.equal(report.reason, "assistant");
    assert.equal(h.calls.hangUp, 1);
  });

  it("the end of an earlier reply's audio does not end the goodbye", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    h.send(script.functionCall("resp_1", "call_end", "end_call"));
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(0);
    h.send(script.responseCreated("resp_bye"));
    h.send(script.audioStopped("resp_1"));
    await h.clock.advance(0);
    assert.equal(h.report, null);
    h.send(script.audioStarted("resp_bye"));
    h.send(script.audioStopped("resp_bye"));
    assert.equal((await ended(h, GOODBYE_TAIL_MS)).reason, "assistant");
  });

  /** end_call said during a long reply: the goodbye is queued behind that reply's audio. */
  async function queuedGoodbye(h: Harness): Promise<void> {
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.audioStarted("resp_1"));
    h.send(script.functionCall("resp_1", "call_end", "end_call"));
    h.send(script.responseDone("resp_1"));
    await h.clock.advance(0);
    assert.equal(plainCreates(h).length, 1, "the goodbye response.create was not sent");
    h.send(script.responseCreated("resp_bye"));
    h.send(script.responseDone("resp_bye", { usage: usageOf({ inText: 50, outText: 5, outAudio: 80 }) }));
    await h.clock.advance(0);
  }

  it("a goodbye queued behind earlier audio is not cut by the guard: the call ends at its stopped", async () => {
    const h = harness();
    await queuedGoodbye(h);
    // No started for the goodbye, no stopped for the earlier reply: audio still plays.
    await h.clock.advance(GOODBYE_GUARD_MS + 3_000);
    assert.equal(h.report, null);
    assert.deepEqual(terminal(h), [], "the guard did not end the call while audio plays");
    h.send(script.audioStopped("resp_bye"));
    await h.clock.advance(0);
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "assistant" }]);
    const report = await ended(h, GOODBYE_TAIL_MS);
    assert.equal(report.reason, "assistant");
    assert.equal(h.calls.hangUp, 1);
  });

  it("the goodbye guard still ends the call at its ceiling when the audio never stops", async () => {
    const h = harness();
    await queuedGoodbye(h);
    const createdAt = h.clock.now();
    await h.clock.advance(GOODBYE_CEILING_MS - 1);
    assert.deepEqual(terminal(h), []);
    await h.clock.advance(1);
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "assistant" }]);
    const report = await ended(h, GOODBYE_TAIL_MS);
    assert.equal(report.reason, "assistant");
    assert.equal(report.endedAt, createdAt + GOODBYE_CEILING_MS);
    assert.equal(h.calls.hangUp, 1);
  });
});

describe("call controller: every other end", () => {
  it("ends at the deadline even when the greeting never produced a response", async () => {
    const start = Date.UTC(2026, 11, 2, 9);
    const h = harness({ deadlineAt: start + 6_000 });
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(READY_FALLBACK_MS);
    assert.equal(greetingCreates(h).length, 1);
    const report = await ended(h, 2_000);
    assert.equal(report.reason, "timeout");
    assert.equal(h.calls.hangUp, 1);
  });

  it("ends at the deadline in every state", async () => {
    const start = Date.UTC(2026, 11, 2, 9);
    // opening: the socket never opens (its own bound is longer than this deadline)
    const opening = harness({ deadlineAt: start + 2_000, openControl: () => new Promise<OpenControlResult>(() => {}) });
    assert.equal((await ended(opening, 2_000)).reason, "timeout");
    assert.equal(opening.calls.hangUp, 1);
    // waiting: no read-back yet
    const waiting = harness({ deadlineAt: start + 2_000 });
    assert.equal((await ended(waiting, 2_000)).reason, "timeout");
    assert.equal(waiting.calls.hangUp, 1);
    // greeting: sent, never answered
    const greeting = harness({ deadlineAt: start + 3_000 });
    await greet(greeting);
    assert.equal((await ended(greeting, 3_000)).reason, "timeout");
    // live, a tool running
    const tool = deferred<ToolOutcome>();
    const live = harness({ deadlineAt: start + 5_000, runTool: () => tool.promise });
    await goLive(live);
    live.send(script.responseCreated("resp_1"));
    live.send(script.functionCall("resp_1", "call_1", "check_availability"));
    assert.equal((await ended(live, 5_000)).reason, "timeout");
    assert.equal(live.calls.hangUp, 1);
    // goodbye, before its guard
    const goodbye = harness({ deadlineAt: start + 5_000 });
    await toGoodbye(goodbye);
    assert.equal((await ended(goodbye, 5_000)).reason, "timeout");
    assert.equal(goodbye.calls.hangUp, 1);
    for (const h of [opening, waiting, greeting, live, goodbye]) {
      assert.deepEqual(terminal(h), [{ type: "ended", reason: "timeout" }]);
    }
  });

  it("ends with timeout at the deadline and sends ended timeout", async () => {
    const h = harness();
    await goLive(h);
    await h.clock.advance(180_000 - (h.clock.now() - h.answerAt) - 1);
    assert.equal(h.report, null);
    const report = await ended(h, 1);
    assert.equal(report.reason, "timeout");
    assert.equal(report.endedAt, h.answerAt + 180_000);
    assert.deepEqual(h.events.at(-1), { type: "ended", reason: "timeout" });
    assert.equal(h.calls.hangUp, 1);
    assert.deepEqual(h.socket.closeCalls, [1000]);
    // Nothing runs any more: no poll, no timer.
    const polls = h.calls.pollClosed + h.calls.pollReady;
    await h.clock.advance(60_000);
    assert.equal(h.calls.pollClosed + h.calls.pollReady, polls);
    assert.equal(h.clock.pending(), 0);
  });

  it("ends with silence after the backstop, and not while the assistant speaks or a tool runs", async () => {
    const start = Date.UTC(2026, 11, 2, 9);
    const limits = { warnBeforeEndSeconds: 0, silenceTimeoutSeconds: 30, maxTurnChars: 200 };
    // max(30 + 20, 90) = 90 seconds.
    const idle = harness({ deadlineAt: start + 3_600_000, limits });
    await goLive(idle);
    await idle.clock.advance(90_000 - 1);
    assert.equal(idle.report, null);
    const report = await ended(idle, 1);
    assert.equal(report.reason, "silence");
    assert.deepEqual(terminal(idle), [{ type: "ended", reason: "silence" }]);

    // A long backstop follows the tenant's silence limit: 100 + 20 = 120 seconds.
    const long = harness({ deadlineAt: start + 3_600_000, limits: { ...limits, silenceTimeoutSeconds: 100 } });
    await goLive(long);
    await long.clock.advance(119_000);
    assert.equal(long.report, null);
    assert.equal((await ended(long, 1_000)).reason, "silence");

    const speaking = harness({ deadlineAt: start + 3_600_000, limits });
    await goLive(speaking);
    speaking.send(script.responseCreated("resp_1"));
    speaking.send(script.audioStarted("resp_1"));
    speaking.send(script.responseDone("resp_1"));
    await speaking.clock.advance(300_000);
    assert.equal(speaking.report, null, "not while audio plays");
    speaking.send(script.audioStopped("resp_1"));
    assert.equal((await ended(speaking, 90_000)).reason, "silence");

    const tool = deferred<ToolOutcome>();
    const busy = harness({ deadlineAt: start + 3_600_000, limits, runTool: () => tool.promise });
    await goLive(busy);
    busy.send(script.responseCreated("resp_1"));
    busy.send(script.functionCall("resp_1", "call_1", "check_availability"));
    busy.send(script.responseDone("resp_1"));
    await busy.clock.advance(300_000);
    assert.equal(busy.report, null, "not while a tool runs");
    tool.resolve(ok());
    await busy.clock.advance(0);
    busy.send(script.responseCreated("resp_2"));
    busy.send(script.responseDone("resp_2"));
    assert.equal((await ended(busy, 90_000)).reason, "silence");
  });

  it("ends with user when the closed marker appears, without sending a greeting afterwards", async () => {
    const h = harness();
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(1_000);
    h.state.closed = true;
    const report = await ended(h, CLOSED_POLL_MS);
    assert.equal(report.reason, "user");
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "user" }]);
    await h.clock.advance(READY_FALLBACK_MS * 2);
    assert.equal(creates(h).length, 0);
    assert.equal(h.calls.hangUp, 1);

    // During the call: ends within two seconds of the end report.
    const live = harness();
    await goLive(live);
    await live.clock.advance(10_000);
    live.state.closed = true;
    assert.equal((await ended(live, CLOSED_POLL_MS)).reason, "user");
  });

  it("ends with user, not provider, when the socket closes right after the end report", async () => {
    const h = harness();
    await goLive(h);
    h.state.closed = true;
    h.socket.drop();
    const report = await ended(h);
    assert.equal(report.reason, "user");
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "user" }]);
    assert.equal(h.calls.hangUp, 1, "a closed socket alone does not end the provider's call");
  });

  it("ends with provider when the socket closes, and tells the browser upstream", async () => {
    const h = harness();
    await goLive(h);
    h.socket.drop(1006);
    const report = await ended(h);
    assert.equal(report.reason, "provider");
    assert.deepEqual(terminal(h), [{ type: "error", code: "upstream" }]);
    assert.equal(h.calls.hangUp, 1);

    // A closed check that hangs counts as "not closed" after one second.
    const slow = harness({ pollClosed: () => new Promise<boolean>(() => {}) });
    await slow.clock.advance(0);
    slow.readback();
    await slow.clock.advance(READY_FALLBACK_MS + 1_000);
    assert.equal(greetingCreates(slow).length, 1, "the fresh check before the greeting is bounded too");
    slow.socket.drop();
    await slow.clock.advance(999);
    assert.equal(slow.report, null);
    assert.equal((await ended(slow, 1)).reason, "provider");
  });

  it("ends with unload when the signal aborts, sending nothing", async () => {
    const h = harness();
    await goLive(h);
    const before = h.events.length;
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.reason, "unload");
    assert.equal(h.events.length, before);
    assert.equal(h.calls.hangUp, 1);

    const early = new AbortController();
    early.abort();
    const aborted = harness({ signal: early.signal });
    assert.equal((await ended(aborted)).reason, "unload");
    assert.equal(aborted.events.length, 0);
    assert.equal(aborted.calls.hangUp, 1);
  });

  it("ends with limit above the response cap and above the cost cap", async () => {
    const capped = harness({ maxResponses: 3 });
    await goLive(capped); // response 1
    capped.send(script.responseCreated("resp_2"));
    capped.send(script.responseDone("resp_2"));
    capped.send(script.responseCreated("resp_3"));
    capped.send(script.responseDone("resp_3"));
    await capped.clock.advance(0);
    assert.equal(capped.report, null);
    capped.send(script.responseCreated("resp_4"));
    capped.send(script.responseDone("resp_4"));
    const report = await ended(capped);
    assert.equal(report.reason, "limit");
    assert.equal(report.responses, 4);
    assert.deepEqual(terminal(capped), [{ type: "ended", reason: "limit" }]);

    // 0.05 USD at the estimate: 1 000 output audio tokens of the large model cost 0.064.
    const costly = harness({ maxCallUsd: 0.05 });
    await goLive(costly);
    costly.send(script.responseCreated("resp_2"));
    costly.send(script.responseDone("resp_2", { usage: usageOf({ inText: 100, outAudio: 1_000 }) }));
    const costReport = await ended(costly);
    assert.equal(costReport.reason, "limit");
    assert.ok(costReport.usd.usdEst > 0.05);
    assert.equal(costly.calls.hangUp, 1);
  });

  /** Response k of a long conversation: the cached prompt re-read, plus audio history that grows. */
  function conversationUsage(k: number): ControlEvent {
    return usageOf({
      inText: 8_400,
      inCachedText: 8_300,
      inAudio: 120 * k,
      inCachedAudio: 120 * (k - 1),
      outText: 40,
      outAudio: 250,
    });
  }

  it("compares the estimate, not the high figure, with the cost cap: a long ordinary call of the large model goes on", async () => {
    const h = harness({ maxCallUsd: 2 });
    await goLive(h);
    for (let k = 1; k <= 30; k++) {
      h.send(script.responseCreated(`resp_${k}`));
      h.send(script.responseDone(`resp_${k}`, { usage: conversationUsage(k) }));
      await h.clock.advance(0);
    }
    assert.equal(h.report, null, "30 ordinary responses do not reach the cap");
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.reason, "unload");
    assert.equal(report.responses, 31);
    assert.ok(report.usd.usdHigh > 2, `the high figure (${report.usd.usdHigh}) is above the cap`);
    assert.ok(report.usd.usdEst < 2, `the estimate (${report.usd.usdEst}) is below the cap`);
  });

  it("ends with limit at the first response whose estimate passes the cap", async () => {
    const maxCallUsd = 0.5;
    const h = harness({ maxCallUsd });
    await goLive(h);
    // What the controller has summed so far: the greeting's default usage, then each response.
    const totals = emptyUsage();
    addResponseUsage(totals, usageOf({ inText: 100, outText: 10, outAudio: 50 }));
    let crossedAt = 0;
    for (let k = 1; k <= 30 && h.report === null; k++) {
      addResponseUsage(totals, conversationUsage(k));
      const est = usageCostUsd("gpt-realtime-2.1", totals, null, "api.openai.com").usdEst;
      h.send(script.responseCreated(`resp_${k}`));
      h.send(script.responseDone(`resp_${k}`, { usage: conversationUsage(k) }));
      await h.clock.advance(0);
      if (est > maxCallUsd) {
        crossedAt = k;
        break;
      }
      assert.equal(h.report, null, `ended at response ${k} below the cap`);
    }
    assert.ok(crossedAt > 1 && crossedAt < 30, "the example conversation crosses the cap");
    const report = await ended(h);
    assert.equal(report.reason, "limit");
    assert.equal(report.responses, crossedAt + 1);
    assert.ok(report.usd.usdEst > maxCallUsd);
    assert.deepEqual(terminal(h), [{ type: "ended", reason: "limit" }]);
    assert.equal(h.calls.hangUp, 1);
  });

  it("counts a duplicated response.done once", async () => {
    const h = harness();
    await goLive(h);
    h.send(script.responseCreated("resp_1"));
    h.send(script.responseDone("resp_1", { usage: usageOf({ inText: 10 }) }));
    h.send(script.responseDone("resp_1", { usage: usageOf({ inText: 10 }) }));
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.responses, 2);
    assert.equal(report.duplicates, 1);
    assert.equal(report.usage.inTok, 100 + 10);
  });

  it("ends only once when several triggers fire together", async () => {
    const start = Date.UTC(2026, 11, 2, 9);
    const tool = deferred<ToolOutcome>();
    const h = harness({ deadlineAt: start + 10_000, maxResponses: 1, runTool: () => tool.promise });
    await goLive(h);
    await h.clock.advance(10_000 - (h.clock.now() - start) - 1);
    h.state.closed = true;
    h.send(script.userTextItem());
    h.send(script.sessionUpdated());
    h.send(script.responseDone("resp_more"));
    h.socket.drop();
    h.abort.abort();
    await h.clock.advance(5_000);
    assert.ok(h.report !== null);
    assert.equal(h.report.reason, "tripwire");
    assert.equal(terminal(h).length, 1);
    assert.equal(h.calls.hangUp, 1);
    assert.ok(h.socket.closeCalls.length <= 1);
    assert.equal(warnings(h, "call_tripwire").length, 1);
  });

  it("always hangs up and closes the socket, even when the hang-up fails, throws or hangs", async () => {
    const failing = harness({ hangUp: async () => ({ ok: false, httpStatus: 500 }) });
    await goLive(failing);
    failing.abort.abort();
    const failed = await ended(failing);
    assert.equal(failed.hangUpOk, false);
    assert.deepEqual(failing.socket.closeCalls, [1000]);
    await failing.clock.advance(HANGUP_RETRY_DELAY_MS * 2);
    assert.deepEqual(warnings(failing, "call_hangup_failed"), [
      { warn: "call_hangup_failed", httpStatus: 500, code: "upstream", tenant: TENANT },
    ]);
    assert.equal(await failed.hangUpDone, false);

    let thrown = 0;
    const throwing = harness({
      hangUp: () => {
        thrown += 1;
        throw new Error("boom");
      },
    });
    await goLive(throwing);
    throwing.abort.abort();
    const threw = await ended(throwing);
    assert.equal(threw.hangUpOk, false);
    assert.deepEqual(throwing.socket.closeCalls, [1000]);
    await throwing.clock.advance(HANGUP_RETRY_DELAY_MS * 2);
    assert.equal(thrown, 3);
    assert.equal(await threw.hangUpDone, false);
    assert.deepEqual(warnings(throwing, "call_hangup_failed"), [{ warn: "call_hangup_failed", code: "timeout", tenant: TENANT }]);

    const hanging = harness({ hangUp: () => new Promise<{ ok: boolean }>(() => {}) });
    await goLive(hanging);
    hanging.abort.abort();
    await hanging.clock.advance(2_999);
    assert.equal(hanging.report, null);
    const hung = await ended(hanging, 1);
    assert.deepEqual(hanging.socket.closeCalls, [1000]);
    // Two more attempts, each bounded at 3 s, 1 s apart: one warning after the last.
    await hanging.clock.advance(HANGUP_RETRY_DELAY_MS * 2 + 3_000 * 2 - 1);
    assert.deepEqual(warnings(hanging, "call_hangup_failed"), []);
    await hanging.clock.advance(1);
    assert.deepEqual(warnings(hanging, "call_hangup_failed"), [{ warn: "call_hangup_failed", code: "timeout", tenant: TENANT }]);
    assert.equal(await hung.hangUpDone, false);
  });

  it("retries a failed hang-up twice in the background, without holding the report, and warns only when the last attempt failed", async () => {
    // Fails, then succeeds: no warning.
    const answers = [{ ok: false, httpStatus: 503 }, { ok: true }];
    const results: Array<{ ok: boolean; httpStatus?: number }> = [];
    const h = harness({
      hangUp: async () => {
        const answer = answers[results.length] ?? { ok: true };
        results.push(answer);
        return answer;
      },
    });
    await goLive(h);
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.hangUpOk, false);
    assert.equal(results.length, 1, "the report does not wait for the retries");
    let done: boolean | null = null;
    void report.hangUpDone.then((value) => {
      done = value;
    });
    await h.clock.advance(HANGUP_RETRY_DELAY_MS - 1);
    assert.equal(results.length, 1);
    assert.equal(done, null);
    await h.clock.advance(1);
    assert.equal(results.length, 2);
    assert.equal(done, true);
    await h.clock.advance(60_000);
    assert.equal(results.length, 2, "no attempt after a success");
    assert.deepEqual(warnings(h, "call_hangup_failed"), []);
    assert.equal(h.clock.pending(), 0);

    // Always fails: three attempts in all, one warning, the end sequence still ran once.
    let attempts = 0;
    const failing = harness({
      hangUp: async () => {
        attempts += 1;
        return { ok: false, httpStatus: 500 };
      },
    });
    await goLive(failing);
    failing.abort.abort();
    const failed = await ended(failing);
    assert.equal(failed.hangUpOk, false);
    assert.equal(failed.reason, "unload");
    await failing.clock.advance(60_000);
    assert.equal(attempts, 3);
    assert.equal(await failed.hangUpDone, false);
    assert.equal(warnings(failing, "call_hangup_failed").length, 1);
    assert.deepEqual(failing.socket.closeCalls, [1000], "the socket is closed once, right after the first attempt");
    assert.equal(failing.clock.pending(), 0);
  });

  it("counts a skipped hang-up (somebody else hung up) as done: no retry, no warning", async () => {
    let attempts = 0;
    const h = harness({
      hangUp: async () => {
        attempts += 1;
        return { ok: true, skipped: true };
      },
    });
    await goLive(h);
    h.state.closed = true;
    const report = await ended(h, CLOSED_POLL_MS);
    assert.equal(report.reason, "user");
    assert.equal(report.hangUpOk, true);
    assert.equal(await report.hangUpDone, true);
    await h.clock.advance(60_000);
    assert.equal(attempts, 1);
    assert.deepEqual(warnings(h, "call_hangup_failed"), []);

    // The skipped flag alone counts as done, whatever ok says.
    let skippedAttempts = 0;
    const flagged = harness({
      hangUp: async () => {
        skippedAttempts += 1;
        return { ok: false, skipped: true };
      },
    });
    await goLive(flagged);
    flagged.abort.abort();
    const flaggedReport = await ended(flagged);
    assert.equal(flaggedReport.hangUpOk, true);
    assert.equal(await flaggedReport.hangUpDone, true);
    await flagged.clock.advance(60_000);
    assert.equal(skippedAttempts, 1);
    assert.deepEqual(warnings(flagged, "call_hangup_failed"), []);

    // A plain success: done at once.
    const plain = harness();
    await goLive(plain);
    plain.abort.abort();
    const plainReport = await ended(plain);
    assert.equal(plainReport.hangUpOk, true);
    assert.equal(await plainReport.hangUpDone, true);
    assert.equal(plain.calls.hangUp, 1);
  });
});

describe("call controller: robustness and the report", () => {
  it("keeps going when the polls or the confirmation throw", async () => {
    const h = harness({
      pollReady: () => Promise.reject(new TypeError("store down")),
      pollClosed: () => {
        throw new RangeError("store down");
      },
      confirm: () => Promise.reject(new Error("store down")),
    });
    await h.clock.advance(0);
    h.readback();
    await h.clock.advance(READY_FALLBACK_MS);
    assert.equal(greetingCreates(h).length, 1, "the greeting goes out by the fallback");
    await h.clock.advance(20_000);
    assert.equal(h.report, null);
    assert.deepEqual(
      warnings(h, "call_step_failed").map((fields) => [fields.kind, fields.errorName]),
      [
        ["poll", "TypeError"],
        ["confirm", "Error"],
      ],
    );
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.confirmedAt, h.answerAt + READY_FALLBACK_MS);
  });

  it("never throws on malformed events", async () => {
    const h = harness();
    await goLive(h);
    const junk: unknown[] = [
      null,
      undefined,
      5,
      "response.done",
      [],
      {},
      { type: 5 },
      { type: "response.done" },
      { type: "response.done", response: "x" },
      { type: "response.done", response: { id: 7, usage: "lots" } },
      { type: "response.created", response: null },
      { type: "response.created" },
      { type: "response.done" },
      { type: "output_audio_buffer.started" },
      { type: "output_audio_buffer.stopped", response_id: 3 },
      { type: "output_audio_buffer.cleared" },
      { type: "error" },
      { type: "error", error: "x" },
      { type: "error", error: { code: "bad code with spaces <script>", event_id: 12 } },
      { type: "input_audio_buffer.committed" },
      { type: "input_audio_buffer.committed", item_id: { a: 1 } },
      { type: "conversation.item.input_audio_transcription.delta", item_id: "item_j", delta: 7 },
      { type: "conversation.item.input_audio_transcription.completed", item_id: "item_j", transcript: null, usage: { seconds: "4" } },
      { type: "conversation.item.input_audio_transcription.completed", item_id: "item_k", transcript: "ok", languages: "de" },
      { type: "conversation.item.input_audio_transcription.failed" },
      { type: "response.output_audio_transcript.delta", delta: "x" },
      { type: "response.output_audio_transcript.delta", item_id: "item_m", delta: null },
      { type: "response.output_audio_transcript.done", item_id: "item_m", transcript: 5 },
      { type: "response.function_call_arguments.done", call_id: 9, name: "end_call" },
      { type: "response.function_call_arguments.done", call_id: "x".repeat(300), name: "end_call" },
      { type: "response.function_call_arguments.done", call_id: "call_j", name: 5, arguments: "{not json" },
      { type: "response.function_call_arguments.done", call_id: "call_k", name: "check_availability", arguments: "[1,2]" },
      { type: "rate_limits.updated", rate_limits: "many" },
      { type: "rate_limits.updated", rate_limits: [null, { name: "tokens", remaining: "x" }] },
      { type: "conversation.item.added", item: "x" },
      { type: "conversation.item.added", item: { type: "message", role: "user", content: "text" } },
      { type: "conversation.item.truncated" },
      { type: "response.content_part.added", part: {} },
      { type: "unknown.event.type", anything: [1, 2, 3] },
    ];
    for (const event of junk) assert.doesNotThrow(() => h.send(event));
    await h.clock.advance(1_000);
    assert.equal(h.report, null, "malformed events end nothing");
    assert.ok(h.logs.some((fields) => fields.warn === "call_openai_error" && fields.code === "other"));
    // Tools named by the junk ran with an empty input and no event for an unknown name.
    assert.deepEqual(
      h.calls.tools.map((call) => [call.id, call.name, call.input]),
      [
        ["call_j", "", {}],
        ["call_k", "check_availability", {}],
      ],
    );
    const report = await ended(h, 180_000);
    assert.equal(report.reason, "timeout");

    // A browser stream or a log sink that throws ends nothing either.
    const fragile = harness({
      emit: () => {
        throw new Error("closed");
      },
      log: () => {
        throw new Error("closed");
      },
    });
    await goLive(fragile);
    fragile.send(script.error("server_error"));
    await fragile.clock.advance(1_000);
    assert.equal(fragile.report, null);
    assert.equal((await ended(fragile, 180_000)).reason, "timeout");
  });

  it("ends with error after too many provider errors", async () => {
    const h = harness();
    await goLive(h);
    for (let i = 0; i < 20; i++) h.send(script.error("server_error"));
    await h.clock.advance(0);
    assert.equal(h.report, null);
    h.send(script.error("server_error"));
    const report = await ended(h);
    assert.equal(report.reason, "error");
    assert.equal(report.errors, 21);
    assert.deepEqual(terminal(h), [{ type: "error", code: "upstream" }]);
    assert.equal(warnings(h, "call_openai_error").length, 1, "one line per distinct code");
  });

  it("counts the transcription usage of both shapes: seconds and tokens", async () => {
    const h = harness({ transcribeModel: "gpt-4o-mini-transcribe" });
    await goLive(h);
    h.send(script.committed("item_c1"));
    h.send(
      script.callerCompleted("item_c1", "a question", {
        usage: { type: "tokens", total_tokens: 70, input_tokens: 50, input_token_details: { text_tokens: 10, audio_tokens: 40 }, output_tokens: 20 },
      }),
    );
    h.send(script.committed("item_c2"));
    h.send(script.callerCompleted("item_c2", "another one", { usage: { type: "duration", seconds: 3 } }));
    h.send(script.committed("item_c3"));
    h.send(script.callerCompleted("item_c3", "and a third", { usage: { duration: 9 } }));
    h.abort.abort();
    const report = await ended(h);
    assert.equal(report.usage.transcribeInTok, 50);
    assert.equal(report.usage.transcribeOutTok, 20);
    assert.equal(report.usage.transcribeSec, 3, "a bare duration number is no real shape and adds nothing");
    const withoutTranscription = usageCostUsd("gpt-realtime-2.1", { ...report.usage, transcribeSec: 0, transcribeInTok: 0, transcribeOutTok: 0 }, null, "api.openai.com");
    assert.ok(report.usd.usdEst > withoutTranscription.usdEst, "the tokens are priced");
    assert.deepEqual(report.usd, usageCostUsd("gpt-realtime-2.1", report.usage, "gpt-4o-mini-transcribe", "api.openai.com"));
  });

  it("reports usage, timings and counts in the end report", async () => {
    const clock = createFakeClock();
    const start = clock.now();
    const socket = createFakeControlSocket();
    const h = harness(
      {
        limits: { warnBeforeEndSeconds: 0, silenceTimeoutSeconds: 600, maxTurnChars: 200 },
        openControl: () => new Promise<OpenControlResult>((resolve) => clock.setTimeout(() => resolve({ ok: true, socket }), 500)),
      },
      clock,
    );
    await h.clock.advance(500);
    socket.serverSends(script.readback(EXPECTED));
    await h.clock.advance(400);
    h.state.ready = true;
    await h.clock.advance(100);
    assert.equal(socket.sentOfType("response.create").length, 1);
    const send = (event: ControlEvent) => socket.serverSends(event);
    const greetUsage = usageOf({ inText: 400, outText: 60, outAudio: 100, reasoning: 30 });
    const toolUsage = usageOf({ inText: 900, inCachedText: 512, inAudio: 120, outText: 20 });
    const replyUsage = usageOf({ inText: 1_000, inAudio: 200, inCachedAudio: 50, outText: 30, outAudio: 150 });
    send(script.responseCreated("resp_greet"));
    await h.clock.advance(600);
    send(script.audioStarted("resp_greet"));
    send(script.responseDone("resp_greet", { usage: greetUsage }));
    send(script.audioStopped("resp_greet"));
    send(script.committed("item_c1"));
    send(script.callerCompleted("item_c1", "a question", { usage: { type: "duration", seconds: 4 } }));
    send(script.responseCreated("resp_1"));
    send(script.functionCall("resp_1", "call_1", "check_availability"));
    await h.clock.advance(0);
    send(script.responseDone("resp_1", { usage: toolUsage }));
    await h.clock.advance(0);
    send(script.responseCreated("resp_2"));
    send(script.responseDone("resp_2", { usage: replyUsage }));
    send(script.error("rate_limit_exceeded"));
    send(script.rateLimits(1_000));
    send(script.rateLimits(500));
    send(script.rateLimits(800));
    send(script.committed("item_c2"));
    send(script.responseDone("resp_1", { usage: toolUsage }));
    const report = await ended(h, 180_000);

    const totals = emptyUsage();
    for (const usage of [greetUsage, toolUsage, replyUsage]) addResponseUsage(totals, usage);
    totals.transcribeSec = 4;
    assert.deepEqual(report.usage, totals);
    assert.deepEqual(report.usd, usageCostUsd("gpt-realtime-2.1", totals, "gpt-transcribe", "api.openai.com"));
    assert.equal(report.reason, "timeout");
    assert.equal(report.confirmedAt, start + 1_000);
    assert.equal(report.endedAt, start + 180_000);
    assert.equal(report.responses, 3);
    assert.equal(report.foreign, 0);
    assert.equal(report.turns, 2);
    assert.equal(report.tools, 1);
    assert.equal(report.errors, 1);
    assert.equal(report.duplicates, 1);
    assert.equal(report.greetings, 1);
    assert.equal(report.sidebandMs, 500);
    assert.equal(report.readyMs, 1_000);
    assert.equal(report.greetMs, 600);
    assert.equal(report.minTokLeft, 500);
    assert.equal(report.tripwire, null);
    await report.toolDone;
    // The log lines carry codes and numbers only.
    for (const fields of h.logs) {
      for (const value of Object.values(fields)) {
        if (typeof value === "string") assert.match(value, /^[A-Za-z0-9_.:-]+$/);
      }
    }
  });
});
