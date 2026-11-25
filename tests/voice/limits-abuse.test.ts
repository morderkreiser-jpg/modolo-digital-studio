// The security review's abuse scenarios (first security review),
// replayed through the HTTP handlers: what a script can do to the money and the minutes, and what
// it cannot do any more. Time is injected; nothing calls a real model or sends a real email.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import type { BrainModel, ModelEvent } from "@/lib/voice/server/brain";
import {
  handleEndRequest,
  handleSessionRequest,
  handleToolRequest,
  handleTurnRequest,
  TOOL_DELIVERY_HEADER,
  TOOL_SIGNATURE_HEADER,
  TOOL_TIMESTAMP_HEADER,
  type VoiceDeps,
} from "@/lib/voice/server/handlers";
import { acquireSessionLock, globalUsageSnapshot, TURN_REQUESTS_PER_WINDOW, usageSnapshot } from "@/lib/voice/server/limits";
import { createMockProvider } from "@/lib/voice/server/providers/mock";
import { loadState } from "@/lib/voice/server/state";
import { accountingStoreFor } from "@/lib/voice/server/stores";
import type { SendEmail } from "@/lib/voice/server/summary";
import { signWebhook } from "@/lib/voice/server/webhook";
import type { SessionGrant } from "@/lib/voice/types";
import {
  captureLogs,
  localEnv,
  post,
  readError,
  readEvents,
  readGrant,
  sessionBody,
  setVoiceEnv,
  TEST_SECRET,
  testDeps,
  WEBHOOK_SECRET,
} from "./voice-fixtures";

/** Wednesday 2 December 2026, 10:00 in Zurich. */
const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);
const RESEND = { apiKey: "re_test_key", from: "Modolo Digital Studio <test@example.ch>" };

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

function sessionRequest(ip: string, body: Record<string, unknown> = sessionBody()): Request {
  return post("/api/voice/session", body, { "x-real-ip": ip });
}

async function open(deps: VoiceDeps, ip: string, body: Record<string, unknown> = sessionBody()): Promise<SessionGrant> {
  const response = await handleSessionRequest(sessionRequest(ip, body), deps);
  assert.equal(response.status, 200, `session refused: ${await response.clone().text()}`);
  return readGrant(response);
}

function sidOf(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).sid as string;
}

/** Realtime with the mock provider and the tool webhook switched on. */
function realtimeEnv(extra: Parameters<typeof setVoiceEnv>[0] = {}): () => void {
  return setVoiceEnv({
    VOICE_ENABLED: "true",
    VOICE_MODE: "realtime",
    VOICE_PROVIDER: "mock",
    VOICE_SESSION_SECRET: TEST_SECRET,
    VOICE_PROVIDER_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...extra,
  });
}

/** A request to the tool webhook, signed like the provider would. */
function signedToolRequest(body: unknown, now: number, delivery: string): Request {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(now / 1000);
  return new Request("https://site.example/api/voice/tool", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [TOOL_TIMESTAMP_HEADER]: String(timestamp),
      [TOOL_SIGNATURE_HEADER]: signWebhook(WEBHOOK_SECRET, timestamp, raw),
      [TOOL_DELIVERY_HEADER]: delivery,
    },
    body: raw,
  });
}

function emailRecorder(): SendEmail & { sent: Parameters<SendEmail>[0][] } {
  const sent: Parameters<SendEmail>[0][] = [];
  const send = (async (email) => {
    sent.push(email);
    return true;
  }) as SendEmail & { sent: Parameters<SendEmail>[0][] };
  send.sent = sent;
  return send;
}

// ---------------------------------------------------------------------------------------------
// sicurezza/F4: abandoned sessions
// ---------------------------------------------------------------------------------------------

