// Regression tests of the third fix round: the development outbox (VOICE_DEV_OUTBOX), the spend
// alerts by email (VOICE_ALERT_EMAIL), and the addendum of a turn that finished after the end of
// its session had stopped waiting for it (the gap left by review finding S2-6). Finding S2-11 (a
// second party at the same time) is covered next to the booking rules, in tools.test.ts. Nothing
// here calls a real provider or sends email: every sender is a fake.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createMemoryStore } from "@/lib/assistant/server/store";
import { getCalendar } from "@/lib/voice/calendar";
import { DEMO_TENANTS, getDemoTenant } from "@/lib/voice/demos";
import { markerKey, renderSpendAlert, reportCeilingRefusal, reportSpend, type AlertDelivery } from "@/lib/voice/server/alerts";
import type { BrainModel, ModelEvent } from "@/lib/voice/server/brain";
import { getVoiceEnv, resetVoiceEnvForTests } from "@/lib/voice/server/env";
import { handleEndRequest, handleSessionRequest, handleTurnRequest, type VoiceDeps } from "@/lib/voice/server/handlers";
import { reserveTurnSpend } from "@/lib/voice/server/limits";
import {
  clearDevOutboxForTests,
  DEV_OUTBOX_FROM,
  DEV_OUTBOX_PREFIX,
  devOutboxMessages,
  devOutboxSwitchedOn,
} from "@/lib/voice/server/outbox";
import { createSessionSinks } from "@/lib/voice/server/session";
import { createSessionState, loadState, type VoiceSessionState } from "@/lib/voice/server/state";
import {
  canDeliverSummary,
  deliverLateOutcomes,
  deliverSummary,
  endOfCallSummary,
  voiceEmailTransport,
  type SendEmail,
} from "@/lib/voice/server/summary";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import type { Booking, CallSummary, SessionGrant, TurnStreamEvent, VoiceTenantConfig } from "@/lib/voice/types";
import { captureLogs, localEnv, post, readEvents, readGrant, sessionBody, setVoiceEnv, TEST_SECRET, testDeps } from "./voice-fixtures";

/** Wednesday 2 December 2026, 10:00 in Zurich. */
const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);
const RESEND = { apiKey: "re_test_key", from: "Modolo Digital Studio <test@example.ch>" };
const OWNER = "owner@example.ch";
const LEAD_INPUT = {
  task: "project_request",
  fields: { service: "website", problem: "Eine neue Website für ein Café" },
  name: "Anna Muster",
  email: "anna@example.ch",
  summary: "Website",
};

// Next types NODE_ENV as read-only; tests write through a plain view.
const mutableEnv: Record<string, string | undefined> = process.env;

let restoreEnv: () => void = () => undefined;
let logs: string[] = [];
beforeEach(() => {
  logs = captureLogs();
  clearDevOutboxForTests();
});
afterEach(() => {
  restoreEnv();
  restoreEnv = () => undefined;
  mock.restoreAll();
  clearDevOutboxForTests();
});

/**
 * setVoiceEnv() with VOICE_DEV_OUTBOX as well: the shared fixtures do not list it, so it is set
 * (or removed) here and restored with the rest.
 */
function withDevOutbox(value: string | undefined, apply: () => () => void): () => void {
  const saved = mutableEnv.VOICE_DEV_OUTBOX;
  if (value === undefined) delete mutableEnv.VOICE_DEV_OUTBOX;
  else mutableEnv.VOICE_DEV_OUTBOX = value;
  const restore = apply();
  return () => {
    restore();
    if (saved === undefined) delete mutableEnv.VOICE_DEV_OUTBOX;
    else mutableEnv.VOICE_DEV_OUTBOX = saved;
    resetVoiceEnvForTests();
  };
}

function recorder(answer: (email: Parameters<SendEmail>[0]) => Promise<boolean | "unknown"> = async () => true) {
  const sent: Parameters<SendEmail>[0][] = [];
  const send: SendEmail = async (email) => {
    sent.push(email);
    return answer(email);
  };
  return { send, sent };
}

/** Collects what a route hands to keepAlive, so a test can wait for the emails it did not await. */
function keepAliveCollector(): { keepAlive: (work: Promise<unknown>) => void; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    keepAlive: (work) => {
      pending.push(work);
    },
    settled: async () => {
      await Promise.allSettled(pending);
    },
  };
}

