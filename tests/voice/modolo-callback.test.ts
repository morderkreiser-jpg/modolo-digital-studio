// The voice assistant of Modolo Digital Studio may take
// a callback wish and promise the callback, while the written reply stays the default. What this
// file checks: the tool is offered to the model for this tenant, the prompt carries the new rule
// and not the old one, and a callback taken for Modolo is recorded and handed to the same
// delivery path as a request (a fake e-mail sender: nothing leaves the machine).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { DEMO_TENANTS } from "@/lib/voice/demos";
import { buildVoiceSystem } from "@/lib/voice/prompt";
import { createSessionSinks } from "@/lib/voice/server/session";
import type { SendEmail } from "@/lib/voice/server/summary";
import { MODOLO_VOICE_TENANT as modolo } from "@/lib/voice/tenants/modolo";
import { enabledTools, toolDefinitions } from "@/lib/voice/tools/definitions";
import { executeTool, type ToolContext } from "@/lib/voice/tools/execute";
import { DEFAULT_VOICE_LIMITS, VOICE_LOCALES, type CallSummary, type VoiceChannel, type VoiceLocale } from "@/lib/voice/types";
import { captureLogs, localEnv } from "./voice-fixtures";

const NOW = new Date("2026-11-26T13:05:00Z");
const RESEND = { apiKey: "re_test_key", from: "Studio <test@example.ch>" };

const PROMISE: Record<VoiceLocale, string> = {
  de: "Francesco ruft dich zurück, in der Regel innert eines Werktags.",
  it: "Francesco ti richiama, di norma entro un giorno lavorativo.",
  en: "Francesco will call you back, usually within one working day.",
  fr: "Francesco vous rappelle, en général sous un jour ouvrable.",
};

const OLD_RULE = /Never offer, suggest or promise a (?:phone call|callback)/;

let restoreEnv: () => void = () => undefined;
beforeEach(() => {
  captureLogs();
  restoreEnv = localEnv();
});
afterEach(() => {
  restoreEnv();
  mock.restoreAll();
});

describe("Modolo: the callback tool is offered", () => {
  it("lists request_callback after create_lead, with callbacks enabled and a promise in every language", () => {
    assert.deepEqual(enabledTools(modolo), ["create_lead", "request_callback", "end_call"]);
    const callback = toolDefinitions(modolo).find((tool) => tool.name === "request_callback");
    assert.ok(callback, "request_callback is defined for the model");
    assert.deepEqual(callback.inputSchema.required, ["name", "phone", "topic"]);
    assert.equal(modolo.handoff.callback.enabled, true);
    assert.deepEqual(modolo.handoff.callback.promise, PROMISE);
  });

  it("keeps the house form of address in the promise: du, tu, vous", () => {
    assert.match(PROMISE.de, /\bdich\b/);
    assert.doesNotMatch(PROMISE.de, /\bSie\b|ß|!/);
    assert.match(PROMISE.it, /\bti\b/);
    assert.match(PROMISE.fr, /\bvous\b/);
  });

  it("still has no live transfer and no calendar", () => {
    assert.equal(modolo.handoff.transfer.enabled, false);
    assert.ok(!modolo.tools.includes("transfer_call"));
    assert.equal(modolo.calendar, undefined);
  });
});