describe("sicurezza/F4: sessions that never report their end", () => {
  // The verifier's probe: ten local admissions from different IPs, one every 240 seconds so that
  // concurrency never refuses, none of them ever sending a turn or an end report. Before, each kept
  // its whole call (3 minutes) of the tenant's 30 daily minutes, and the 11th was refused for the
  // rest of the day. Now each keeps one lease (60 seconds).
  it("ten abandoned sessions keep ten minutes, not the day: the eleventh is admitted", async () => {
    restoreEnv = localEnv();
    let now = T0;
    const deps = testDeps({ now: () => now });
    for (let i = 0; i < 10; i++) {
      now = T0 + i * 240_000;
      await open(deps, `198.51.100.${i + 1}`);
    }
    now = T0 + 10 * 240_000;
    await open(deps, "198.51.100.11");
    assert.equal((await usageSnapshot(deps.store, "modolo", now)).minutesToday, 11);
  });

  it("the concurrency slots of abandoned sessions free themselves within two minutes", async () => {
    restoreEnv = localEnv();
    let now = T0;
    const deps = testDeps({ now: () => now });
    await open(deps, "198.51.100.1");
    await open(deps, "198.51.100.2");
    now = T0 + 10_000;
    const busy = await handleSessionRequest(sessionRequest("198.51.100.3"), deps);
    assert.equal((await readError(busy)).error, "busy");
    now = T0 + 120_000; // before: up to 480 seconds
    await open(deps, "198.51.100.3");
  });

  it("a session that keeps talking keeps its slot and its minutes grow with it", async () => {
    restoreEnv = localEnv();
    let now = T0;
    const deps = testDeps({ now: () => now });
    const grant = await open(deps, "198.51.100.1");
    for (const at of [20_000, 70_000, 120_000]) {
      now = T0 + at;
      const response = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: "Hallo", locale: "de" }), deps);
      assert.equal(response.status, 200);
      await readEvents(response);
    }
    const usage = await usageSnapshot(deps.store, "modolo", now);
    assert.equal(usage.minutesToday, 3, "used time plus one lease, at most the whole call");
    assert.equal(usage.running, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// sicurezza/F6: a flood of free keys
// ---------------------------------------------------------------------------------------------

describe("sicurezza/F6: a flood of free keys cannot reset the budget", () => {
  // This spent the day's minutes with a local session before. Local minutes no longer refuse
  // anything (review finding S2-2), so the minutes are spent by a realtime call whose provider
  // cannot confirm calls: it reserves its whole call (3 minutes) at admission.
  it("6000 scripted sessions from fresh IPv6 networks leave the spent minutes spent", async () => {
    restoreEnv = realtimeEnv({ VOICE_MINUTES_PER_DAY: "3" });
    // The production default: the in-memory store, no separate accounting store given.
    const shared = createMemoryStore();
    const deps: VoiceDeps = { store: shared, resend: null, now: () => T0, provider: createMockProvider({ now: () => T0, confirmsCalls: false }) };
    await open(deps, "198.51.100.1", sessionBody({ mode: "realtime" }));
    const spent = await handleSessionRequest(sessionRequest("198.51.100.2", sessionBody({ mode: "realtime" })), deps);
    assert.equal((await readError(spent)).error, "budget_exhausted");

    for (let i = 0; i < 6000; i++) {
      const response = await handleSessionRequest(sessionRequest(`2001:db8:${i.toString(16)}::1`, sessionBody({ mode: "scripted" })), deps);
      assert.equal(response.status, 200);
    }

    const accounting = accountingStoreFor(shared);
    assert.notEqual(accounting, shared);
    const usage = await usageSnapshot(accounting, "modolo", T0);
    assert.equal(usage.minutesToday, 3);
    assert.equal(usage.running, 1);
    const still = await handleSessionRequest(sessionRequest("198.51.100.3", sessionBody({ mode: "realtime" })), deps);
    assert.equal((await readError(still)).error, "budget_exhausted");
  });
});

// ---------------------------------------------------------------------------------------------
// sicurezza/F3: thirteen public tenants
// ---------------------------------------------------------------------------------------------

describe("sicurezza/F3: one allowance per IP, and a ceiling over all tenants", () => {
  it("a demo business gets only the scripted example on the public site", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps, "198.51.100.1", sessionBody({ tenant: "demo-maler", mode: "local" }));
    assert.equal(grant.mode, "scripted");
    assert.equal((await usageSnapshot(deps.store, "demo-maler", T0)).minutesToday, 0);
  });

  it("one IP gets three live sessions an hour in all, whichever tenants it asks for", async () => {
    restoreEnv = localEnv({ VOICE_LAB: "true", VOICE_MAX_CONCURRENT: "10" });
    const deps = testDeps({ now: () => T0 });
    for (const tenant of ["modolo", "demo-maler", "demo-coiffeur"]) await open(deps, "203.0.113.7", sessionBody({ tenant }));
    const fourth = await handleSessionRequest(sessionRequest("203.0.113.7", sessionBody({ tenant: "demo-umzug" })), deps);
    assert.equal(fourth.status, 429);
    assert.equal((await readError(fourth)).error, "rate_limited");
  });

  // This ran on local sessions before; their minutes no longer refuse anything (review finding
  // S2-2), so the same ceiling is shown where minutes cost money: realtime calls, here with a
  // provider that cannot confirm calls (each reserves its whole call at admission).
  it("the minutes of all tenants together stop at VOICE_GLOBAL_MINUTES_PER_DAY", async () => {
    restoreEnv = realtimeEnv({ VOICE_LAB: "true", VOICE_GLOBAL_MINUTES_PER_DAY: "6" });
    const deps = testDeps({ now: () => T0, provider: createMockProvider({ now: () => T0, confirmsCalls: false }) });
    await open(deps, "198.51.100.1", sessionBody({ tenant: "modolo", mode: "realtime" }));
    await open(deps, "198.51.100.2", sessionBody({ tenant: "demo-maler", mode: "realtime" }));
    const third = await handleSessionRequest(sessionRequest("198.51.100.3", sessionBody({ tenant: "demo-coiffeur", mode: "realtime" })), deps);
    assert.equal(third.status, 503);
    assert.equal((await readError(third)).error, "budget_exhausted");
    assert.deepEqual(await globalUsageSnapshot(deps.store, T0), { minutesToday: 6, spendChfThisMonth: 1.5 });
  });
});

