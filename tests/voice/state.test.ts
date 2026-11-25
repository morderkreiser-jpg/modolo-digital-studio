// Session state of the text-turn mode (lib/voice/server/state.ts) and the replay memory it carries
// for the tools (exportToolMemory / importToolMemory in lib/voice/tools/execute.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStore } from "@/lib/assistant/server/store";
import { admitSession } from "@/lib/voice/server/limits";
import {
  clearState,
  createSessionState,
  loadState,
  MAX_STATE_CHARS,
  MAX_STORED_TURNS,
  saveState,
  serializeState,
  stateKey,
  stateTtlSeconds,
  STATE_MARGIN_SECONDS,
  type VoiceSessionState,
} from "@/lib/voice/server/state";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { createMemorySinks, executeTool, exportToolMemory, importToolMemory, type ToolContext } from "@/lib/voice/tools/execute";
import { DEFAULT_VOICE_LIMITS } from "@/lib/voice/types";
import { createFakeStore } from "../assistant/fixtures";

const SID = "stateTestSession000001";
const OTHER = "stateTestSession000002";
const NOW = Date.UTC(2026, 11, 2, 9, 0, 0);

function state(sessionId = SID): VoiceSessionState {
  return createSessionState({ tenantId: "modolo", sessionId, mode: "local", channel: "web", locale: "de", startedAt: NOW, reservation: null });
}

function withTurns(base: VoiceSessionState, count: number, chars = 20): VoiceSessionState {
  for (let index = 0; index < count; index += 1) {
    base.history.push({
      messages: [
        { role: "user", content: `turn ${index} ${"x".repeat(chars)}` },
        { role: "assistant", content: [{ type: "text", text: `reply ${index}` }] },
      ],
    });
  }
  return base;
}

describe("session state", () => {
  it("is stored under its session id with the session's lifetime plus a margin", async () => {
    const { store, calls } = createFakeStore();
    assert.equal(await saveState(store, SID, state(), stateTtlSeconds(DEFAULT_VOICE_LIMITS)), true);
    const set = calls.find((call) => call.op === "set");
    assert.equal(set?.key, `mva:state:${SID}`);
    assert.equal(set?.key, stateKey(SID));
    assert.equal(set?.ttlSeconds, DEFAULT_VOICE_LIMITS.maxCallSeconds + 60 + STATE_MARGIN_SECONDS);
    assert.deepEqual(await loadState(store, SID), state());
  });

  it("keeps sessions apart: another id reads nothing, a copied value is refused", async () => {
    const store = createMemoryStore();
    await saveState(store, SID, state(), 600);
    assert.equal(await loadState(store, OTHER), null);
    // A state written under another session's key (or a key guessed by a bug) does not load.
    await store.set(stateKey(OTHER), serializeState(state()), 600);
    assert.equal(await loadState(store, OTHER), null);
    // And saveState refuses to write one session's state under another's id.
    assert.equal(await saveState(store, OTHER, state(), 600), false);
  });

  it("drops the oldest whole turns beyond the caps", async () => {
    const many = withTurns(state(), MAX_STORED_TURNS + 5);
    const parsed = JSON.parse(serializeState(many)) as VoiceSessionState;
    assert.equal(parsed.history.length, MAX_STORED_TURNS);
    assert.match(String(parsed.history[0].messages[0].content), /^turn 5 /);

    const big = withTurns(state(), 10, 8000);
    const json = serializeState(big);
    assert.ok(json.length <= MAX_STATE_CHARS);
    const kept = (JSON.parse(json) as VoiceSessionState).history;
    assert.ok(kept.length < 10 && kept.length >= 1);
    assert.match(String(kept[kept.length - 1].messages[0].content), /^turn 9 /, "the latest turn always stays");
    for (const turn of kept) assert.equal(turn.messages.length, 2, "turns are dropped whole");
  });

  it("reads nothing from junk, and clearState empties the slot", async () => {
    const store = createMemoryStore();
    await store.set(stateKey(SID), "{not json", 600);
    assert.equal(await loadState(store, SID), null);
    await store.set(stateKey(SID), JSON.stringify({ ...state(), v: 2 }), 600);
    assert.equal(await loadState(store, SID), null);
    await saveState(store, SID, state(), 600);
    await clearState(store, SID);
    assert.equal(await loadState(store, SID), null);
    assert.equal(await loadState(store, "not a session id"), null);
  });

  it("refuses a reservation that belongs to another session", async () => {
    const store = createMemoryStore();
    const admitted = await admitSession({
      store,
      tenantId: "modolo",
      limits: DEFAULT_VOICE_LIMITS,
      ipHash: null,
      mode: "local",
      costChfPerMinute: 0.02,
      sessionId: OTHER,
      now: NOW,
    });
    assert.ok(admitted.ok);
    const own = { ...state(), reservation: { ...admitted.reservation, sessionId: SID } };
    await saveState(store, SID, own, 600);
    assert.equal((await loadState(store, SID))?.reservation?.sessionId, SID);
    await store.set(stateKey(SID), JSON.stringify({ ...state(), reservation: admitted.reservation }), 600);
    assert.equal(await loadState(store, SID), null);
  });

  it("reports a store that cannot keep the state", async () => {
    const { store } = createFakeStore("upstash", { setResult: false });
    assert.equal(await saveState(store, SID, state(), 600), false);
  });
});