async function open(deps: VoiceDeps, ip: string, body: Record<string, unknown> = sessionBody()): Promise<SessionGrant> {
  const response = await handleSessionRequest(post("/api/voice/session", body, { "x-real-ip": ip }), deps);
  assert.equal(response.status, 200, `session refused: ${await response.clone().text()}`);
  return readGrant(response);
}

function sidOf(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).sid as string;
}

async function turn(deps: VoiceDeps, grant: SessionGrant, text: string): Promise<{ status: number; events: TurnStreamEvent[] }> {
  const response = await handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text, locale: "de" }), deps);
  return { status: response.status, events: response.status === 200 ? await readEvents(response) : [] };
}

const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * A model that calls one tool per turn (`input(turnIndex)`), then says "Erledigt.". `hold`, when
 * set at the start of a turn, keeps that turn waiting until it resolves.
 */
function toolModel(name: string, input: (turnIndex: number) => Record<string, unknown>): BrainModel & { hold: Promise<void> | null } {
  let turns = 0;
  const model = {
    id: "tool-model",
    hold: null as Promise<void> | null,
    async *stream(request: Parameters<BrainModel["stream"]>[0]): AsyncGenerator<ModelEvent> {
      const last = request.messages[request.messages.length - 1];
      const afterTool = Array.isArray(last.content) && last.content.some((block) => block.type === "tool_result");
      if (afterTool) {
        yield { type: "text", text: "Erledigt." };
        yield { type: "end", content: [{ type: "text", text: "Erledigt." }], stopReason: "end_turn", model: "claude-haiku-5-5", usage: USAGE };
        return;
      }
      const index = turns;
      turns += 1;
      if (model.hold) await model.hold;
      yield { type: "text", text: "Einen Moment." };
      yield {
        type: "end",
        content: [
          { type: "text", text: "Einen Moment." },
          { type: "tool_use", id: `toolu_${name}_${index}`, name, input: input(index) },
        ],
        stopReason: "tool_use",
        model: "claude-haiku-5-5",
        usage: USAGE,
      };
    },
  };
  return model;
}

