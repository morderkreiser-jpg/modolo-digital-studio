// The invented demo businesses and their example conversations (lib/voice/demos): the tenants are
// complete and honest about being fiction, the scripts follow the house rules for spoken text, and
// every tool step of every script is replayed through the real validators and the demo calendar.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCalendar } from "@/lib/voice/calendar/memory";
import { DEMO_SCRIPTS, DEMO_SECTOR_LABELS, DEMO_TENANTS, getDemoTenant, scriptsFor } from "@/lib/voice/demos";
import { validateVoiceTenant } from "@/lib/voice/tenants/validate";
import { validateToolInput } from "@/lib/voice/tools/validate";
import { VOICE_LOCALES, VOICE_SECTORS } from "@/lib/voice/types";
import type { DemoScript, DemoScriptLine, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";

const MULTILINGUAL = ["demo-umzug", "demo-restaurant", "demo-sanitaer"];
const EXPECTED_IDS = [
  "demo-umzug",
  "demo-reinigung",
  "demo-sanitaer",
  "demo-elektro",
  "demo-maler",
  "demo-carrosserie",
  "demo-immobilien",
  "demo-restaurant",
  "demo-hotel",
  "demo-coiffeur",
  "demo-kosmetik",
  "demo-tattoo",
];

// Placeholders only: transfer targets +41 00 000 00 NN, callers 07x 000 00 NN.
const TARGET_PLACEHOLDER = /^\+410000000\d{2}$/;
const CALLER_PLACEHOLDER = /^\+417[6-9]00000\d{2}$/;

// The AI disclosure in each language's greeting.
const DISCLOSURE: Record<VoiceLocale, RegExp> = {
  de: /(?<![\p{L}])KI(?![\p{L}])/u,
  it: /intelligenza artificiale/i,
  en: /(?<![\p{L}])AI(?![\p{L}])/u,
  fr: /(?<![\p{L}])IA(?![\p{L}])/u,
};

// Spoken digits, to check that the number a caller says is the number the tool receives.
const DIGIT_WORDS: Record<string, string> = {
  null: "0", eins: "1", zwei: "2", drei: "3", vier: "4", fünf: "5", sechs: "6", sieben: "7", acht: "8", neun: "9",
  zero: "0", uno: "1", due: "2", tre: "3", quattro: "4", cinque: "5", sei: "6", sette: "7", otto: "8", nove: "9",
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  zéro: "0", un: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", sept: "7", huit: "8", neuf: "9",
};

function tenantOf(script: DemoScript): VoiceTenantConfig {
  const tenant = getDemoTenant(script.tenantId);
  assert.ok(tenant, `${script.id}: unknown tenant ${script.tenantId}`);
  return tenant;
}

function toolSteps(script: DemoScript): Array<NonNullable<DemoScriptLine["tool"]> & { line: DemoScriptLine }> {
  return script.lines.flatMap((line) => (line.tool ? [{ ...line.tool, line }] : []));
}

/** Every string inside a value, with its path. */
function collectStrings(value: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) collectStrings(item, `${path}.${key}`, out);
  }
  return out;
}

/** Every object shaped like a VoiceText ({ de?, it?, en?, fr? } with string values), with its path. */
function collectVoiceTexts(value: unknown, path: string, out: Array<[string, Record<string, string>]> = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectVoiceTexts(item, `${path}[${index}]`, out));
  else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    const isText =
      entries.length > 0 &&
      entries.every(([key, item]) => (VOICE_LOCALES as readonly string[]).includes(key) && typeof item === "string");
    if (isText) out.push([path, value as Record<string, string>]);
    else for (const [key, item] of entries) collectVoiceTexts(item, `${path}.${key}`, out);
  }
  return out;
}

/** The tenant as plain data, knowledge included. */
function tenantData(tenant: VoiceTenantConfig): Record<string, unknown> {
  return { ...tenant, knowledge: tenant.knowledge() };
}