describe("tool replay memory across requests", () => {
  const input = {
    task: "project_request",
    fields: { service: "website", problem: "Neue Website" },
    name: "Anna Muster",
    email: "anna@example.ch",
    summary: "Neue Website.",
  };

  function context(counters: ToolContext["counters"], sinks: ReturnType<typeof createMemorySinks>, outcomes: unknown[]): ToolContext {
    return {
      tenant: MODOLO_VOICE_TENANT,
      sessionId: SID,
      locale: "de",
      channel: "web",
      now: new Date(NOW),
      limits: DEFAULT_VOICE_LIMITS,
      counters,
      calendar: null,
      sinks,
      record: (outcome) => outcomes.push(outcome),
    };
  }

  it("answers a repeated request from memory after a JSON round trip", async () => {
    const sinks = createMemorySinks();
    const outcomes: unknown[] = [];
    const first = { toolCalls: 0, bookings: 0, leads: 0 };
    const answer = await executeTool(context(first, sinks, outcomes), { id: "a", name: "create_lead", input });
    assert.equal(answer.ok, true);
    const snapshot = JSON.parse(JSON.stringify(exportToolMemory(first)));

    // The next request has a new counters object, restored from the stored state.
    const second = JSON.parse(JSON.stringify(first)) as typeof first;
    importToolMemory(second, snapshot);
    const repeat = await executeTool(context(second, sinks, outcomes), { id: "b", name: "create_lead", input });
    assert.deepEqual(repeat, answer);
    assert.equal(sinks.leads.length, 1);
    assert.equal(outcomes.length, 1);

    // Without the memory the same request would reach the sink again: that is what it prevents.
    const forgetful = JSON.parse(JSON.stringify(first)) as typeof first;
    await executeTool(context(forgetful, sinks, outcomes), { id: "c", name: "create_lead", input });
    assert.equal(sinks.leads.length, 2);
  });

  it("ignores a snapshot that is not one", () => {
    const counters = { toolCalls: 0, bookings: 0, leads: 0 };
    importToolMemory(counters, null);
    importToolMemory(counters, { recorded: [1, "ok"], replies: [["k", { ok: "yes" }], "junk", ["k2", { ok: true, say: "fine" }]] });
    const memory = exportToolMemory(counters);
    assert.deepEqual(memory.recorded, ["ok"]);
    assert.deepEqual(memory.replies, [["k2", { ok: true, say: "fine" }]]);
  });
});