/** A model that answers briefly and reports 1'980 micro-CHF of usage per call (0.90 CHF/USD). */
function meteredModel(): BrainModel {
  return {
    id: "metered",
    async *stream(): AsyncGenerator<ModelEvent> {
      yield { type: "text", text: "Gern." };
      yield {
        type: "end",
        content: [{ type: "text", text: "Gern." }],
        stopReason: "end_turn",
        model: "claude-haiku-5-5",
        usage: { inputTokens: 20_000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

function toolStatus(events: readonly TurnStreamEvent[], name: string): string | undefined {
  return events.filter((event): event is Extract<TurnStreamEvent, { type: "tool" }> => event.type === "tool" && event.name === name).at(-1)
    ?.status;
}

// ---------------------------------------------------------------------------------------------
// The development outbox
// ---------------------------------------------------------------------------------------------

describe("VOICE_DEV_OUTBOX: the happy path on a laptop, without sending anything", () => {
  it("in development without Resend, a request is printed under the prefix, kept, and counts as passed on", async () => {
    restoreEnv = withDevOutbox("true", () => localEnv());
    assert.equal(getVoiceEnv().devOutbox, true);
    assert.equal(voiceEmailTransport(null), "dev_outbox");
    assert.equal(canDeliverSummary(MODOLO_VOICE_TENANT, null), true);

    const model = toolModel("create_lead", () => LEAD_INPUT);
    const deps = testDeps({ now: () => T0, model: () => model });
    const grant = await open(deps, "198.51.100.1");
    const result = await turn(deps, grant, "Ich möchte eine Offerte.");
    assert.equal(result.status, 200);
    assert.equal(toolStatus(result.events, "create_lead"), "ok", "the caller hears that it was passed on");

    const kept = devOutboxMessages();
    assert.equal(kept.length, 1);
    assert.equal(kept[0].to, MODOLO_VOICE_TENANT.notifyEmail);
    assert.equal(kept[0].from, DEV_OUTBOX_FROM);
    assert.equal(kept[0].replyTo, "anna@example.ch");
    assert.match(kept[0].text, /Anna Muster/);
    const printed = logs.filter((line) => line.startsWith(DEV_OUTBOX_PREFIX));
    assert.ok(printed.length > 0, "printed on the server console");
    const block = printed.join("\n");
    for (const line of block.split("\n")) assert.ok(line.startsWith(DEV_OUTBOX_PREFIX), line);
    assert.match(block, /NOT sent/);
    assert.match(block, /Anna Muster/, "printed in full");
    assert.match(block, new RegExp(`To: ${MODOLO_VOICE_TENANT.notifyEmail}`));

    // The end of the call: the request went out already, so there is nothing more to send.
    const ended = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps);
    assert.equal(ended.status, 200);
    assert.equal(devOutboxMessages().length, 1);
  });

  it("the end-of-call summary of a live tenant goes to the outbox too, and a repeat with the same key is kept once", async () => {
    restoreEnv = withDevOutbox("true", () => localEnv());
    const state = sessionStateWith([{ kind: "cancellation", ref: "MV-2345" }]);
    const first = await deliverSummary({ summary: endOfCallSummary(state, MODOLO_VOICE_TENANT, T0 + 60_000), tenant: MODOLO_VOICE_TENANT, resend: null });
    assert.deepEqual(first, { sent: true });
    const request = { kind: "lead" as const, taskId: "project_request", ref: "LD-7K2Q", fields: { service: "website" }, contact: { name: "Anna" } };
    const summary = { ...endOfCallSummary(state, MODOLO_VOICE_TENANT, T0), outcomes: [request], noOutcome: false };
    assert.deepEqual(await deliverSummary({ summary, tenant: MODOLO_VOICE_TENANT, resend: null, idempotencyKey: "k1" }), { sent: true });
    assert.deepEqual(await deliverSummary({ summary, tenant: MODOLO_VOICE_TENANT, resend: null, idempotencyKey: "k1" }), { sent: true });
    assert.equal(devOutboxMessages().length, 2);
  });

  it("switched off, nothing changes: the request is not passed on and nothing is kept", async () => {
    restoreEnv = withDevOutbox(undefined, () => localEnv());
    assert.equal(getVoiceEnv().devOutbox, false);
    assert.equal(voiceEmailTransport(null), "none");
    const model = toolModel("create_lead", () => LEAD_INPUT);
    const deps = testDeps({ now: () => T0, model: () => model });
    const grant = await open(deps, "198.51.100.1");
    const result = await turn(deps, grant, "Ich möchte eine Offerte.");
    assert.equal(toolStatus(result.events, "create_lead"), "failed");
    assert.equal(devOutboxMessages().length, 0);
    assert.equal(logs.filter((line) => line.startsWith(DEV_OUTBOX_PREFIX)).length, 0);
  });

  it("with Resend configured the switch changes nothing: the email service gets the request", async () => {
    restoreEnv = withDevOutbox("true", () => localEnv());
    assert.equal(voiceEmailTransport(RESEND), "resend");
    const email = recorder();
    const sinks = createSessionSinks(MODOLO_VOICE_TENANT, RESEND, { send: email.send });
    const lead = await sinks.lead({
      tenant: "modolo",
      sessionId: "outboxTestSession0001",
      taskId: "project_request",
      fields: { service: "website" },
      contact: { name: "Anna Muster", email: "anna@example.ch" },
      summary: "Website",
      locale: "de",
    });
    assert.equal(lead.ok, true);
    assert.equal(email.sent.length, 1);
    assert.equal(devOutboxMessages().length, 0);
  });

  it("is ignored in production, whatever its value", async () => {
    for (const value of ["true", "1", "yes", "on"]) {
      restoreEnv = withDevOutbox(value, () => setVoiceEnv({ NODE_ENV: "production", VOICE_ENABLED: "true", VOICE_SESSION_SECRET: TEST_SECRET }));
      assert.equal(getVoiceEnv().devOutbox, false, value);
      assert.equal(devOutboxSwitchedOn(), false);
      assert.equal(voiceEmailTransport(null), "none");
      assert.equal(canDeliverSummary(MODOLO_VOICE_TENANT, null), false);
      const summary = { ...endOfCallSummary(sessionStateWith([{ kind: "cancellation", ref: "MV-2345" }]), MODOLO_VOICE_TENANT, T0) };
      assert.deepEqual(await deliverSummary({ summary, tenant: MODOLO_VOICE_TENANT, resend: null }), { sent: false, reason: "email_not_configured" });
      const lead = await createSessionSinks(MODOLO_VOICE_TENANT, null).lead({
        tenant: "modolo",
        sessionId: "outboxTestSession0002",
        taskId: "project_request",
        fields: { service: "website" },
        contact: { name: "Anna Muster", email: "anna@example.ch" },
        summary: "Website",
        locale: "de",
      });
      assert.equal(lead.ok, false, "never 'passed on' in production without an email service");
      assert.equal(devOutboxMessages().length, 0);
      restoreEnv();
      restoreEnv = () => undefined;
    }
    assert.ok(logs.some((line) => line.includes("voice_dev_outbox_ignored")));
  });

  it("is off as soon as NODE_ENV says production, even with a configuration read before", () => {
    restoreEnv = withDevOutbox("true", () => localEnv());
    assert.equal(getVoiceEnv().devOutbox, true);
    assert.equal(devOutboxSwitchedOn(), true);
    mutableEnv.NODE_ENV = "production";
    // The cached configuration still says on; the outbox reads NODE_ENV again.
    assert.equal(getVoiceEnv().devOutbox, true);
    assert.equal(devOutboxSwitchedOn(), false);
    assert.equal(voiceEmailTransport(null), "none");
  });
});

function sessionStateWith(outcomes: CallSummary["outcomes"], tenant: VoiceTenantConfig = MODOLO_VOICE_TENANT): VoiceSessionState {
  const state = createSessionState({
    tenantId: tenant.id,
    sessionId: "reviewThreeSession0001",
    mode: "local",
    channel: "web",
    locale: "de",
    startedAt: T0,
    reservation: null,
  });
  state.outcomes.push(...outcomes);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Spend alerts
// ---------------------------------------------------------------------------------------------

describe("VOICE_ALERT_EMAIL: one plain email per threshold and month", () => {
  function delivery(send: SendEmail, extra: Partial<AlertDelivery> = {}): AlertDelivery & { settled: () => Promise<void> } {
    const collector = keepAliveCollector();
    return { alertEmail: OWNER, resend: RESEND, send, keepAlive: collector.keepAlive, settled: collector.settled, ...extra };
  }

  it("sends one email per threshold crossed, in Italian, without caller data, and never twice", async () => {
    const store = createMemoryStore();
    const email = recorder();
    const d = delivery(email.send);
    const report = (before: number, after: number) =>
      reportSpend({ store, tenantId: "modolo", month: "2026-12", spend: { beforeChf: before, afterChf: after }, budgetChf: 30, delivery: d });
    await report(10, 16);
    await d.settled();
    assert.equal(email.sent.length, 1);
    const [first] = email.sent;
    assert.equal(first.to, OWNER);
    assert.equal(first.from, RESEND.from);
    assert.equal(first.subject, "Assistente vocale: spesa al 50% del tetto del mese (tenant modolo, dicembre 2026)");
    assert.match(first.text, /Spesa stimata finora: CHF 16\.00/);
    assert.match(first.text, /Tetto del mese: CHF 30\.00/);
    assert.match(first.text, /Mese: dicembre 2026/);
    assert.match(first.text, /VOICE_ENABLED=false/);
    assert.equal(first.idempotencyKey, "mva-alert-modolo-2026-12-50");

    // A reservation given back and taken again crosses the same line: no second email.
    await report(14, 17);
    await report(23, 31);
    await d.settled();
    assert.deepEqual(
      email.sent.map((sent) => sent.idempotencyKey),
      ["mva-alert-modolo-2026-12-50", "mva-alert-modolo-2026-12-80", "mva-alert-modolo-2026-12-100"],
    );
    assert.match(email.sent[1].subject, /all'80% del tetto/);
    assert.equal(email.sent[2].subject, "Assistente vocale: tetto di spesa del mese raggiunto (tenant modolo, dicembre 2026)");
    await report(0, 40);
    await d.settled();
    assert.equal(email.sent.length, 3);
    // The next month starts over.
    await reportSpend({ store, tenantId: "modolo", month: "2027-01", spend: { beforeChf: 0, afterChf: 16 }, budgetChf: 30, delivery: d });
    await d.settled();
    assert.equal(email.sent.length, 4);
    assert.match(email.sent[3].subject, /gennaio 2027/);
  });

  it("parallel requests and other instances sharing the store send one email", async () => {
    const store = createMemoryStore();
    const email = recorder();
    const d = delivery(email.send);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        reportSpend({ store, tenantId: "modolo", month: "2026-12", spend: { beforeChf: 14, afterChf: 15.5 }, budgetChf: 30, delivery: d }),
      ),
    );
    await d.settled();
    assert.equal(email.sent.length, 1);
    assert.equal(logs.filter((line) => line.includes("voice_spend_threshold")).length, 1);
  });

  it("covers the ceiling of all tenants together", async () => {
    const store = createMemoryStore();
    const email = recorder();
    const d = delivery(email.send);
    await reportSpend({
      store,
      tenantId: "modolo",
      month: "2026-12",
      spend: { beforeChf: 1, afterChf: 2 },
      budgetChf: 30,
      globalSpend: { beforeChf: 39, afterChf: 40.5 },
      globalBudgetChf: 50,
      delivery: d,
    });
    await d.settled();
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0].subject, "Assistente vocale: spesa all'80% del tetto del mese (tutti i tenant insieme, dicembre 2026)");
    assert.equal(email.sent[0].idempotencyKey, "mva-alert-all-2026-12-80");
    assert.ok(logs.some((line) => line.includes('"kind":"global"')));
  });

  it("sends nothing without the address or without Resend, and logs the crossing once either way", async () => {
    const email = recorder();
    const noAddress = delivery(email.send, { alertEmail: null });
    const store = createMemoryStore();
    await reportSpend({ store, tenantId: "modolo", month: "2026-12", spend: { beforeChf: 0, afterChf: 16 }, budgetChf: 30, delivery: noAddress });
    await noAddress.settled();
    assert.equal(email.sent.length, 0);
    assert.equal(logs.filter((line) => line.includes("voice_spend_threshold")).length, 1);

    const noResend = delivery(email.send, { resend: null });
    await reportSpend({ store: createMemoryStore(), tenantId: "modolo", month: "2026-12", spend: { beforeChf: 0, afterChf: 16 }, budgetChf: 30, delivery: noResend });
    await noResend.settled();
    assert.equal(email.sent.length, 0);
    assert.ok(logs.some((line) => line.includes("voice_alert_not_sent") && line.includes("email_not_configured")));
  });

  it("an email that fails, throws or never answers costs the caller nothing", async () => {
    for (const answer of [
      async () => false,
      async () => "unknown" as const,
      async () => {
        throw new Error("boom");
      },
      () => new Promise<boolean>(() => undefined),
    ]) {
      const send: SendEmail = () => answer() as Promise<boolean | "unknown">;
      const d = delivery(send);
      const started = Date.now();
      await reportSpend({ store: createMemoryStore(), tenantId: "modolo", month: "2026-12", spend: { beforeChf: 0, afterChf: 16 }, budgetChf: 30, delivery: d });
      assert.ok(Date.now() - started < 1_000, "not awaited");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(logs.some((line) => line.includes("voice_alert_not_sent") && line.includes("send_failed")));
  });

  it("a ceiling that refuses a charge reports the 100% alert, once, for each scope it stops", async () => {
    const store = createMemoryStore();
    const limits = { budgetChfPerMonth: 1 };
    const reserved = await reserveTurnSpend({ store, tenantId: "modolo", sessionId: "a".repeat(32), limits, micro: 990_000, now: T0 });
    assert.ok(reserved.ok);
    const email = recorder();
    const d = delivery(email.send);
    const refuse = (globalBudgetChf: number) =>
      reportCeilingRefusal({ store, tenantId: "modolo", roomChf: 0.02, budgetChf: 1, globalBudgetChf, now: T0, delivery: d });
    await refuse(50);
    await refuse(50);
    await d.settled();
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0].subject, "Assistente vocale: tetto di spesa del mese raggiunto (tenant modolo, dicembre 2026)");
    assert.match(email.sent[0].text, /Spesa stimata finora: CHF 0\.99/);
    await refuse(1);
    await d.settled();
    assert.equal(email.sent.length, 2);
    assert.match(email.sent[1].subject, /tutti i tenant insieme/);
    // Room to spare, a ceiling of 0 (switched off) or nothing spent yet: no alert.
    const other = createMemoryStore();
    await reportCeilingRefusal({ store: other, tenantId: "modolo", roomChf: 0.02, budgetChf: 30, globalBudgetChf: 0, now: T0, delivery: d });
    await d.settled();
    assert.equal(email.sent.length, 2);
  });

  it("through the turn route: 50, 80 and 100% each reach the owner once, the last one from the refused turn", async () => {
    restoreEnv = localEnv({ VOICE_BUDGET_CHF_PER_MONTH: "0.03", VOICE_ALERT_EMAIL: OWNER });
    const email = recorder();
    const collector = keepAliveCollector();
    let now = T0;
    const deps = testDeps({ now: () => now, model: () => meteredModel(), resend: RESEND, sendEmail: email.send, keepAlive: collector.keepAlive });
    const grant = await open(deps, "198.51.100.1");
    let refusals = 0;
    for (let index = 0; index < 30 && refusals < 3; index++) {
      now = T0 + index * 2_000;
      const result = await turn(deps, grant, `Frage ${index}`);
      if (result.status === 503) refusals += 1;
      else assert.equal(result.events.at(-1)?.type, "done", `turn ${index}: ${result.status}`);
    }
    assert.equal(refusals, 3, "the ceiling stopped the turns");
    await collector.settled();
    const keys = () =>
      email.sent
        .filter((sent) => sent.to === OWNER)
        .map((sent) => sent.idempotencyKey)
        .sort();
    const expected = ["mva-alert-modolo-2026-12-100", "mva-alert-modolo-2026-12-50", "mva-alert-modolo-2026-12-80"];
    assert.deepEqual(keys(), expected);
    // A new conversation is turned away as well; it does not repeat the alert.
    const refused = await handleSessionRequest(post("/api/voice/session", sessionBody(), { "x-real-ip": "198.51.100.2" }), deps);
    assert.equal(refused.status, 503);
    await collector.settled();
    assert.deepEqual(keys(), expected);
    const alerts = email.sent.filter((sent) => sent.to === OWNER);
    for (const alert of alerts) {
      assert.doesNotMatch(alert.text, /Frage/);
      assert.match(alert.text, /Tetto del mese: CHF 0\.03/);
    }
  });

  it("through the turn route: alert emails that throw do not break a turn", async () => {
    restoreEnv = localEnv({ VOICE_BUDGET_CHF_PER_MONTH: "0.03", VOICE_ALERT_EMAIL: OWNER });
    const send: SendEmail = async () => {
      throw new Error("resend down");
    };
    const collector = keepAliveCollector();
    let now = T0;
    const deps = testDeps({ now: () => now, model: () => meteredModel(), resend: RESEND, sendEmail: send, keepAlive: collector.keepAlive });
    const grant = await open(deps, "198.51.100.1");
    let completed = 0;
    for (let index = 0; index < 30; index++) {
      now = T0 + index * 2_000;
      const result = await turn(deps, grant, `Frage ${index}`);
      if (result.status === 503) break;
      assert.equal(result.events.at(-1)?.type, "done", `turn ${index}: ${result.status}`);
      completed += 1;
    }
    await collector.settled();
    assert.ok(completed > 0);
    assert.equal(logs.filter((line) => line.includes("voice_spend_threshold")).length, 3, "50, 80 and 100% were reached");
    assert.equal(logs.filter((line) => line.includes("voice_alert_not_sent") && line.includes("send_failed")).length, 3);
  });

  it("the markers are per scope, month and threshold", () => {
    assert.equal(markerKey({ tenantId: "modolo", month: "2026-12", percent: 80 }), "mva:alert:modolo:2026-12:80");
    assert.equal(markerKey({ tenantId: null, month: "2026-12", percent: 80 }), "mva:alert:*all*:2026-12:80");
    assert.equal(renderSpendAlert({ tenantId: null, month: "2026-12", percent: 50, spentChf: 1234.5, budgetChf: 2500 }).text.includes("CHF 1'234.50"), true);
  });
});

// ---------------------------------------------------------------------------------------------
// The addendum of a late turn (S2-6)
// ---------------------------------------------------------------------------------------------

describe("review S2-6, the gap: what a turn did after the summary was made reaches the business as an addendum", () => {
  const BOOKING_A: Booking = {
    ref: "MV-AAAA",
    serviceId: "women_cut",
    start: "2026-12-04T09:00:00+01:00",
    end: "2026-12-04T10:00:00+01:00",
    name: "Sarah Collins",
    contact: "+41780000044",
    status: "confirmed",
    createdAt: new Date(T0).toISOString(),
  };
  const BOOKING_B: Booking = { ...BOOKING_A, ref: "MV-BBBB", start: "2026-12-04T11:00:00+01:00", end: "2026-12-04T12:00:00+01:00" };
  const LIVE: VoiceTenantConfig = { ...(getDemoTenant("demo-coiffeur") ?? DEMO_TENANTS[0]), kind: "live", notifyEmail: OWNER };

  it("holds exactly the outcomes after `since`, without the requests that went out at once", async () => {
    const email = recorder();
    const state = sessionStateWith(
      [
        { kind: "booking", booking: BOOKING_A },
        { kind: "lead", taskId: "x", ref: "LD-AAAA", fields: {}, contact: {} },
        { kind: "booking", booking: BOOKING_B },
        { kind: "cancellation", ref: "MV-CCCC" },
      ],
      LIVE,
    );
    const delivery = await deliverLateOutcomes({ state, tenant: LIVE, since: 1, resend: RESEND, send: email.send, now: T0 + 90_000 });
    assert.deepEqual(delivery, { sent: true });
    assert.equal(email.sent.length, 1);
    const [sent] = email.sent;
    assert.equal(sent.to, OWNER);
    assert.match(sent.subject, /– Nachtrag: Termin gebucht: .*MV-BBBB \(und 1 weitere\)$/);
    assert.match(sent.text, /^Nachtrag: Der KI-Sprachassistent hat dies ganz am Ende des Gesprächs erledigt, deshalb kommt es separat\./);
    assert.match(sent.text, /MV-BBBB/);
    assert.match(sent.text, /MV-CCCC/);
    assert.doesNotMatch(sent.text, /MV-AAAA|LD-AAAA/);
    assert.doesNotMatch(sent.text, /Dauer:/, "the summary had the length of the call");
    assert.equal(sent.idempotencyKey, `mva-late-${state.sessionId}-1`);
    // Nothing new, or only a request that went out at once: no email.
    assert.equal(await deliverLateOutcomes({ state, tenant: LIVE, since: 4, resend: RESEND, send: email.send }), null);
    const onlyLead = sessionStateWith([{ kind: "lead", taskId: "x", ref: "LD-AAAA", fields: {}, contact: {} }], LIVE);
    assert.equal(await deliverLateOutcomes({ state: onlyLead, tenant: LIVE, since: 0, resend: RESEND, send: email.send }), null);
    // A demo business never sends email.
    const demo = { ...LIVE, kind: "demo" as const };
    assert.deepEqual(await deliverLateOutcomes({ state, tenant: demo, since: 1, resend: RESEND, send: email.send }), { sent: false, reason: "demo_tenant" });
    assert.equal(email.sent.length, 1);
  });

  it("speaks the tenant's language", async () => {
    const expected: Record<string, RegExp> = { it: /– Aggiunta: /, en: /– Addendum: /, fr: /– Complément : / };
    for (const [locale, subject] of Object.entries(expected)) {
      const email = recorder();
      const tenant = { ...LIVE, defaultLocale: locale as VoiceTenantConfig["defaultLocale"] };
      const state = sessionStateWith([{ kind: "booking", booking: BOOKING_B }], tenant);
      await deliverLateOutcomes({ state, tenant, since: 0, resend: RESEND, send: email.send });
      assert.match(email.sent[0].subject, subject, locale);
    }
  });

  it("through the routes: the summary has the first booking, the addendum only the one booked after the end stopped waiting", async () => {
    // A demo business made live for this test only: the summary and the addendum are emailed to
    // live tenants alone, and Modolo's assistant has no calendar.
    const tenant = DEMO_TENANTS.find((candidate) => candidate.tools.includes("book_appointment") && candidate.calendar?.provider === "memory");
    assert.ok(tenant?.calendar, "a demo business with a calendar");
    const saved = { kind: tenant.kind, notifyEmail: tenant.notifyEmail };
    const mutable = tenant as { kind: VoiceTenantConfig["kind"]; notifyEmail?: string };
    mutable.kind = "live";
    mutable.notifyEmail = OWNER;
    try {
      restoreEnv = localEnv();
      const service = tenant.calendar.services[0].id;
      const starts: string[] = [];
      for (let day = 1; day <= 14 && starts.length < 2; day++) {
        const date = new Date(T0 + day * 86_400_000).toISOString().slice(0, 10);
        const slots = await getCalendar(tenant)?.findSlots({ serviceId: service, date, now: new Date(T0) });
        if (slots?.ok && slots.value.length >= 2) starts.push(slots.value[0].start, slots.value[slots.value.length - 1].start);
      }
      assert.equal(starts.length, 2, "two free starts");
      const names = ["Sarah Collins", "Peter Meier"];
      const model = toolModel("book_appointment", (index) => ({ service, start: starts[index], name: names[index], contact: `+4178000004${index}` }));
      const email = recorder();
      const deps = testDeps({ now: () => T0, model: () => model, lockWaitMs: 50, resend: RESEND, sendEmail: email.send });
      const grant = await open(deps, "198.51.100.1", sessionBody({ tenant: tenant.id, locale: tenant.defaultLocale }));
      const sid = sidOf(grant.sessionToken);

      const first = await turn(deps, grant, "Einen Termin bitte.");
      assert.equal(toolStatus(first.events, "book_appointment"), "ok");

      let release: () => void = () => undefined;
      model.hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const late = handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: "Und noch einen.", locale: "de" }), deps);
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The end report stops waiting for the running turn and sends the summary it can make.
      const ended = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps);
      assert.equal(ended.status, 200);
      assert.equal(email.sent.length, 1);
      const refs = (text: string) => [...text.matchAll(/MV-[0-9A-Z]{4,8}/g)].map((match) => match[0]);
      const summaryRefs = refs(email.sent[0].text);
      assert.equal(summaryRefs.length, 1, "the summary has the first booking only");
      assert.doesNotMatch(email.sent[0].subject, /Nachtrag/);

      release();
      const lateEvents = await readEvents(await late);
      assert.equal(toolStatus(lateEvents, "book_appointment"), "ok", "the calendar has it");
      assert.equal(email.sent.length, 2, "an addendum");
      const addendum = email.sent[1];
      assert.equal(addendum.to, OWNER);
      assert.match(addendum.subject, /Nachtrag/);
      const addendumRefs = refs(addendum.text);
      assert.equal(addendumRefs.length, 1);
      assert.notEqual(addendumRefs[0], summaryRefs[0], "exactly what the summary could not contain");
      assert.match(addendum.text, /Peter Meier/);
      assert.equal(addendum.idempotencyKey, `mva-late-${sid}-1`);
      assert.equal(await loadState(deps.store, sid), null, "what the caller said is not kept after the end");
      assert.ok(logs.some((line) => line.includes('"op":"late_outcomes"') && line.includes('"delivery":"sent"')));
    } finally {
      mutable.kind = saved.kind;
      if (saved.notifyEmail === undefined) delete mutable.notifyEmail;
      else mutable.notifyEmail = saved.notifyEmail;
    }
  });

  it("a turn the end report waited for is in the summary: no addendum", async () => {
    restoreEnv = localEnv();
    const model = toolModel("create_lead", () => LEAD_INPUT);
    const email = recorder();
    const deps = testDeps({ now: () => T0, model: () => model, lockWaitMs: 5_000, resend: RESEND, sendEmail: email.send });
    const grant = await open(deps, "198.51.100.1");
    let release: () => void = () => undefined;
    model.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = handleTurnRequest(post("/api/voice/turn", { sessionToken: grant.sessionToken, text: "Offerte", locale: "de" }), deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const ending = handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await readEvents(await running);
    assert.equal((await ending).status, 200);
    // The request went out at once; the summary has nothing else; nothing came late.
    assert.equal(email.sent.length, 1);
    assert.doesNotMatch(email.sent[0].subject, /Nachtrag/);
    assert.ok(!logs.some((line) => line.includes('"op":"late_outcomes"')));
  });
});