/** Ten-digit numbers spoken in these lines ("null sieben neun, null null null, ..."), as digits. */
function spokenNumbers(lines: DemoScriptLine[]): string[] {
  const numbers: string[] = [];
  for (const line of lines) {
    let run = "";
    for (const word of line.text.toLowerCase().split(/[^\p{L}]+/u)) {
      const digit = DIGIT_WORDS[word];
      if (digit !== undefined) {
        run += digit;
        continue;
      }
      if (word === "") continue;
      if (run.length === 10) numbers.push(run);
      run = "";
    }
    if (run.length === 10) numbers.push(run);
  }
  return numbers;
}

describe("demo tenants", () => {
  it("are the twelve demo businesses, with unique ids, all marked as demo", () => {
    assert.deepEqual(
      DEMO_TENANTS.map((tenant) => tenant.id),
      EXPECTED_IDS,
    );
    assert.equal(new Set(DEMO_TENANTS.map((tenant) => tenant.id)).size, 12);
    for (const tenant of DEMO_TENANTS) {
      assert.equal(tenant.kind, "demo", tenant.id);
      assert.equal(tenant.plan, "demo", tenant.id);
      assert.ok(tenant.id.startsWith("demo-"), tenant.id);
      assert.equal(getDemoTenant(tenant.id), tenant);
    }
    assert.equal(getDemoTenant("__proto__"), null);
    assert.equal(getDemoTenant(42), null);
  });

  it("cover every sector except the studio itself, once each", () => {
    const sectors = DEMO_TENANTS.map((tenant) => tenant.business.sector).sort();
    assert.deepEqual(sectors, VOICE_SECTORS.filter((sector) => sector !== "studio").sort());
  });

  it("pass the tenant validator without a single problem", () => {
    for (const tenant of DEMO_TENANTS) assert.deepEqual(validateVoiceTenant(tenant), [], tenant.id);
  });

  it("are recognisable as fiction: Muster or Beispiel in the name, the invented town, a notice first", () => {
    for (const tenant of DEMO_TENANTS) {
      assert.match(tenant.business.name, /Muster|Beispiel/, tenant.id);
      assert.equal(tenant.business.locality, "Musterwil", tenant.id);
      const knowledge = tenant.knowledge();
      assert.equal(knowledge.sections[0]?.id, "demo_notice", tenant.id);
      for (const locale of tenant.locales) {
        assert.match(knowledge.sections[0].content[locale] ?? "", /Musterwil/, `${tenant.id} ${locale}`);
      }
      assert.ok(
        tenant.rules.some((rule) => /fictional/.test(rule)),
        `${tenant.id}: a rule must make the model admit the business is invented`,
      );
    }
  });

  it("speak German, three of them also Italian, English and French, always formally", () => {
    for (const tenant of DEMO_TENANTS) {
      assert.equal(tenant.defaultLocale, "de", tenant.id);
      const expected = MULTILINGUAL.includes(tenant.id) ? ["de", "it", "en", "fr"] : ["de"];
      assert.deepEqual(tenant.locales, expected, tenant.id);
      for (const locale of tenant.locales) assert.equal(tenant.persona.formality[locale], "formal", `${tenant.id} ${locale}`);
    }
  });

  it("disclose the AI in the greeting of every language they speak", () => {
    for (const tenant of DEMO_TENANTS) {
      for (const locale of tenant.locales) {
        const greeting = tenant.greeting[locale] ?? "";
        assert.match(greeting, DISCLOSURE[locale], `${tenant.id} ${locale}`);
        assert.match(greeting, /Muster|Beispiel/, `${tenant.id} ${locale}: the greeting names the business`);
      }
    }
  });

  it("have every text in every language they speak", () => {
    for (const tenant of DEMO_TENANTS) {
      for (const [path, text] of collectVoiceTexts(tenantData(tenant), tenant.id)) {
        for (const locale of tenant.locales) {
          assert.ok(text[locale]?.trim(), `${path} has no "${locale}" text`);
        }
      }
    }
  });

  it("use Swiss spelling and no exclamation marks anywhere", () => {
    for (const tenant of DEMO_TENANTS) {
      for (const [path, text] of collectStrings(tenantData(tenant), tenant.id)) {
        assert.ok(!text.includes("ß"), `${path}: sharp s`);
        assert.ok(!text.includes("!"), `${path}: exclamation mark`);
      }
    }
  });

  it("use placeholder phone numbers only, and no summary recipient", () => {
    for (const tenant of DEMO_TENANTS) {
      for (const target of tenant.handoff.transfer.targets) {
        assert.match(target.number, TARGET_PLACEHOLDER, `${tenant.id} ${target.id}`);
      }
      assert.equal(tenant.notifyEmail, undefined, tenant.id);
    }
    const numbers = DEMO_TENANTS.flatMap((tenant) => tenant.handoff.transfer.targets.map((target) => target.number));
    assert.equal(new Set(numbers).size, numbers.length, "every target has its own placeholder");
  });

  it("keep the privacy defaults of a demo and the default limits", () => {
    for (const tenant of DEMO_TENANTS) {
      assert.deepEqual(
        tenant.privacy,
        {
          recordAudio: false,
          transcriptRetentionDays: 0,
          summaryRetentionDays: 30,
          noticeUrl: { de: "/de/datenschutz", it: "/it/privacy", en: "/privacy", fr: "/privacy" },
        },
        tenant.id,
      );
      assert.deepEqual(tenant.allowedOrigins, [], tenant.id);
      assert.equal(tenant.limits, undefined, tenant.id);
      assert.equal(tenant.hours.timezone, "Europe/Zurich", tenant.id);
    }
  });

  it("follow the answer policy of their story", () => {
    const byId = (id: string) => getDemoTenant(id) as VoiceTenantConfig;
    for (const id of ["demo-umzug", "demo-sanitaer", "demo-elektro", "demo-maler", "demo-reinigung"]) {
      const policy = byId(id).answerPolicy;
      assert.ok(policy.afterHours && policy.noAnswerAfterSeconds !== null, id);
      assert.deepEqual(byId(id).hours.weekly.mon, [
        { from: "07:00", to: "12:00" },
        { from: "13:00", to: "17:00" },
      ]);
    }
    const restaurant = byId("demo-restaurant");
    assert.ok(restaurant.answerPolicy.whenBusy && restaurant.answerPolicy.afterHours);
    assert.equal(restaurant.answerPolicy.noAnswerAfterSeconds, null);
    assert.deepEqual(restaurant.hours.weekly.mon, [], "closed on Monday");
    assert.equal(restaurant.hours.weekly.tue.length, 2, "a break in the afternoon");
    assert.equal(byId("demo-hotel").answerPolicy.always, true);
    const coiffeur = byId("demo-coiffeur").hours.weekly;
    assert.deepEqual([coiffeur.sun, coiffeur.mon], [[], []], "Tuesday to Saturday");
  });

  it("give the plain safety message in an emergency at the plumber and the electrician", () => {
    for (const id of ["demo-sanitaer", "demo-elektro"]) {
      const tenant = getDemoTenant(id) as VoiceTenantConfig;
      for (const locale of tenant.locales) {
        const message = tenant.handoff.emergency.message[locale] ?? "";
        for (const number of ["112", "118", "144"]) assert.ok(message.includes(number), `${id} ${locale}: ${number}`);
        assert.equal(message.split(/(?<=\.)\s/).length, 2, `${id} ${locale}: the danger sentence and the pass-on sentence only`);
      }
    }
  });
});

