// Isolation between businesses and between sessions: a token of tenant A can never make a turn,
// a tool call or an end report act for tenant B, whatever the request body claims; and one
// session's state is never read or changed by another.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { getCalendar } from "@/lib/voice/calendar";
import type { BrainModel, ModelEvent } from "@/lib/voice/server/brain";
import { handleEndRequest, handleSessionRequest, handleTurnRequest, type VoiceDeps } from "@/lib/voice/server/handlers";
import { loadState, stateKey } from "@/lib/voice/server/state";
import { getDemoTenant } from "@/lib/voice/demos";
import type { CalendarProvider, SessionGrant, TurnStreamEvent } from "@/lib/voice/types";
import { captureLogs, localEnv, post, readEvents, readGrant, sessionBody, spoken, tamper, testDeps } from "./voice-fixtures";

const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);

let restoreEnv: () => void = () => undefined;
beforeEach(() => {
  captureLogs();
  restoreEnv = localEnv();
});
afterEach(() => {
  restoreEnv();
  mock.restoreAll();
});

async function open(deps: VoiceDeps, tenant: string): Promise<SessionGrant> {
  const response = await handleSessionRequest(post("/api/voice/session", sessionBody({ tenant })), deps);
  assert.equal(response.status, 200);
  return readGrant(response);
}

function sidOf(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).sid as string;
}

async function turn(deps: VoiceDeps, body: Record<string, unknown>): Promise<{ status: number; events: TurnStreamEvent[] }> {
  const response = await handleTurnRequest(post("/api/voice/turn", { locale: "de", ...body }), deps);
  return { status: response.status, events: response.status === 200 ? await readEvents(response) : [] };
}

/** A model that tries a tool of the coiffeur on whatever tenant it runs for. */
function coiffeurToolModel(): BrainModel {
  let call = 0;
  return {
    id: "intruder",
    async *stream(): AsyncGenerator<ModelEvent> {
      call += 1;
      const tool = call === 1;
      yield { type: "text", text: tool ? "Ich schaue nach. " : "Das geht hier nicht." };
      yield {
        type: "end",
        content: [
          { type: "text", text: tool ? "Ich schaue nach. " : "Das geht hier nicht." },
          ...(tool
            ? [
                {
                  type: "tool_use" as const,
                  id: "toolu_intruder",
                  name: "book_appointment",
                  input: { service: "women_cut", start: "2026-12-03T10:00:00+01:00", name: "Eva Muster", contact: "0791234567" },
                },
              ]
            : []),
        ],
        stopReason: tool ? "tool_use" : "end_turn",
        model: "intruder",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

describe("tenant isolation", () => {
  it("ignores a tenant named in the turn body: the token's tenant speaks", async () => {
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps, "demo-maler");
    const { events } = await turn(deps, { sessionToken: grant.sessionToken, text: "", opening: true, tenant: "modolo" });
    assert.equal(spoken(events), getDemoTenant("demo-maler")?.greeting.de);
  });

  it("refuses the tools of another tenant, and leaves that tenant's calendar alone", async () => {
    const calendars = new Map<string, CalendarProvider | null>();
    const deps = testDeps({
      now: () => T0,
      model: () => coiffeurToolModel(),
      calendar: (tenant) => {
        const calendar = getCalendar(tenant);
        calendars.set(tenant.id, calendar);
        return calendar;
      },
    });
    const grant = await open(deps, "modolo");
    const { events } = await turn(deps, { sessionToken: grant.sessionToken, text: "Einen Damenschnitt morgen um zehn", tenant: "demo-coiffeur" });
    assert.deepEqual(
      events.filter((event) => event.type === "tool"),
      [
        { type: "tool", name: "book_appointment", status: "started" },
        { type: "tool", name: "book_appointment", status: "failed" },
      ],
    );
    assert.deepEqual([...calendars.keys()], ["modolo"], "only the token's tenant was looked up");
    const state = await loadState(deps.store, sidOf(grant.sessionToken));
    assert.equal(state?.tenantId, "modolo");
    assert.deepEqual(state?.outcomes, []);
    const result = state?.history[0].messages[2];
    assert.ok(result && Array.isArray(result.content) && result.content[0].type === "tool_result");
    assert.match(result.content[0].content, /"code":"not_enabled"/);
  });

  it("refuses a token whose tenant (or any other byte) was changed", async () => {
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps, "demo-maler");
    const forged = await turn(deps, { sessionToken: tamper(grant.sessionToken), text: "Hallo" });
    assert.equal(forged.status, 403);
    const forgedEnd = await handleEndRequest(post("/api/voice/end", { sessionToken: tamper(grant.sessionToken), reason: "user" }), deps);
    assert.equal(forgedEnd.status, 403);
  });
});

describe("session isolation", () => {
  it("keeps each session's state under its own key; a turn in one leaves the other untouched", async () => {
    const deps = testDeps({ now: () => T0 });
    const a = await open(deps, "modolo");
    const b = await open(deps, "modolo");
    const sidA = sidOf(a.sessionToken);
    const sidB = sidOf(b.sessionToken);
    assert.notEqual(sidA, sidB);
    assert.notEqual(stateKey(sidA), stateKey(sidB));

    await turn(deps, { sessionToken: a.sessionToken, text: "", opening: true });
    await turn(deps, { sessionToken: a.sessionToken, text: "Was kostet eine Website?" });
    const stateA = await loadState(deps.store, sidA);
    const stateB = await loadState(deps.store, sidB);
    assert.equal(stateA?.turns, 1);
    assert.equal(stateA?.greeted, true);
    assert.equal(stateB?.turns, 0);
    assert.deepEqual(stateB?.history, []);

    // Ending A does not end B.
    await handleEndRequest(post("/api/voice/end", { sessionToken: a.sessionToken, reason: "user" }), deps);
    assert.equal(await loadState(deps.store, sidA), null);
    const next = await turn(deps, { sessionToken: b.sessionToken, text: "Hallo" });
    assert.equal(next.status, 200);
    assert.equal(next.events[next.events.length - 1].type, "done");
  });

  it("counts turns per session: one session's cap never touches another", async () => {
    const deps = testDeps({ now: () => T0 });
    const a = await open(deps, "modolo");
    const b = await open(deps, "modolo");
    const first = await turn(deps, { sessionToken: a.sessionToken, text: "Hallo" });
    const other = await turn(deps, { sessionToken: b.sessionToken, text: "Hallo" });
    const lastA = first.events[first.events.length - 1];
    const lastB = other.events[other.events.length - 1];
    assert.ok(lastA.type === "done" && lastB.type === "done");
    assert.equal(lastA.type === "done" && lastA.remainingTurns, 23);
    assert.equal(lastB.type === "done" && lastB.remainingTurns, 23);
  });
});