// ---------------------------------------------------------------------------------------------
// sicurezza/F1: the model's tokens
// ---------------------------------------------------------------------------------------------

/** A model that answers briefly and reports the usage of a large prompt, like the real one. */
function meteredModel(calls: { count: number }): BrainModel {
  return {
    id: "metered",
    async *stream(): AsyncGenerator<ModelEvent> {
      calls.count += 1;
      yield { type: "text", text: "Gern." };
      yield {
        type: "end",
        content: [{ type: "text", text: "Gern." }],
        stopReason: "end_turn",
        model: "claude-haiku-5-5",
        // 20'000 uncached input tokens and 400 output: 2'200 micro-USD, 1'980 micro-CHF at 0.90.
        usage: { inputTokens: 20_000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

describe("sicurezza/F1: every turn is charged its real model cost, and the ceiling stops the turns", () => {
  it("a script firing turns is charged what the model cost and is refused before the budget is passed", async () => {
    restoreEnv = localEnv({ VOICE_BUDGET_CHF_PER_MONTH: "0.03" });
    const calls = { count: 0 };
    // Two seconds between turns: the turn requests per window (review finding S2-4) must not be
    // what stops this script before the budget does.
    let now = T0;
    const deps = testDeps({ now: () => now, model: () => meteredModel(calls) });
    const grant = await open(deps, "198.51.100.1");
    let completed = 0;
    let refused: Response | null = null;
    for (let turn = 0; turn < 24; turn++) {
      now = T0 + turn * 2_000;
      const response = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: `Frage ${turn}`, locale: "de" }), deps);
      if (response.status !== 200) {
        refused = response;
        break;
      }
      const events = await readEvents(response);
      assert.equal(events[events.length - 1].type, "done");
      completed += 1;
    }
    assert.ok(refused, "the budget stopped the turns");
    assert.equal(refused.status, 503);
    const error = await readError(refused);
    assert.equal(error.error, "budget_exhausted");
    assert.ok((error.retryAfter ?? 0) > 0);
    assert.ok(completed > 0 && completed < 24);
    assert.equal(calls.count, completed, "the refused turn never reached the model");
    const spend = (await usageSnapshot(deps.store, "modolo", T0)).spendChfThisMonth;
    assert.equal(spend, (completed * 1_980) / 1e6, "charged exactly what the model cost");
    assert.ok(spend <= 0.03);
    assert.equal((await globalUsageSnapshot(deps.store, T0)).spendChfThisMonth, spend);
  });

  it("the ceiling across all tenants stops a tenant that still has budget of its own", async () => {
    restoreEnv = localEnv({ VOICE_GLOBAL_BUDGET_CHF_PER_MONTH: "0.01" });
    const calls = { count: 0 };
    const deps = testDeps({ now: () => T0, model: () => meteredModel(calls) });
    const grant = await open(deps, "198.51.100.1");
    const statuses: number[] = [];
    for (let turn = 0; turn < 10; turn++) {
      const response = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: `Frage ${turn}`, locale: "de" }), deps);
      statuses.push(response.status);
      if (response.status === 200) await readEvents(response);
      else break;
    }
    assert.equal(statuses[statuses.length - 1], 503);
    assert.ok((await globalUsageSnapshot(deps.store, T0)).spendChfThisMonth <= 0.01);
  });
});