describe("demo scripts", () => {
  it("have unique ids of the form <tenant id>.<locale>.<slug>", () => {
    const ids = DEMO_SCRIPTS.map((script) => script.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const script of DEMO_SCRIPTS) {
      assert.equal(script.id, `${script.tenantId}.${script.locale}.${script.id.split(".")[2]}`, script.id);
      assert.match(script.id.split(".")[2] ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/, script.id);
      assert.equal(script.id.split(".").length, 3, script.id);
    }
  });

  it("exist in German for every business, and in Italian, English and French for the multilingual ones", () => {
    for (const tenant of DEMO_TENANTS) {
      assert.ok(scriptsFor(tenant.id, "de").length >= 1, tenant.id);
      if (MULTILINGUAL.includes(tenant.id)) {
        for (const locale of ["it", "en", "fr"] as const) assert.ok(scriptsFor(tenant.id, locale).length >= 1, `${tenant.id} ${locale}`);
      }
    }
  });

  it("are in a language their business speaks and open with its greeting", () => {
    for (const script of DEMO_SCRIPTS) {
      const tenant = tenantOf(script);
      assert.ok(tenant.locales.includes(script.locale), script.id);
      assert.equal(script.lines[0]?.role, "assistant", script.id);
      assert.equal(script.lines[0]?.text, tenant.greeting[script.locale], script.id);
      assert.ok(script.title.trim() && script.shows.trim(), script.id);
    }
  });

  it("are 10 to 18 lines of plain spoken text", () => {
    for (const script of DEMO_SCRIPTS) {
      assert.ok(script.lines.length >= 10 && script.lines.length <= 18, `${script.id}: ${script.lines.length} lines`);
      for (const [index, line] of script.lines.entries()) {
        const where = `${script.id} line ${index + 1}`;
        assert.ok(line.text.trim(), `${where} is empty`);
        assert.ok(!line.text.includes("!"), `${where}: exclamation mark`);
        if (script.locale === "de") assert.ok(!line.text.includes("ß"), `${where}: sharp s`);
      }
      for (const text of [script.title, script.shows]) assert.ok(!text.includes("!") && !text.includes("ß"), script.id);
    }
  });

  it("let the assistant use the formal address in German and French", () => {
    // Letter-aware word edges: \b would split "êtes" into "ê" + "tes".
    const informal: Partial<Record<VoiceLocale, RegExp>> = {
      de: /(?<!\p{L})(du|dich|dir|dein\p{L}*)(?!\p{L})/iu,
      fr: /(?<!\p{L})(tu|toi|ton|tes)(?!\p{L})/iu,
    };
    for (const script of DEMO_SCRIPTS) {
      const pattern = informal[script.locale];
      if (!pattern) continue;
      for (const line of script.lines) {
        if (line.role === "assistant") assert.doesNotMatch(line.text, pattern, script.id);
      }
    }
  });

  it("show the hard cases: a full slot, a failed transfer, a language switch, an emergency", () => {
    const steps = DEMO_SCRIPTS.flatMap((script) => toolSteps(script));
    assert.ok(steps.some((step) => step.name === "transfer_call" && step.outcome === "failed"), "a failed transfer");
    assert.ok(steps.some((step) => step.name === "check_availability"), "a slot search");
    const switched = DEMO_SCRIPTS.some(
      (script) => script.locale === "de" && script.lines.some((line) => /\b(Scusi|italiano)\b/.test(line.text)),
    );
    assert.ok(switched, "a German call that continues in Italian");
    const plumber = getDemoTenant("demo-sanitaer") as VoiceTenantConfig;
    const emergency = scriptsFor("demo-sanitaer", "de").some((script) =>
      script.lines.some((line) => line.role === "assistant" && line.text === plumber.handoff.emergency.message.de),
    );
    assert.ok(emergency, "the burst pipe script says the emergency message word for word");
  });
});

