// The call summary (lib/voice/server/summary.ts): built in the order things happened, rendered as
// a factual plain-text email in the tenant's language, and delivered only for a live tenant with a
// recipient, an outcome and an email service. Demo tenants never send email.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { getDemoTenant } from "@/lib/voice/demos";
import { createSessionState, type VoiceSessionState } from "@/lib/voice/server/state";
import {
  buildCallSummary,
  canDeliverSummary,
  deliverRequest,
  deliverSummary,
  endOfCallSummary,
  renderSummaryEmail,
  type SendEmail,
} from "@/lib/voice/server/summary";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import type { CallSummary, VoiceTenantConfig } from "@/lib/voice/types";

const STARTED = Date.UTC(2026, 11, 2, 9, 0, 0); // 10:00 in Zurich
const RESEND = { apiKey: "re_test_key", from: "Modolo Digital Studio <test@example.ch>" };

function sessionState(outcomes: CallSummary["outcomes"], tenant: VoiceTenantConfig = MODOLO_VOICE_TENANT): VoiceSessionState {
  const state = createSessionState({
    tenantId: tenant.id,
    sessionId: "summaryTestSession0001",
    mode: "local",
    channel: "web",
    locale: "it",
    startedAt: STARTED,
    reservation: null,
  });
  state.outcomes.push(...outcomes);
  return state;
}

const LEAD: CallSummary["outcomes"][number] = {
  kind: "lead",
  taskId: "project_request",
  ref: "LD-7K2Q",
  fields: { service: "website", problem: "Neue Website\nFAKE: line" },
  contact: { name: "Anna Muster", email: "anna@example.ch" },
};

function recorder(result = true): SendEmail & { sent: Parameters<SendEmail>[0][] } {
  const sent: Parameters<SendEmail>[0][] = [];
  const send = (async (email) => {
    sent.push(email);
    return result;
  }) as SendEmail & { sent: Parameters<SendEmail>[0][] };
  send.sent = sent;
  return send;
}

beforeEach(() => {
  mock.method(console, "log", () => undefined);
});
afterEach(() => mock.restoreAll());

describe("buildCallSummary", () => {
  it("keeps the outcomes in the order they happened", () => {
    const callback: CallSummary["outcomes"][number] = { kind: "callback", name: "Anna Muster", phone: "+41791234567", topic: "Offerte" };
    const summary = buildCallSummary(sessionState([LEAD, callback, { kind: "cancellation", ref: "MV-2345" }]), MODOLO_VOICE_TENANT, STARTED + 135_000);
    assert.deepEqual(
      summary.outcomes.map((outcome) => outcome.kind),
      ["lead", "callback", "cancellation"],
    );
    assert.equal(summary.durationSeconds, 135);
    assert.equal(summary.startedAt, new Date(STARTED).toISOString());
    assert.equal(summary.noOutcome, false);
    assert.equal(summary.tenant, "modolo");
    assert.equal(summary.locale, "it");
  });

  it("says when a call ended without any outcome", () => {
    const summary = buildCallSummary(sessionState([]), MODOLO_VOICE_TENANT, new Date(STARTED + 20_000));
    assert.equal(summary.noOutcome, true);
    assert.deepEqual(summary.outcomes, []);
    assert.equal(summary.durationSeconds, 20);
  });
});