// ---------------------------------------------------------------------------------------------
// sicurezza/F7: parallel requests of one session
// ---------------------------------------------------------------------------------------------

const leadText = (i: number) => `Ich möchte eine Offerte für eine Website. Mein Name ist Anna Muster, meine E-Mail ist anna${i}@example.ch`;

/**
 * A model that stores a NEW request on every turn (its email is taken from the turn's own text),
 * the worst a script can make a model do; the mock brain would repeat the first request instead.
 */
function leadEveryTurnModel(): BrainModel {
  return {
    id: "lead-every-turn",
    async *stream(request): AsyncGenerator<ModelEvent> {
      const last = request.messages[request.messages.length - 1];
      const afterTool = Array.isArray(last.content) && last.content.some((block) => block.type === "tool_result");
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      if (afterTool) {
        yield { type: "text", text: "Erledigt." };
        yield { type: "end", content: [{ type: "text", text: "Erledigt." }], stopReason: "end_turn", model: "claude-haiku-5-5", usage };
        return;
      }
      const text = typeof last.content === "string" ? last.content : "";
      const email = /anna\d+@example\.ch/.exec(text)?.[0] ?? "anna@example.ch";
      yield { type: "text", text: "Ich nehme das auf." };
      yield {
        type: "end",
        content: [
          { type: "text", text: "Ich nehme das auf." },
          {
            type: "tool_use",
            id: `toolu_${email.replace(/\W/g, "")}`,
            name: "create_lead",
            input: { task: "project_request", fields: { service: "website", problem: "Eine Website" }, name: "Anna Muster", email, summary: "Website" },
          },
        ],
        stopReason: "tool_use",
        model: "claude-haiku-5-5",
        usage,
      };
    },
  };
}

