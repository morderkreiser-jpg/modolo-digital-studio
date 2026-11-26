// The prompt variant of a live speech-to-speech session (buildVoiceSystem with `realtime`): what it
// adds and changes against the text-turn prompt, that the text-turn prompt stays as it was, and that
// neither the prompt nor the speech model's tool definitions carry an example phone number the model
// could recite (the text model's tool texts keep theirs: it guides the digits it writes).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ELEKTRO_TENANT } from "@/lib/voice/demos/elektro";
import { buildVoiceSystem } from "@/lib/voice/prompt";
import type { VoicePromptContext } from "@/lib/voice/prompt";
import { turnSystem } from "@/lib/voice/server/brain";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import { validateToolInput } from "@/lib/voice/tools/validate";
import { VOICE_LOCALES } from "@/lib/voice/types";
import type { VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";

const tenant = MODOLO_VOICE_TENANT;
// 14:05 on Thursday 26 November 2026 in Zurich (CET, UTC+1).
const NOW = new Date("2026-11-26T13:05:00Z");

const LIVE_VOICE_BLOCK = [
  "# Live voice",
  "- You hear the caller's voice directly, and they hear you while you speak. Keep each answer short and stop as soon as they talk.",
  "- Never say a phone number, a reference, an amount or any other number as an example. Say only numbers the caller gave you or a tool answered with.",
  "- Reading back and storing are two separate answers. After you read details back, stop and wait for the caller.",
  "- Call the tool that stores or books them only in your next answer, after the caller's yes. Never call a tool in an answer that asks whether something is right.",
  "- Never say that you will read something back unless you read it back in the same answer.",
  "- Ask the caller to spell the family name only when you need to know how it is written.",
  "- Then read back only the family name, letter by letter, each letter as the caller said it: an umlaut stays one letter (Ü, not U E), and say no word for a space.",
  "- After the caller's yes, write the family name exactly from those letters, even if it sounded different.",
  "- When the caller stops in the middle of a number or a spelling and then goes on, take both parts together as one statement, and read the whole of it back.",
  "- Speak one language per answer. When the caller switches language, answer wholly in the new one; never mix two languages in one answer.",
].join("\n");

// The sentences the live variant says differently: [text turns, live session].
const MOMENT: Record<VoiceLocale, string> = {
  de: "«Einen Moment, bitte.»",
  it: "«Un attimo, per favore.»",
  en: "«One moment, please.»",
  fr: "«Un instant, s'il vous plaît.»",
};
const TURN_BEFORE_TOOL = (moment: string) =>
  `Before you call a tool, say a few words first so that the caller does not wait in silence (${moment}), and call the tool in the same turn. Not before end_call: there you say goodbye.`;
const LIVE_BEFORE_TOOL = (moment: string) =>
  `Before you call a tool, say only ${moment}, in the caller's language, and nothing else: never say what you are about to do. Then call the tool in the same answer. Before end_call, say nothing.`;
// The spoken read-back example of the text turns, and the live variant's description of the manner.
const TURN_PHONE_READ_BACK: Record<VoiceLocale, string> = {
  de: "phone numbers digit by digit in small groups («null sieben neun, eins zwei drei, vier fünf, sechs sieben»)",
  it: "phone numbers digit by digit in small groups («zero sette nove, uno due tre, quattro cinque, sei sette»)",
  en: "phone numbers digit by digit in small groups («zero seven nine, one two three, four five, six seven»)",
  fr: "phone numbers digit by digit in small groups («zéro sept neuf, un deux trois, quatre cinq, six sept»)",
};
const LIVE_PHONE_READ_BACK = "phone numbers digit by digit, in small groups, exactly as the caller said them";
const TURN_TRANSFER = "(see the context). Say to whom before you transfer.";
const LIVE_TRANSFER = "(see the context). Before you transfer, say to whom and wait for the caller's answer.";
const TURN_EMERGENCY_READ_BACK = "(street and town are enough), read the number back, then pass the request on at once";
const LIVE_EMERGENCY_READ_BACK =
  "(street and town are enough), read the number back and wait for the caller's yes, then pass the request on at once";
const TURN_END_CALL =
  "When the caller's request is settled and they say goodbye or need nothing more, say a short goodbye and call end_call. Never end the call while the caller is still speaking or asking.";
const LIVE_END_CALL =
  "When the caller's request is settled and they say goodbye or need nothing more, call end_call first, without saying goodbye; when it answers, say one short goodbye, once. Never end the call while the caller is still speaking or asking.";
const TURN_NO_ANSWER = " If there is still no answer, say goodbye and call end_call.";
const LIVE_NO_ANSWER = " If there is still no answer, call end_call and then say goodbye.";

const PHONE_FORMAT = "a Swiss number with its area code (ten digits, starting with 0) or in the +41 form";

function ctx(patch: Partial<VoicePromptContext> = {}): VoicePromptContext {
  return { tenant, locale: "de", channel: "web", now: NOW, isOpen: true, remainingSeconds: 150, outcomesSoFar: [], ...patch };
}

const staticOf = (patch: Partial<VoicePromptContext> = {}) => buildVoiceSystem(ctx(patch)).staticText;

/** A copy of Modolo with every tool that takes a phone number, and a task field of type phone. */
function withPhoneTools(): VoiceTenantConfig {
  const [first, ...rest] = tenant.tasks;
  assert.ok(first, "the Modolo tenant has a task");
  return {
    ...tenant,
    id: "modolo-phone-tools-fixture",
    tools: ["check_availability", "book_appointment", "create_lead", "request_callback", "end_call"],
    tasks: [
      {
        ...first,
        fields: [...first.fields, { id: "second_phone", label: { en: "Second phone", de: "Zweite Nummer" }, type: "phone", required: false }],
      },
      ...rest,
    ],
    calendar: {
      provider: "memory",
      services: [{ id: "first_call", label: { de: "Erstgespräch", en: "First call" }, durationMinutes: 20 }],
      capacity: { kind: "single" },
      slotStepMinutes: 30,
      minLeadMinutes: 60,
      maxDaysAhead: 21,
      allowCancel: true,
      allowReschedule: false,
      changeMinLeadMinutes: 120,
    },
  };
}

/** Digits written as a phone number: a Swiss national form (0xx ...) or an international one (+41 ...). */
const WRITTEN_PHONE = /(?:\+\d{2}[\s\d]{6,}\d|\b0\d{2}[\s.\/-]?\d{3}[\s.\/-]?\d{2}[\s.\/-]?\d{2}\b)/;

/** The live variant turned back into the text-turn one: only the named sentences and the block. */
function undoLiveChanges(live: string, locale: VoiceLocale): string {
  return live
    .replace(`\n\n${LIVE_VOICE_BLOCK}`, "")
    .replace(LIVE_PHONE_READ_BACK, TURN_PHONE_READ_BACK[locale])
    .replace(`- ${LIVE_BEFORE_TOOL(MOMENT[locale])}\n`, `- ${TURN_BEFORE_TOOL(MOMENT[locale])}\n`)
    .replace(LIVE_TRANSFER, TURN_TRANSFER)
    .replace(LIVE_EMERGENCY_READ_BACK, TURN_EMERGENCY_READ_BACK)
    .replace(LIVE_END_CALL, TURN_END_CALL)
    .replace(LIVE_NO_ANSWER, TURN_NO_ANSWER);
}

/** The digits of each language as words. */
const NUMBER_WORDS: Record<VoiceLocale, string[]> = {
  de: ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"],
  it: ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove"],
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  fr: ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"],
};
/** Three or more digit words of one language in a row ("null sieben neun"): a number spoken as an example. */
const SPOKEN_PHONE = Object.values(NUMBER_WORDS).map((words) => {
  const word = `(?:${words.join("|")})`;
  return new RegExp(`(?<!\\p{L})${word}(?:[\\s,]+${word}){2,}(?!\\p{L})`, "iu");
});
const spokenPhoneIn = (text: string) => SPOKEN_PHONE.map((pattern) => text.match(pattern)?.[0]).find(Boolean);

describe("buildVoiceSystem: the live voice variant", () => {
  it("adds the live-voice block only to the realtime prompt", () => {
    for (const locale of VOICE_LOCALES) {
      for (const channel of ["web", "phone"] as const) {
        const live = staticOf({ locale, channel, realtime: true });
        const turn = staticOf({ locale, channel });
        assert.ok(live.includes(LIVE_VOICE_BLOCK), `${locale}/${channel}`);
        assert.equal(turn.includes("# Live voice"), false, `${locale}/${channel}`);
        assert.equal(staticOf({ locale, channel, realtime: false }), turn);
        // After "Conversation", before "Protection".
        const at = live.indexOf("# Live voice");
        assert.ok(live.indexOf("# Conversation") < at && at < live.indexOf("# Protection"));
        assert.ok(live.includes(`\n\n${LIVE_VOICE_BLOCK}\n\n# Protection\n`));
      }
    }
  });

  it("asks for end_call before the goodbye in the realtime prompt only", () => {
    for (const locale of VOICE_LOCALES) {
      const live = staticOf({ locale, realtime: true });
      const turn = staticOf({ locale });
      assert.ok(live.includes(LIVE_END_CALL));
      assert.ok(live.includes(LIVE_NO_ANSWER));
      assert.equal(live.includes(TURN_END_CALL), false);
      assert.equal(live.includes(TURN_NO_ANSWER), false);

      assert.ok(turn.includes(TURN_BEFORE_TOOL(MOMENT[locale])));
      assert.ok(turn.includes(TURN_END_CALL));
      assert.ok(turn.includes(TURN_NO_ANSWER));
      assert.equal(turn.includes(LIVE_END_CALL), false);
      assert.equal(turn.includes(LIVE_NO_ANSWER), false);
    }
  });

  it("before a tool says only the waiting phrase in the realtime prompt", () => {
    for (const locale of VOICE_LOCALES) {
      const live = staticOf({ locale, realtime: true });
      assert.ok(live.includes(`\n- ${LIVE_BEFORE_TOOL(MOMENT[locale])}\n`), locale);
      assert.equal(live.includes("say a few words first"), false, locale);
      assert.equal(live.includes("there you say goodbye"), false, locale);
    }
  });

  it("reads back and stores in two answers in the realtime prompt, also for a transfer and an emergency", () => {
    // A demo with a live transfer (phone only) and emergency requests.
    for (const locale of ELEKTRO_TENANT.locales) {
      const live = staticOf({ tenant: ELEKTRO_TENANT, locale, channel: "phone", realtime: true });
      const turn = staticOf({ tenant: ELEKTRO_TENANT, locale, channel: "phone" });
      assert.ok(live.includes(LIVE_TRANSFER), locale);
      assert.ok(live.includes(LIVE_EMERGENCY_READ_BACK), locale);
      assert.equal(live.includes(TURN_TRANSFER), false, locale);
      assert.equal(live.includes(TURN_EMERGENCY_READ_BACK), false, locale);
      assert.ok(turn.includes(TURN_TRANSFER), locale);
      assert.ok(turn.includes(TURN_EMERGENCY_READ_BACK), locale);
    }
  });

  it("leaves the text-turn prompt as it was", () => {
    for (const fixture of [tenant, withPhoneTools(), ELEKTRO_TENANT]) {
      for (const locale of fixture.locales) {
        for (const channel of ["web", "phone"] as const) {
          const turn = staticOf({ tenant: fixture, locale, channel });
          const live = staticOf({ tenant: fixture, locale, channel, realtime: true });
          assert.notEqual(live, turn);
          // The two differ only in the sentences and the block named above.
          assert.equal(undoLiveChanges(live, locale), turn, `${fixture.id} ${locale}/${channel}`);
        }
      }
    }
    // The per-turn part does not depend on the variant.
    assert.equal(buildVoiceSystem(ctx({ realtime: true })).dynamicText, buildVoiceSystem(ctx()).dynamicText);
    // turnSystem passes the flag through, and without it sends the text-turn prompt.
    const args = { tenant, state: { channel: "web" as const, outcomes: [] }, locale: "de" as const, now: NOW, remainingSeconds: 150 };
    assert.equal(turnSystem(args)[0]?.text, staticOf());
    assert.equal(turnSystem({ ...args, realtime: true })[0]?.text, staticOf({ realtime: true }));
  });

  it("caches the two variants separately", () => {
    // A fresh object, so that its cache entry starts empty: the live variant is built first.
    const fresh: VoiceTenantConfig = { ...tenant, id: "modolo-cache-fixture" };
    const liveFirst = staticOf({ tenant: fresh, realtime: true });
    const turnAfter = staticOf({ tenant: fresh });
    assert.ok(liveFirst.includes("# Live voice"));
    assert.equal(turnAfter.includes("# Live voice"), false);
    assert.equal(staticOf({ tenant: fresh, realtime: true }), liveFirst);
    assert.equal(staticOf({ tenant: fresh }), turnAfter);
    // And the other way round on another fresh object.
    const other: VoiceTenantConfig = { ...tenant, id: "modolo-cache-fixture-2" };
    assert.equal(staticOf({ tenant: other }), turnAfter);
    assert.equal(staticOf({ tenant: other, realtime: true }), liveFirst);
  });

  it("carries no example phone number in the prompt or in the tool definitions", () => {
    const fixture = withPhoneTools();
    for (const subject of [tenant, fixture]) {
      for (const locale of VOICE_LOCALES) {
        for (const realtime of [false, true]) {
          // Instructions only: the Knowledge section states the business's own facts, not examples.
          const text = staticOf({ tenant: subject, locale, realtime }).split("\n\n# Knowledge\n")[0] ?? "";
          assert.equal(WRITTEN_PHONE.test(text), false, `${subject.id} ${locale} realtime=${realtime}: ${text.match(WRITTEN_PHONE)?.[0]}`);
          // Nor in words: the text turns keep their spoken read-back example (turned into speech
          // afterwards, never recited as a fact); the live variant describes the manner instead.
          if (realtime) assert.equal(spokenPhoneIn(text), undefined, `${subject.id} ${locale}: ${spokenPhoneIn(text)}`);
          else assert.ok(spokenPhoneIn(text), `the search finds the text-turn example: ${subject.id} ${locale}`);
        }
        assert.ok(staticOf({ tenant: subject, locale, realtime: true }).includes(LIVE_PHONE_READ_BACK), `${subject.id} ${locale}`);
      }
      const definitions = JSON.stringify(toolDefinitions(subject, { speech: true }));
      assert.equal(WRITTEN_PHONE.test(definitions), false, `${subject.id}: ${definitions.match(WRITTEN_PHONE)?.[0]}`);
      assert.equal(definitions.includes("e.g. 079"), false);
    }
    // Nor the answers validation gives the speech model for a number it cannot use.
    const callback = validateToolInput(tenant, "request_callback", { name: "Testperson Eins", phone: "12345", topic: "A question" }, { speech: true });
    assert.equal(callback.ok, false);
    if (!callback.ok) {
      assert.ok(callback.errors.some((error) => error.includes('"phone" must be a phone number with area code (ten digits, starting with 0).')));
      for (const error of callback.errors) assert.equal(WRITTEN_PHONE.test(error), false, error);
    }
    const booking = validateToolInput(fixture, "book_appointment", { service: "first_call", start: "2026-12-01 10:00", name: "Testperson Eins", contact: "12345" }, { now: NOW, speech: true });
    assert.equal(booking.ok, false);
    if (!booking.ok) {
      assert.ok(
        booking.errors.some((error) => error.includes('"contact" must be a phone number with area code (ten digits, starting with 0) or an email address.')),
        booking.errors.join(" | "),
      );
      for (const error of booking.errors) assert.equal(WRITTEN_PHONE.test(error), false, error);
    }
    const badEmail = validateToolInput(fixture, "book_appointment", { service: "first_call", start: "2026-12-01 10:00", name: "Testperson Eins", contact: "not@an-address" }, { now: NOW, speech: true });
    assert.equal(badEmail.ok, false);
    if (!badEmail.ok) {
      assert.ok(
        badEmail.errors.some((error) => error.includes('"contact" must be a phone number with area code (ten digits, starting with 0) or an email address.')),
        badEmail.errors.join(" | "),
      );
    }
  });

  it("the speech tools still describe the Swiss number format", () => {
    const tools = Object.fromEntries(toolDefinitions(withPhoneTools(), { speech: true }).map((tool) => [tool.name, tool]));
    const properties = (name: string) => JSON.stringify(tools[name]?.inputSchema.properties ?? null);
    assert.ok(properties("book_appointment").includes(`A phone number (${PHONE_FORMAT}; a number from another country always with its country code`));
    assert.ok(properties("request_callback").includes(`The number to call back, ${PHONE_FORMAT}; a number from another country always with its country code.`));
    const lead = properties("create_lead");
    assert.ok(lead.includes(`The caller's phone number, ${PHONE_FORMAT}; a number from another country always with its country code.`), lead);
    assert.ok(lead.includes(`A phone number, ${PHONE_FORMAT}; a number from another country always with its country code.`), lead);
  });

  it("the text tools keep their example number, and the speech ones differ only there", () => {
    const fixture = withPhoneTools();
    for (const subject of [tenant, fixture, ELEKTRO_TENANT]) {
      const text = JSON.stringify(toolDefinitions(subject));
      const speech = JSON.stringify(toolDefinitions(subject, { speech: true }));
      // Without the option, and with it off, the text model's definitions.
      assert.equal(JSON.stringify(toolDefinitions(subject, {})), text, subject.id);
      assert.equal(JSON.stringify(toolDefinitions(subject, { speech: false })), text, subject.id);
      // They differ exactly when there is a phone text (the fixture has all of them).
      assert.equal(speech === text, !text.includes("e.g. 079 123 45 67"), subject.id);
      if (subject === fixture) assert.notEqual(speech, text);
      // Each example becomes the description of the format, and nothing else changes.
      const replaced = text
        .replaceAll("e.g. 079 123 45 67 or +41 79 123 45 67", PHONE_FORMAT)
        .replaceAll("e.g. 079 123 45 67", PHONE_FORMAT);
      assert.equal(replaced, speech, subject.id);
    }
    const tools = Object.fromEntries(toolDefinitions(fixture).map((tool) => [tool.name, tool]));
    const properties = (name: string) => JSON.stringify(tools[name]?.inputSchema.properties ?? null);
    assert.ok(properties("book_appointment").includes("A phone number (e.g. 079 123 45 67 or +41 79 123 45 67; a number from another country always with its country code"));
    assert.ok(properties("request_callback").includes("The number to call back, e.g. 079 123 45 67 or +41 79 123 45 67; a number from another country always with its country code."));
    const lead = properties("create_lead");
    assert.ok(lead.includes("The caller's phone number, e.g. 079 123 45 67 or +41 79 123 45 67; a number from another country always with its country code."), lead);
    assert.ok(lead.includes("A phone number, e.g. 079 123 45 67; a number from another country always with its country code."), lead);
    assert.equal(JSON.stringify(toolDefinitions(fixture)).includes(PHONE_FORMAT), false);
  });
});