describe("renderSummaryEmail", () => {
  it("writes the facts in the tenant's default language, without the sharp s", () => {
    const summary = buildCallSummary(sessionState([LEAD]), MODOLO_VOICE_TENANT, STARTED + 75_000);
    const { subject, text } = renderSummaryEmail(summary, MODOLO_VOICE_TENANT);
    assert.equal(subject, "Sprachassistent Modolo Digital Studio – Anfrage: Projektanfrage, Referenz LD-7K2Q");
    assert.match(text, /^Der KI-Sprachassistent hat dieses Gespräch geführt\./);
    assert.match(text, /Beginn: 02\.12\.2026 10:00 \(Europe\/Zurich\)/);
    assert.match(text, /Dauer: 1 Min\. 15 Sek\./);
    assert.match(text, /Sprache: Italienisch/);
    assert.match(text, /1\. Anfrage: Projektanfrage, Referenz LD-7K2Q/);
    assert.match(text, /Leistung: Website/);
    assert.match(text, /E-Mail: anna@example\.ch/);
    assert.equal(text.includes("ß"), false);
    assert.equal(text.includes("!"), false);
  });

  it("flattens line breaks a caller put into a value: no faked lines", () => {
    const { text } = renderSummaryEmail(buildCallSummary(sessionState([LEAD]), MODOLO_VOICE_TENANT, STARTED), MODOLO_VOICE_TENANT);
    assert.match(text, /Neue Website FAKE: line/);
    assert.equal(/\nFAKE:/.test(text), false);
  });

  it("states plainly that nothing came out of the call", () => {
    const { subject, text } = renderSummaryEmail(buildCallSummary(sessionState([]), MODOLO_VOICE_TENANT, STARTED), MODOLO_VOICE_TENANT);
    assert.match(subject, /ohne Anfrage, Termin oder Rückrufwunsch$/);
    assert.match(text, /Das Gespräch endete ohne Anfrage, Termin oder Rückrufwunsch\./);
  });
});

describe("deliverSummary", () => {
  it("sends a live tenant's summary to its own address, Reply-To the caller", async () => {
    const send = recorder();
    const summary = buildCallSummary(sessionState([LEAD]), MODOLO_VOICE_TENANT, STARTED + 60_000);
    assert.deepEqual(await deliverSummary({ summary, tenant: MODOLO_VOICE_TENANT, resend: RESEND, send }), { sent: true });
    assert.equal(send.sent.length, 1);
    assert.equal(send.sent[0].to, MODOLO_VOICE_TENANT.notifyEmail);
    assert.equal(send.sent[0].from, RESEND.from);
    assert.equal(send.sent[0].replyTo, "anna@example.ch");
  });

  it("never sends for a demo tenant, whatever else holds", async () => {
    const demo = getDemoTenant("demo-maler");
    assert.ok(demo);
    const send = recorder();
    const summary = buildCallSummary(sessionState([LEAD], demo), demo, STARTED);
    assert.deepEqual(await deliverSummary({ summary, tenant: demo, resend: RESEND, send }), { sent: false, reason: "demo_tenant" });
    // Even a demo with an address typed in by mistake.
    const withAddress = { ...demo, notifyEmail: "someone@example.ch" };
    assert.deepEqual(await deliverSummary({ summary, tenant: withAddress, resend: RESEND, send }), { sent: false, reason: "demo_tenant" });
    assert.equal(send.sent.length, 0);
  });

  it("sends nothing without an outcome, a recipient or an email service, and says why", async () => {
    const send = recorder();
    const empty = buildCallSummary(sessionState([]), MODOLO_VOICE_TENANT, STARTED);
    assert.deepEqual(await deliverSummary({ summary: empty, tenant: MODOLO_VOICE_TENANT, resend: RESEND, send }), { sent: false, reason: "no_outcome" });
    const summary = buildCallSummary(sessionState([LEAD]), MODOLO_VOICE_TENANT, STARTED);
    const noRecipient = { ...MODOLO_VOICE_TENANT, notifyEmail: undefined };
    assert.deepEqual(await deliverSummary({ summary, tenant: noRecipient, resend: RESEND, send }), { sent: false, reason: "no_recipient" });
    assert.deepEqual(await deliverSummary({ summary, tenant: MODOLO_VOICE_TENANT, resend: null, send }), {
      sent: false,
      reason: "email_not_configured",
    });
    assert.equal(send.sent.length, 0);
  });

  it("reports a refused email as send_failed", async () => {
    const summary = buildCallSummary(sessionState([LEAD]), MODOLO_VOICE_TENANT, STARTED);
    assert.deepEqual(await deliverSummary({ summary, tenant: MODOLO_VOICE_TENANT, resend: RESEND, send: recorder(false) }), {
      sent: false,
      reason: "send_failed",
    });
  });

  it("decides whether a request can be passed on at all", () => {
    const demo = getDemoTenant("demo-maler");
    assert.ok(demo);
    assert.equal(canDeliverSummary(demo, null), true);
    assert.equal(canDeliverSummary(MODOLO_VOICE_TENANT, null), false);
    assert.equal(canDeliverSummary(MODOLO_VOICE_TENANT, RESEND), true);
    assert.equal(canDeliverSummary({ ...MODOLO_VOICE_TENANT, notifyEmail: undefined }, RESEND), false);
  });
});