describe("sicurezza/F7: parallel turns of one session", () => {
  // Since review finding S2-4, the requests beyond TURN_REQUESTS_PER_WINDOW are refused before
  // they even look at the lock ("rate_limited"); the ones let through meet the lock as before.
  it("24 turns fired at once: one runs, the others are refused with turn_in_progress or rate_limited, and the caps hold", async () => {
    restoreEnv = localEnv();
    const send = emailRecorder();
    const deps = testDeps({ now: () => T0, resend: RESEND, sendEmail: send, lockWaitMs: 0 });
    const grant = await open(deps, "198.51.100.1");
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, i) => handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: leadText(i), locale: "de" }), deps)),
    );
    const statuses = responses.map((response) => response.status);
    assert.ok(statuses.includes(200));
    assert.ok(statuses.includes(409));
    assert.equal(statuses.filter((status) => status === 429).length, 24 - TURN_REQUESTS_PER_WINDOW);
    for (const response of responses) {
      if (response.status === 200) await readEvents(response);
      else if (response.status === 429) assert.equal((await readError(response)).error, "rate_limited");
      else assert.equal((await readError(response)).error, "turn_in_progress");
    }
    assert.ok(send.sent.length <= 2, `${send.sent.length} requests reached the business`);
    const state = await loadState(deps.store, sidOf(grant.sessionToken));
    assert.equal(state?.outcomes.length, send.sent.length, "every request that went out is in the summary");
  });

  it("24 turns that wait for each other run one after the other: exactly the cap of two requests goes out", async () => {
    restoreEnv = localEnv();
    const send = emailRecorder();
    const deps = testDeps({ now: () => T0, resend: RESEND, sendEmail: send, lockWaitMs: 20_000, model: () => leadEveryTurnModel() });
    const grant = await open(deps, "198.51.100.1");
    // A second and a half apart, as a fast caller could: never more than the turn requests a
    // window allows (review finding S2-4), and all still in one lock slot.
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: leadText(i), locale: "de" }), {
          ...deps,
          now: () => T0 + i * 1_500,
        }),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, 200);
      await readEvents(response);
    }
    assert.equal(send.sent.length, 2);
    const state = await loadState(deps.store, sidOf(grant.sessionToken));
    assert.equal(state?.turns, 24, "no turn was lost to another one's save");
    assert.equal(state?.outcomes.length, 2);
  });

  it("parallel tool calls of a realtime provider pass no more requests than the cap", async () => {
    restoreEnv = setVoiceEnv({
      VOICE_ENABLED: "true",
      VOICE_MODE: "realtime",
      VOICE_PROVIDER: "mock",
      VOICE_SESSION_SECRET: TEST_SECRET,
      VOICE_PROVIDER_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    const send = emailRecorder();
    const deps = testDeps({ now: () => T0, resend: RESEND, sendEmail: send, provider: createMockProvider({ now: () => T0 }), lockWaitMs: 20_000 });
    const grant = await open(deps, "198.51.100.1", sessionBody({ mode: "realtime" }));
    const timestamp = Math.floor(T0 / 1000);
    const requests = Array.from({ length: 10 }, (_, i) => {
      const raw = JSON.stringify({
        sessionToken: grant.sessionToken,
        call: {
          id: `call_${i}`,
          name: "create_lead",
          input: {
            task: "project_request",
            fields: { service: "website", problem: "Eine neue Website für ein Café" },
            name: "Anna Muster",
            email: `anna${i}@example.ch`,
            summary: "Website",
          },
        },
      });
      return new Request("https://site.example/api/voice/tool", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TOOL_TIMESTAMP_HEADER]: String(timestamp),
          [TOOL_SIGNATURE_HEADER]: signWebhook(WEBHOOK_SECRET, timestamp, raw),
          [TOOL_DELIVERY_HEADER]: `delivery-${i}`,
        },
        body: raw,
      });
    });
    const results = await Promise.all(requests.map((request) => handleToolRequest(request, deps)));
    const bodies = (await Promise.all(results.map((response) => response.json()))) as Array<{ result?: { ok: boolean; code?: string } }>;
    assert.equal(bodies.filter((body) => body.result?.ok === true).length, 2);
    assert.equal(bodies.filter((body) => body.result?.code === "limit_reached").length, 8);
    assert.equal(send.sent.length, 2);
  });
});

// ---------------------------------------------------------------------------------------------
// Second review: S2-1, S2-2, S2-4, S2-6
// ---------------------------------------------------------------------------------------------