describe("Modolo: the rule in the prompt", () => {
  for (const channel of ["web", "phone"] as const satisfies readonly VoiceChannel[]) {
    for (const locale of VOICE_LOCALES) {
      it(`${channel}, ${locale}: carries the new rule and the promise, never the old rule`, () => {
        const { staticText } = buildVoiceSystem({ tenant: modolo, locale, channel, now: NOW, isOpen: true, remainingSeconds: 150, outcomesSoFar: [] });
        assert.doesNotMatch(staticText, OLD_RULE);
        assert.match(staticText, /The written reply is the default/);
        assert.match(staticText, /offer first to leave a project request/);
        assert.match(staticText, /Offer a callback only when the caller asks to be called back or says they prefer the phone/);
        assert.match(staticText, /the phone number read back digit by digit and confirmed/);
        assert.match(staticText, /a preferred time only if the caller names one/);
        assert.match(staticText, /Never promise a time of day or a fixed appointment for the call/);
        assert.match(staticText, /never say that Francesco answers the phone live/);
        assert.match(staticText, /never offer a live transfer or a video call/);
        assert.match(staticText, /give the WhatsApp numbers only as WhatsApp contacts for messages, never as numbers to call/);
        assert.match(staticText, /Beyond that promise, don't say what Francesco does or doesn't do about calls/);
        assert.match(staticText, /You can leave a callback request with request_callback/);
        for (const code of VOICE_LOCALES) assert.ok(staticText.includes(PROMISE[code]), `promise in ${code}`);
        assert.match(staticText, /Never offer or promise to put the caller through to a person/);
        assert.ok(!staticText.includes("transfer_call"));
      });
    }
  }

  it("takes the written request when the caller only asks Francesco to get in touch", () => {
    const when = modolo.tasks[0].when;
    assert.match(when, /asks Francesco to get in touch \(this written request is the default/);
    assert.doesNotMatch(when, /cannot be promised/);
  });

  it("tells a caller who asks that a callback wish reaches Francesco too", () => {
    const section = modolo.knowledge().sections.find((s) => s.id === "about_this_voice_assistant");
    assert.match(section?.content.en ?? "", /only as a request or a callback wish/);
    assert.match(section?.content.de ?? "", /nur als Anfrage oder als Rückrufwunsch/);
    assert.match(section?.content.it ?? "", /solo come richiesta o come richiesta di richiamata/);
    assert.match(section?.content.fr ?? "", /sous forme de demande ou de demande de rappel/);
  });
});

describe("Modolo: a callback taken is recorded and delivered like a request", () => {
  type Outcome = CallSummary["outcomes"][number];

  function context(send: SendEmail, locale: VoiceLocale = "de"): ToolContext & { outcomes: Outcome[] } {
    const outcomes: Outcome[] = [];
    return {
      tenant: modolo,
      sessionId: "callbackSession0000001",
      locale,
      channel: "web",
      now: NOW,
      limits: DEFAULT_VOICE_LIMITS,
      counters: { toolCalls: 0, bookings: 0, leads: 0 },
      calendar: null,
      sinks: createSessionSinks(modolo, RESEND, { send, session: { channel: "web", startedAt: NOW.getTime() } }),
      record: (outcome) => outcomes.push(outcome),
      outcomes,
    };
  }

  const call = (name: string, input: unknown) => ({ id: "toolu_callback", name, input });

  it("records the wish, sends it at once to the studio's address, and answers with the promise", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const send: SendEmail = async (email) => {
      sent.push(email);
      return true;
    };
    const ctx = context(send);
    const outcome = await executeTool(
      ctx,
      call("request_callback", { name: "Anna Muster", phone: "079 123 45 67", topic: "Neue Website für ein Café", preferred_time: "morgen Vormittag" }),
    );
    assert.ok(outcome.ok, outcome.say);
    assert.equal(outcome.say, `Callback request passed on. About timing, say only: "${PROMISE.de}"`);
    assert.deepEqual(ctx.outcomes, [
      { kind: "callback", name: "Anna Muster", phone: "+41791234567", topic: "Neue Website für ein Café", preferredTime: "morgen Vormittag" },
    ]);
    assert.equal(ctx.counters.leads, 1, "a callback takes a unit of the same cap as a request");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, modolo.notifyEmail);
    assert.ok(sent[0].text.includes("Anna Muster"));
    assert.ok(sent[0].text.includes("+41 79 123 45 67"));
    assert.ok(sent[0].text.includes("Neue Website für ein Café"));
  });

  it("goes the same way as a project request: one e-mail each, to the same recipient", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const send: SendEmail = async (email) => {
      sent.push(email);
      return true;
    };
    const ctx = context(send, "it");
    const lead = await executeTool(
      ctx,
      call("create_lead", {
        task: "project_request",
        fields: { service: "website", problem: "Un sito per una pizzeria" },
        name: "Lucia Romano",
        email: "lucia@example.ch",
        summary: "Sito per una pizzeria",
      }),
    );
    assert.ok(lead.ok, lead.say);
    const callback = await executeTool(ctx, call("request_callback", { name: "Lucia Romano", phone: "+41 79 765 43 21", topic: "Sito per una pizzeria" }));
    assert.ok(callback.ok, callback.say);
    assert.equal(callback.say, `Callback request passed on. About timing, say only: "${PROMISE.it}"`);
    assert.deepEqual(
      ctx.outcomes.map((item) => item.kind),
      ["lead", "callback"],
    );
    assert.equal(sent.length, 2);
    assert.deepEqual(
      sent.map((email) => email.to),
      [modolo.notifyEmail, modolo.notifyEmail],
    );
  });

  it("says it did not go through, and offers the written request, when the e-mail is refused", async () => {
    const ctx = context(async () => false, "en");
    const outcome = await executeTool(ctx, call("request_callback", { name: "Anna Muster", phone: "+41 79 123 45 67", topic: "Website" }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.say, /could not be passed on/);
    assert.match(outcome.say, /Offer a written follow-up instead\./);
    assert.ok(!outcome.say.includes(PROMISE.en), "no promise for a wish that never left");
    assert.deepEqual(ctx.outcomes, []);
    assert.equal(ctx.counters.leads, 0, "the unit of the cap came back");
  });
});