describe("demo script tool steps", () => {
  it("only come from the assistant and name a tool the business lists", () => {
    for (const script of DEMO_SCRIPTS) {
      const tenant = tenantOf(script);
      for (const step of toolSteps(script)) {
        assert.equal(step.line.role, "assistant", `${script.id}: ${step.name}`);
        assert.ok(tenant.tools.includes(step.name), `${script.id}: ${step.name} is not listed`);
      }
    }
  });

  it("pass the real tool validator of their business", () => {
    for (const script of DEMO_SCRIPTS) {
      const tenant = tenantOf(script);
      for (const step of toolSteps(script)) {
        const result = validateToolInput(tenant, step.name, step.input);
        assert.ok(result.ok, `${script.id} ${step.name}: ${result.ok ? "" : result.errors.join(" ")}`);
      }
    }
  });

  it("use placeholder numbers that the caller said and the assistant read back", () => {
    for (const script of DEMO_SCRIPTS) {
      const said = spokenNumbers(script.lines.filter((line) => line.role === "caller"));
      const readBack = spokenNumbers(script.lines.filter((line) => line.role === "assistant"));
      for (const step of toolSteps(script)) {
        for (const key of ["phone", "contact"]) {
          const value = step.input[key];
          if (typeof value !== "string" || value.includes("@")) continue;
          assert.match(value, CALLER_PLACEHOLDER, `${script.id} ${step.name}.${key}`);
          const national = `0${value.slice(3)}`;
          assert.ok(said.includes(national), `${script.id}: the caller never says ${national}`);
          assert.ok(readBack.includes(national), `${script.id}: the assistant never reads back ${national}`);
        }
      }
    }
  });

  it("book only times the business's calendar offers (empty calendar, early December 2026)", async () => {
    const now = new Date("2026-12-01T07:00:00+01:00");
    for (const script of DEMO_SCRIPTS) {
      const tenant = tenantOf(script);
      for (const step of toolSteps(script)) {
        if (!["check_availability", "book_appointment", "reschedule_appointment"].includes(step.name)) continue;
        assert.ok(tenant.calendar, `${script.id}: ${step.name} without a calendar`);
        const calendar = createMemoryCalendar(tenant.calendar, tenant.hours);
        const start = (step.input.start ?? step.input.new_start) as string | undefined;
        const date = (step.input.date as string | undefined) ?? start?.slice(0, 10);
        assert.ok(date, `${script.id}: ${step.name} has no day`);
        // reschedule_appointment carries no service: the coiffeur script moves a women's cut.
        const serviceId = (step.input.service as string | undefined) ?? "women_cut";
        const slots = await calendar.findSlots({
          serviceId,
          date,
          partySize: step.input.party_size as number | undefined,
          now,
        });
        assert.ok(slots.ok, `${script.id}: ${step.name} on ${date} is refused`);
        if (start === undefined) {
          assert.ok(slots.value.length > 0, `${script.id}: nothing free on ${date}`);
        } else {
          assert.ok(
            slots.value.some((slot) => slot.start === start),
            `${script.id}: ${start} is not a start time the calendar offers`,
          );
        }
      }
    }
  });

  it("confirm a booking with a reference in the calendar's format", () => {
    for (const script of DEMO_SCRIPTS) {
      for (const step of toolSteps(script)) {
        if (step.name === "book_appointment" && step.outcome === "ok") {
          assert.match(step.line.text, /\bMV-[2-9A-HJ-NP-Z]{4}\b/, script.id);
        }
        if (step.name === "cancel_appointment" || step.name === "reschedule_appointment") {
          assert.match(String(step.input.reference), /^MV-[2-9A-HJ-NP-Z]{4}$/, script.id);
        }
      }
    }
  });
});

describe("scriptsFor", () => {
  it("filters by business and, when given, by language", () => {
    assert.deepEqual(
      scriptsFor("demo-umzug").map((script) => script.locale),
      ["de", "it", "en", "fr"],
    );
    assert.deepEqual(
      scriptsFor("demo-restaurant", "de").map((script) => script.tenantId),
      ["demo-restaurant", "demo-restaurant"],
    );
    assert.deepEqual(scriptsFor("demo-tattoo", "fr"), []);
    assert.deepEqual(scriptsFor("nope"), []);
  });

  it("returns a new array each time", () => {
    const first = scriptsFor("demo-hotel");
    first.pop();
    assert.equal(scriptsFor("demo-hotel").length, 1);
  });
});

describe("DEMO_SECTOR_LABELS", () => {
  it("names every sector in the four languages", () => {
    for (const sector of VOICE_SECTORS) {
      for (const locale of VOICE_LOCALES) {
        const label = DEMO_SECTOR_LABELS[sector][locale] ?? "";
        assert.ok(label.trim(), `${sector} ${locale}`);
        assert.ok(!label.includes("ß") && !label.includes("!"), `${sector} ${locale}`);
      }
    }
  });
});