describe("review S2-1 (and sicurezza/F4, F8 for realtime): a realtime call is charged on the provider's word", () => {
  // The verifier's probe5: ten realtime sessions, one every 250 s from different IPs, never
  // connecting and never reporting their end. Each used to keep its whole call (3 minutes,
  // 0.75 CHF): the day was full after ten, the month after forty.
  it("ten sessions that never connect leave the day and the spend untouched: the eleventh is admitted", async () => {
    restoreEnv = realtimeEnv();
    let now = T0;
    const deps = testDeps({ now: () => now, provider: createMockProvider({ now: () => now }) });
    for (let i = 0; i < 10; i++) {
      now = T0 + i * 250_000;
      await open(deps, `198.51.100.${i + 1}`, sessionBody({ mode: "realtime" }));
    }
    now = T0 + 10 * 250_000;
    await open(deps, "198.51.100.11", sessionBody({ mode: "realtime" }));
    const usage = await usageSnapshot(deps.store, "modolo", now);
    assert.equal(usage.minutesToday, 0);
    assert.equal(usage.spendChfThisMonth, 0);
  });

  it("sessions the browser ends after five seconds keep nothing either, and free their slot at once", async () => {
    restoreEnv = realtimeEnv();
    let now = T0;
    const deps = testDeps({ now: () => now, provider: createMockProvider({ now: () => now }) });
    for (let i = 0; i < 12; i++) {
      now = T0 + i * 10_000;
      const grant = await open(deps, `198.51.100.${i + 1}`, sessionBody({ mode: "realtime" }));
      now += 5_000;
      assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps)).status, 200);
    }
    const usage = await usageSnapshot(deps.store, "modolo", now);
    assert.deepEqual(usage, { minutesToday: 0, minutesThisMonth: 0, spendChfThisMonth: 0, running: 0 });
  });

  it("the provider's events charge a call that connected, settle it to the seconds billed and close it", async () => {
    restoreEnv = realtimeEnv();
    let now = T0;
    const deps = testDeps({ now: () => now, provider: createMockProvider({ now: () => now }) });
    const grant = await open(deps, "198.51.100.1", sessionBody({ mode: "realtime" }));
    const sid = sidOf(grant.sessionToken);
    now = T0 + 4_000;
    const startedBody = { sessionToken: grant.sessionToken, event: { type: "started" } };
    const started = await handleToolRequest(signedToolRequest(startedBody, now, "event-1"), deps);
    assert.equal(started.status, 200);
    assert.deepEqual(await started.json(), { ok: true });
    assert.equal((await usageSnapshot(deps.store, "modolo", now)).minutesToday, 3);
    assert.equal((await handleToolRequest(signedToolRequest(startedBody, now, "event-1"), deps)).status, 409, "a replayed delivery");

    now = T0 + 80_000;
    const ended = await handleToolRequest(signedToolRequest({ sessionToken: grant.sessionToken, event: { type: "ended", seconds: 75 } }, now, "event-2"), deps);
    assert.equal(ended.status, 200);
    const usage = await usageSnapshot(deps.store, "modolo", now);
    assert.equal(usage.minutesToday, 75 / 60);
    assert.equal(usage.spendChfThisMonth, Math.ceil((75 * 250_000) / 60) / 1e6);
    assert.equal(usage.running, 0);
    assert.equal(await loadState(deps.store, sid), null, "closed like an end report");
    // The browser's late end report changes nothing.
    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps)).status, 200);
    assert.equal((await usageSnapshot(deps.store, "modolo", now)).minutesToday, 75 / 60);
  });

  it("a tool call the provider signed proves the call is live, also without a started event", async () => {
    restoreEnv = realtimeEnv();
    const deps = testDeps({ now: () => T0, provider: createMockProvider({ now: () => T0 }) });
    const grant = await open(deps, "198.51.100.1", sessionBody({ mode: "realtime" }));
    assert.equal((await usageSnapshot(deps.store, "modolo", T0)).minutesToday, 0);
    const body = { sessionToken: grant.sessionToken, call: { id: "call_end", name: "end_call", input: { reason: "caller_done" } } };
    assert.equal((await handleToolRequest(signedToolRequest(body, T0, "delivery-end"), deps)).status, 200);
    assert.equal((await usageSnapshot(deps.store, "modolo", T0)).minutesToday, 3);
  });

  it("refuses an event that is not one, and one for a session that is not a realtime one", async () => {
    restoreEnv = realtimeEnv();
    const deps = testDeps({ now: () => T0, provider: createMockProvider({ now: () => T0 }) });
    const grant = await open(deps, "198.51.100.1", sessionBody({ mode: "realtime" }));
    for (const [i, event] of [{ type: "paused" }, { type: "ended" }, { type: "ended", seconds: -1 }, { type: "ended", seconds: "75" }].entries()) {
      const response = await handleToolRequest(signedToolRequest({ sessionToken: grant.sessionToken, event }, T0, `bad-${i}`), deps);
      assert.equal(response.status, 400, JSON.stringify(event));
    }
    const example = await open(deps, "198.51.100.2", sessionBody({ mode: "scripted" }));
    const wrong = await handleToolRequest(signedToolRequest({ sessionToken: example.sessionToken, event: { type: "started" } }, T0, "wrong-mode"), deps);
    assert.equal(wrong.status, 403);
    assert.equal((await usageSnapshot(deps.store, "modolo", T0)).minutesToday, 0);
  });
});