// From the integration report: requests are emailed the moment they are taken (deliverRequest);
// the summary at the end must not send them a second time.
describe("deliverRequest and the end-of-call summary", () => {
  it("sends one request at once, as a request taken during a call, without a call length", async () => {
    const send = recorder();
    const delivery = await deliverRequest({
      outcome: LEAD as Extract<CallSummary["outcomes"][number], { kind: "lead" }>,
      tenant: MODOLO_VOICE_TENANT,
      session: { sessionId: "summaryTestSession0001", channel: "web", locale: "it", startedAt: STARTED },
      resend: RESEND,
      send,
    });
    assert.deepEqual(delivery, { sent: true });
    assert.equal(send.sent[0].subject, "Sprachassistent Modolo Digital Studio – Anfrage: Projektanfrage, Referenz LD-7K2Q");
    assert.match(send.sent[0].text, /^Der KI-Sprachassistent hat diese Anfrage während eines Gesprächs aufgenommen\./);
    assert.doesNotMatch(send.sent[0].text, /Dauer:/);
    assert.equal(send.sent[0].replyTo, "anna@example.ch");
  });

  it("leaves requests and callback wishes out of the summary at the end", () => {
    const callback: CallSummary["outcomes"][number] = { kind: "callback", name: "Anna Muster", phone: "+41791234567", topic: "Offerte" };
    const cancellation: CallSummary["outcomes"][number] = { kind: "cancellation", ref: "MV-2345" };
    const summary = endOfCallSummary(sessionState([LEAD, callback, cancellation]), MODOLO_VOICE_TENANT, STARTED + 60_000);
    assert.deepEqual(summary.outcomes, [cancellation]);
    const onlyRequests = endOfCallSummary(sessionState([LEAD, callback]), MODOLO_VOICE_TENANT, STARTED + 60_000);
    assert.deepEqual(onlyRequests.outcomes, []);
  });

  // Review finding correttezza/F4: a move was listed as a new booking.
  it("names a moved appointment a move", () => {
    const booking = {
      ref: "MV-9VZ2",
      serviceId: "table",
      start: "2026-12-15T12:30:00+01:00",
      end: "2026-12-15T14:30:00+01:00",
      name: "Sarah Collins",
      contact: "+41780000044",
      partySize: 4,
      status: "confirmed" as const,
      createdAt: "2026-12-02T10:00:00+01:00",
    };
    const summary = buildCallSummary(
      sessionState([{ kind: "booking", booking }, { kind: "reschedule", booking: { ...booking, start: "2026-12-16T12:30:00+01:00" } }]),
      MODOLO_VOICE_TENANT,
      STARTED,
    );
    const { text } = renderSummaryEmail(summary, MODOLO_VOICE_TENANT);
    assert.match(text, /1\. Termin gebucht: table, Referenz MV-9VZ2/);
    assert.match(text, /2\. Termin verschoben: table, Referenz MV-9VZ2/);
    assert.match(text, /Beginn: 16\.12\.2026 12:30/);
  });
});