// The callback is taken only when the caller asks for it: no shared text (a failed request, an
// unknown answer, time running out, the tool's own description) offers it on its own.
describe("Modolo: no text offers a callback the caller did not ask for", () => {
  const sinks = (send: SendEmail) => createSessionSinks(modolo, RESEND, { send, session: { channel: "web", startedAt: NOW.getTime() } });

  it("is switched on for Modolo", () => {
    assert.equal(modolo.handoff.callback.onlyWhenAsked, true);
  });

  it("a refused create_lead offers no callback", async () => {
    const ctx: ToolContext = {
      tenant: modolo,
      sessionId: "callbackSession0000002",
      locale: "de",
      channel: "web",
      now: NOW,
      limits: DEFAULT_VOICE_LIMITS,
      counters: { toolCalls: 0, bookings: 0, leads: 0 },
      calendar: null,
      sinks: sinks(async () => false),
      record: () => undefined,
    };
    const outcome = await executeTool(ctx, {
      id: "toolu_lead",
      name: "create_lead",
      input: {
        task: "project_request",
        fields: { service: "website", problem: "Eine Website" },
        name: "Anna Muster",
        email: "anna@example.ch",
        summary: "Website",
      },
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.say, /could not be stored/);
    assert.doesNotMatch(outcome.say, /callback/i);
  });

  it("the tool description takes a callback only when the caller asks", () => {
    const callback = toolDefinitions(modolo).find((tool) => tool.name === "request_callback");
    assert.ok(callback);
    assert.doesNotMatch(callback.description, /question you cannot answer/);
    assert.match(callback.description, /only when the caller asks to be called back or says they prefer the phone/);
  });

  for (const channel of ["web", "phone"] as const satisfies readonly VoiceChannel[]) {
    it(`${channel}: the shared fallback lines offer only the written request`, () => {
      const { staticText } = buildVoiceSystem({ tenant: modolo, locale: "de", channel, now: NOW, isOpen: true, remainingSeconds: 150, outcomesSoFar: [] });
      assert.ok(!staticText.includes("offer a callback request"), "no fallback names the callback");
      assert.match(staticText, /After two failed attempts at the same detail, stop and offer to leave a request for the business\./);
      assert.match(staticText, /and offer to leave a request for the business\. An honest/);
    });
  }

  it("leaves the demo businesses with callbacks as they were", () => {
    const demo = DEMO_TENANTS.find(
      (tenant) => tenant.handoff.callback.enabled && tenant.tools.includes("request_callback") && tenant.handoff.callback.onlyWhenAsked !== true,
    );
    assert.ok(demo, "a demo business offers callbacks");
    const callback = toolDefinitions(demo).find((tool) => tool.name === "request_callback");
    assert.match(callback?.description ?? "", /or for a question you cannot answer/);
    const { staticText } = buildVoiceSystem({ tenant: demo, locale: demo.defaultLocale, channel: "web", now: NOW, isOpen: true, remainingSeconds: 150, outcomesSoFar: [] });
    assert.ok(staticText.includes("a callback request"));
  });
});