describe("review S2-2: free requests no longer keep a local session alive", () => {
  // The verifier's probe1: ten local sessions from four IPs, one every 300 s, each sending only
  // the free opening request at +0, +50, +100 and +150 s. The repeats extended the lease each
  // time: 30 of 30 minutes with no model call, and the eleventh session was refused.
  it("repeated openings extend nothing, and the minutes of the day never refuse a local session", async () => {
    restoreEnv = localEnv();
    let now = T0;
    const deps = testDeps({ now: () => now });
    for (let i = 0; i < 10; i++) {
      const start = T0 + i * 300_000;
      now = start;
      const grant = await open(deps, `198.51.100.${(i % 4) + 1}`);
      for (const at of [0, 50_000, 100_000, 150_000]) {
        now = start + at;
        const response = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: "", opening: true, locale: "de" }), deps);
        assert.equal(response.status, 200);
        await readEvents(response);
      }
    }
    now = T0 + 10 * 300_000;
    await open(deps, "198.51.100.99");
    // One lease each, as at admission: the repeats added nothing.
    assert.equal((await usageSnapshot(deps.store, "modolo", now)).minutesToday, 11);
  });

  it("a session whose minutes the day has no room for still talks: only the model's spend stops it", async () => {
    restoreEnv = localEnv({ VOICE_MINUTES_PER_DAY: "1", VOICE_GLOBAL_MINUTES_PER_DAY: "1" });
    let now = T0;
    const deps = testDeps({ now: () => now });
    const first = await open(deps, "198.51.100.1");
    for (const at of [10_000, 70_000, 130_000]) {
      now = T0 + at;
      const response = await handleTurnRequest(post("/api/voice/turn", { sessionToken: first.sessionToken, text: "Hallo", locale: "de" }), deps);
      assert.equal(response.status, 200);
      await readEvents(response);
    }
    await open(deps, "198.51.100.2");
    assert.ok((await usageSnapshot(deps.store, "modolo", now)).minutesToday > 1, "counted, not refused");
  });
});

/** A store that counts every command sent to it (one Upstash round trip each, or two for incrBy). */
function countingStore(inner: KVStore): { store: KVStore; count: () => number; lockIncrements: () => number; reset: () => void } {
  let commands = 0;
  let lockIncrements = 0;
  const store: KVStore = {
    kind: inner.kind,
    incrBy(key, by, ttl) {
      commands += 1;
      if (key.startsWith("mva:lock:")) lockIncrements += 1;
      return inner.incrBy(key, by, ttl);
    },
    get(key) {
      commands += 1;
      return inner.get(key);
    },
    set(key, value, ttl) {
      commands += 1;
      return inner.set(key, value, ttl);
    },
  };
  return {
    store,
    count: () => commands,
    lockIncrements: () => lockIncrements,
    reset: () => {
      commands = 0;
      lockIncrements = 0;
    },
  };
}

describe("review S2-4: refused turn requests cost a few store commands, not ninety", () => {
  // The verifier's probe3: one turn holds the lock, twenty requests of the same session arrive
  // at once. Each polled the store every 100 ms for five seconds: 91 commands per request.
  it("twenty parallel requests while a turn holds the lock: most are refused at once, the rest only read", async () => {
    restoreEnv = localEnv();
    const counting = countingStore(createMemoryStore());
    const deps = testDeps({ store: counting.store, now: () => T0, lockWaitMs: 300 });
    const grant = await open(deps, "198.51.100.1");
    const held = await acquireSessionLock(counting.store, sidOf(grant.sessionToken), { clock: () => T0 });
    assert.ok(held);
    counting.reset();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: "Hallo", locale: "de" }), deps)),
    );
    const statuses = responses.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 429).length, 20 - TURN_REQUESTS_PER_WINDOW);
    assert.equal(statuses.filter((status) => status === 409).length, TURN_REQUESTS_PER_WINDOW);
    assert.equal(counting.lockIncrements(), 0, "a taken lock is only looked at");
    assert.ok(counting.count() / 20 <= 6, `${counting.count() / 20} commands per request`);
    await held.release();
  });
});

describe("review S2-6: a turn that outlives the end report does not save the conversation again", () => {
  /** A model that answers only when `finish` is called, then stores a request (create_lead). */
  function slowModel(): { model: BrainModel; finish: () => void } {
    let finish: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const inner = leadEveryTurnModel();
    const model: BrainModel = {
      id: "slow",
      async *stream(request): AsyncGenerator<ModelEvent> {
        await answered;
        yield* inner.stream(request);
      },
    };
    return { model, finish };
  }

  function endLine(): Record<string, unknown> | undefined {
    return logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((event) => event.op === "end");
  }

  it("a turn that finishes while the end report waits is saved, and the summary has what it did", async () => {
    restoreEnv = localEnv();
    const slow = slowModel();
    const deps = testDeps({ now: () => T0, model: () => slow.model, lockWaitMs: 5_000, resend: RESEND, sendEmail: emailRecorder() });
    const grant = await open(deps, "198.51.100.1");
    const turn = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: leadText(1), locale: "de" }), deps);
    assert.equal(turn.status, 200);
    const ending = handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps);
    // The end report has marked the session closed and waits for the turn's lock.
    await new Promise((resolve) => setTimeout(resolve, 30));
    slow.finish();
    await readEvents(turn);
    assert.equal((await ending).status, 200);
    const line = endLine();
    assert.equal(line?.turns, 1, "the summary was made from the state the turn saved");
    assert.equal(line?.outcomes, 1);
    assert.equal(await loadState(deps.store, sidOf(grant.sessionToken)), null);
  });

  it("the end report stops waiting, closes the session, and the turn then leaves no state behind", async () => {
    restoreEnv = localEnv();
    const slow = slowModel();
    const deps = testDeps({ now: () => T0, model: () => slow.model, lockWaitMs: 50 });
    const grant = await open(deps, "198.51.100.1");
    const sid = sidOf(grant.sessionToken);
    const turn = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: leadText(2), locale: "de" }), deps);
    assert.equal(turn.status, 200);
    const ended = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps);
    assert.equal(ended.status, 200);
    assert.equal(await loadState(deps.store, sid), null);
    slow.finish();
    await readEvents(turn);
    assert.equal(await loadState(deps.store, sid), null, "what the caller said is not kept after the end");
  });
});
