// Voice tenants: the validator (lib/voice/tenants/validate.ts) on the real Modolo tenant and on
// broken copies of it, the Modolo tenant's owner decisions, the registry (lib/voice/tenants), and
// the browser-facing config (lib/voice/server/public-config.ts), which must never carry
// server-only data.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODOLO_TENANT } from "@/lib/assistant/tenants/modolo/config";
import { SITE } from "@/lib/site";
import { DEMO_TENANTS } from "@/lib/voice/demos";
import { toVoicePublicConfig } from "@/lib/voice/server/public-config";
import { DEFAULT_VOICE_TENANT_ID, getVoiceTenant, listVoiceTenantIds } from "@/lib/voice/tenants";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { disclosesAi, validateVoiceTenant } from "@/lib/voice/tenants/validate";
import {
  DEFAULT_VOICE_LIMITS,
  VOICE_END_ENDPOINT,
  VOICE_LOCALES,
  VOICE_SESSION_ENDPOINT,
  VOICE_TURN_ENDPOINT,
} from "@/lib/voice/types";
import type { CalendarConfig, TaskDefinition, VoiceTenantConfig } from "@/lib/voice/types";

const modolo = MODOLO_VOICE_TENANT;
const TRANSFER_NUMBER = "+41441234567";

/** A deep copy of the Modolo tenant (functions kept), changed by `patch`. */
function broken(patch: (tenant: VoiceTenantConfig) => void): VoiceTenantConfig {
  const copy = structuredClone({ ...modolo, knowledge: undefined }) as unknown as VoiceTenantConfig;
  copy.knowledge = modolo.knowledge;
  patch(copy);
  return copy;
}

function calendar(patch: Partial<CalendarConfig> = {}): CalendarConfig {
  return {
    provider: "memory",
    services: [{ id: "first_call", label: { de: "Erstgespräch" }, durationMinutes: 20 }],
    capacity: { kind: "single" },
    slotStepMinutes: 30,
    minLeadMinutes: 60,
    maxDaysAhead: 21,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 120,
    ...patch,
  };
}

function task(tenant: VoiceTenantConfig): TaskDefinition {
  const first = tenant.tasks[0];
  assert.ok(first);
  return first;
}

/** Every string anywhere in a value. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) stringsIn(item, out);
  return out;
}

function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysIn(item, out);
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      keysIn(item, out);
    }
  }
  return out;
}

describe("validateVoiceTenant", () => {
  it("finds nothing wrong with the Modolo tenant", () => {
    assert.deepEqual(validateVoiceTenant(modolo), []);
  });

  const cases: Array<[string, (tenant: VoiceTenantConfig) => void, RegExp]> = [
    ["id format", (t) => (t.id = "Modolo Studio"), /^id must be/],
    ["id too long", (t) => (t.id = "a".repeat(65)), /^id must be/],
    ["demo id on a live tenant", (t) => (t.id = "demo-studio"), /needs kind "demo"/],
    [
      "demo tenant without the demo- prefix",
      (t) => {
        t.kind = "demo";
        t.notifyEmail = undefined;
      },
      /must start with "demo-"/,
    ],
    [
      "demo tenant with a recipient",
      (t) => {
        t.id = "demo-studio";
        t.kind = "demo";
      },
      /a demo tenant has no notifyEmail/,
    ],
    ["notifyEmail format", (t) => (t.notifyEmail = "info at example"), /notifyEmail is not an email address/],
    ["empty locales", (t) => (t.locales = []), /locales is empty/],
    ["unknown locale", (t) => (t.locales = ["de", "xx" as never]), /unknown locale/],
    ["duplicate locale", (t) => (t.locales = ["de", "de", "it"]), /locale "de" is listed twice/],
    ["default locale not offered", (t) => (t.locales = ["it", "en"]), /defaultLocale is not one of locales/],
    ["greeting missing", (t) => delete t.greeting.fr, /greeting is missing for "fr"/],
    ["German greeting without AI", (t) => (t.greeting.de = "Hoi, hier ist Modolo Digital Studio. Wie kann ich dir helfen?"), /greeting for "de" does not say/],
    ["Italian greeting without AI", (t) => (t.greeting.it = "Ciao, sono l'assistente di Modolo Digital Studio."), /greeting for "it" does not say/],
    ["English greeting without AI", (t) => (t.greeting.en = "Hi, this is the assistant of Modolo Digital Studio."), /greeting for "en" does not say/],
    ["French greeting without AI", (t) => (t.greeting.fr = "Bonjour, ici l'assistant de Modolo Digital Studio."), /greeting for "fr" does not say/],
    ["unknown tool", (t) => (t.tools = [...t.tools, "send_sms" as never]), /tool "send_sms" does not exist/],
    ["tool listed twice", (t) => (t.tools = [...t.tools, "end_call"]), /tool "end_call" is listed twice/],
    ["calendar tool without a calendar", (t) => (t.tools = [...t.tools, "check_availability"]), /"check_availability" needs a calendar/],
    [
      "cancel tool the calendar does not allow",
      (t) => {
        t.tools = [...t.tools, "cancel_appointment"];
        t.calendar = calendar({ allowCancel: false });
      },
      /"cancel_appointment" needs calendar.allowCancel/,
    ],
    ["transfer tool without targets", (t) => (t.tools = [...t.tools, "transfer_call"]), /"transfer_call" needs handoff.transfer/],
    ["callback tool with callbacks off", (t) => (t.tools = [...t.tools, "request_callback"]), /"request_callback" needs handoff.callback/],
    ["create_lead without tasks", (t) => (t.tasks = []), /"create_lead" needs at least one task/],
    ["task id not snake_case", (t) => (task(t).id = "Project-Request"), /task "Project-Request": id must be snake_case/],
    ["task id twice", (t) => (t.tasks = [task(t), structuredClone(task(t))]), /task id "project_request" is used twice/],
    ["task without when", (t) => (task(t).when = " "), /"when" is empty/],
    ["field id not snake_case", (t) => (task(t).fields[1].id = "Problem Text"), /field "Problem Text": id must be snake_case/],
    ["field id twice", (t) => (task(t).fields[2].id = "problem"), /field id "problem" is used twice/],
    ["choice field without choices", (t) => (task(t).fields[0].choices = []), /a choice field needs choices/],
    ["choice listed twice", (t) => task(t).fields[0].choices?.push({ id: "seo", label: { en: "SEO" } }), /choice "seo" is listed twice/],
    ["contact need unknown", (t) => (task(t).contact.email = "maybe" as never), /contact.email must be required, optional or none/],
    [
      "transfer number not E.164",
      (t) => {
        t.handoff.transfer = { enabled: true, ringSeconds: 20, targets: [{ id: "owner", label: { de: "Francesco" }, number: "044 123 45 67" }] };
      },
      /transfer target "owner": number is not in E.164 form/,
    ],
    [
      "transfer ring time",
      (t) => {
        t.handoff.transfer = { enabled: true, ringSeconds: 0, targets: [{ id: "owner", label: { de: "Francesco" }, number: TRANSFER_NUMBER }] };
      },
      /ringSeconds must be 5 to 60/,
    ],
    ["calendar slot step", (t) => (t.calendar = calendar({ slotStepMinutes: 20 })), /slotStepMinutes must be 15, 30 or 60/],
    ["calendar duration", (t) => (t.calendar = calendar({ services: [{ id: "x", label: {}, durationMinutes: 0 }] })), /duration must be 5 to 480/],
    ["calendar horizon", (t) => (t.calendar = calendar({ maxDaysAhead: 0 })), /maxDaysAhead must be 1 to 365/],
    ["calendar lead time", (t) => (t.calendar = calendar({ minLeadMinutes: -5 })), /minLeadMinutes/],
    [
      "calendar party size",
      (t) => (t.calendar = calendar({ capacity: { kind: "seats", total: 10, maxPartySize: 12, turnMinutes: 90 } })),
      /maxPartySize must be from 1 to seats.total/,
    ],
    ["recording on the demo plan", (t) => (t.privacy.recordAudio = true), /recordAudio must be false/],
    ["emergency message missing", (t) => delete t.handoff.emergency.message.it, /emergency message is missing for "it"/],
    ["written promise missing a language", (t) => delete t.handoff.written.promise?.fr, /handoff.written.promise is missing for "fr"/],
    ["privacy notice missing", (t) => (t.privacy.noticeUrl = {}), /privacy.noticeUrl is empty/],
    ["privacy notice not a site path", (t) => (t.privacy.noticeUrl.fr = "javascript:alert(1)"), /noticeUrl for "fr" must be/],
    ["negative limit", (t) => (t.limits = { maxCallSeconds: -1 }), /limits.maxCallSeconds must be a number/],
    ["hours that end before they start", (t) => (t.hours.weekly.mon = [{ from: "18:00", to: "09:00" }]), /^hours: /],
    ["unknown time zone", (t) => (t.hours.timezone = "Mars/Olympus"), /^hours: /],
  ];

  for (const [name, patch, expected] of cases) {
    it(`reports: ${name}`, () => {
      const problems = validateVoiceTenant(broken(patch));
      assert.ok(
        problems.some((problem) => expected.test(problem)),
        `expected ${expected} in ${JSON.stringify(problems)}`,
      );
    });
  }

  it("lets a paid live tenant record audio", () => {
    const tenant = broken((t) => {
      t.plan = "starter";
      t.privacy.recordAudio = true;
    });
    assert.deepEqual(validateVoiceTenant(tenant), []);
  });

  it("accepts a correct calendar and a correct transfer", () => {
    const tenant = broken((t) => {
      t.tools = ["check_availability", "book_appointment", "cancel_appointment", "reschedule_appointment", "transfer_call", "create_lead", "end_call"];
      t.calendar = calendar();
      t.handoff.transfer = { enabled: true, ringSeconds: 20, targets: [{ id: "owner", label: { de: "Francesco" }, number: TRANSFER_NUMBER }] };
    });
    assert.deepEqual(validateVoiceTenant(tenant), []);
  });

  it("never prints a transfer number in a problem", () => {
    const problems = validateVoiceTenant(
      broken((t) => {
        t.handoff.transfer = { enabled: true, ringSeconds: 99, targets: [{ id: "owner", label: {}, number: "0441234567" }] };
      }),
    );
    assert.ok(problems.length > 0);
    for (const problem of problems) assert.ok(!problem.includes("441234567"), problem);
  });

  it("never throws, even on garbage", () => {
    for (const garbage of [{}, null, { id: "x", locales: "de" }]) {
      const problems = validateVoiceTenant(garbage as never);
      assert.ok(Array.isArray(problems) && problems.length > 0);
    }
  });
});

describe("disclosesAi", () => {
  it("accepts the agreed AI words per language", () => {
    for (const [text, locale] of [
      ["Hoi, hier ist der KI-Assistent von Muster.", "de"],
      ["Grüezi, hier ist der digitale Assistent von Muster.", "de"],
      ["Buongiorno, sono l'assistente AI di Muster.", "it"],
      ["Buongiorno, sono l'assistente virtuale di Muster.", "it"],
      ["Buongiorno, sono l'assistente digitale di Muster.", "it"],
      ["Buongiorno, sono un assistente basato sull'intelligenza artificiale.", "it"],
      ["Hello, this is the AI assistant of Muster.", "en"],
      ["Hello, this is Muster's virtual assistant.", "en"],
      ["Hello, this is Muster's digital assistant.", "en"],
      ["Bonjour, ici l'assistant IA de Muster.", "fr"],
      ["Bonjour, ici l'assistante virtuelle de Muster.", "fr"],
      ["Bonjour, ici l'assistant numérique de Muster.", "fr"],
    ] as const) {
      assert.ok(disclosesAi(text, locale), text);
    }
  });

  it("rejects greetings that only look close", () => {
    for (const [text, locale] of [
      ["Hoi, hier ist der Assistent von Muster.", "de"],
      ["Buongiorno, sono l'assistente di Muster, vicino ai clienti.", "it"],
      ["Hello, this is Muster's assistant, said again.", "en"],
      ["Bonjour, ici l'assistant de Muster.", "fr"],
      ["Bonjour, je suis une IA.", "fr"],
    ] as const) {
      assert.ok(!disclosesAi(text, locale), text);
    }
  });
});

describe("MODOLO_VOICE_TENANT", () => {
  it("is the live studio tenant in four languages, German first, with only a written handoff", () => {
    assert.equal(modolo.id, "modolo");
    assert.equal(modolo.kind, "live");
    assert.equal(modolo.business.sector, "studio");
    assert.deepEqual(modolo.locales, ["de", "it", "en", "fr"]);
    assert.equal(modolo.defaultLocale, "de");
    assert.deepEqual(modolo.tools, ["create_lead", "end_call"]);
    assert.equal(modolo.calendar, undefined);
    assert.equal(modolo.handoff.transfer.enabled, false);
    assert.equal(modolo.handoff.callback.enabled, false);
    assert.equal(modolo.handoff.written.enabled, true);
    assert.deepEqual(modolo.handoff.emergency.triggers, []);
    assert.equal(modolo.answerPolicy.always, true);
  });

  it("greets informally in German and Italian and formally in French, disclosing the AI", () => {
    assert.equal(modolo.greeting.de, "Hoi, hier ist der KI-Assistent von Modolo Digital Studio. Wie kann ich dir helfen?");
    assert.deepEqual(modolo.persona.formality, { de: "informal", it: "informal", fr: "formal" });
    assert.match(modolo.greeting.it ?? "", /aiutarti/);
    assert.match(modolo.greeting.fr ?? "", /vous/);
  });

  it("promises a reply in the knowledge's own words, and names 112 for emergencies", () => {
    assert.equal(modolo.handoff.written.promise?.de, "Francesco antwortet persönlich, innert 24 Stunden.");
    const contact = modolo.knowledge().sections.find((section) => section.id === "contact");
    assert.ok(contact?.content.de?.includes("Francesco antwortet persönlich, innert 24 Stunden."), "same phrase as the knowledge");
    assert.ok(contact?.content.it?.includes(modolo.handoff.written.promise?.it?.slice(0, -1) ?? "\u0000"));
    assert.ok(contact?.content.en?.includes(modolo.handoff.written.promise?.en?.slice(0, -1) ?? "\u0000"));
    for (const locale of VOICE_LOCALES) {
      assert.ok(modolo.handoff.written.promise?.[locale]?.includes("24"), locale);
      assert.ok(modolo.handoff.emergency.message[locale]?.includes("112"), locale);
    }
  });

  it("keeps every text a person hears in Swiss spelling, without exclamation marks", () => {
    const heard = stringsIn([
      modolo.greeting,
      modolo.persona.assistantName,
      modolo.handoff.written.promise,
      modolo.handoff.emergency.message,
      modolo.tasks.map((t) => [t.label, t.fields.map((f) => [f.label, f.choices?.map((c) => c.label)])]),
      modolo.business.description,
      modolo.knowledge().sections.find((section) => section.id === "about_this_voice_assistant")?.content,
    ]);
    assert.ok(heard.length > 50);
    for (const text of heard) {
      assert.ok(!text.includes("ß"), text);
      assert.ok(!text.includes("!"), text);
    }
  });

  it("takes one project request with the agreed fields and contact needs", () => {
    assert.equal(modolo.tasks.length, 1);
    const request = task(modolo);
    assert.equal(request.id, "project_request");
    assert.deepEqual(
      request.fields.map((field) => [field.id, field.type, field.required]),
      [
        ["service", "choice", true],
        ["problem", "text", true],
        ["timing", "text", false],
        ["budget", "text", false],
      ],
    );
    assert.deepEqual(
      request.fields[0].choices?.map((choice) => choice.id),
      ["website", "online_shop", "seo", "google_profile", "hosting_care", "marketing", "automation", "ai_assistant", "software", "other"],
    );
    for (const choice of request.fields[0].choices ?? []) {
      for (const locale of VOICE_LOCALES) assert.ok(choice.label[locale], `${choice.id} in ${locale}`);
    }
    assert.deepEqual(request.contact, { name: "required", phone: "optional", email: "optional", company: "optional" });
  });

  it("ports the owner's decisions from the chat tenant and adds the voice-only ones", () => {
    const rules = modolo.rules.join("\n");
    for (const pattern of [
      /third person/,
      /Never offer, suggest or promise a phone call, a video call or a callback/,
      /'no VAT'/,
      /discount/,
      /domain and hosting cost something every year/,
      /client projects/,
      /start or delivery dates/,
      /'du' in German and 'tu' in Italian/,
      /dialect/,
      /publishes no opening hours/,
      /the caller chooses which, and one is enough/,
      /AI receptionists for other businesses are not in the knowledge/,
      /this is being built/,
    ]) {
      assert.match(rules, pattern);
    }
    assert.ok(!rules.includes("ß"));
  });

  it("keeps no audio and no transcripts, and links the site's privacy page", () => {
    assert.equal(modolo.plan, "demo");
    assert.deepEqual(modolo.privacy, {
      recordAudio: false,
      transcriptRetentionDays: 0,
      summaryRetentionDays: 365,
      noticeUrl: { de: "/de/datenschutz", it: "/it/privacy", en: "/privacy", fr: "/privacy" },
    });
  });

  it("allows the same origins as the chat and reports to the site's address", () => {
    assert.deepEqual(modolo.allowedOrigins, MODOLO_TENANT.allowedOrigins);
    assert.equal(modolo.notifyEmail, SITE.email);
  });
});

describe("voice tenant registry", () => {
  it("serves Modolo by default and every demo, each id once", () => {
    assert.equal(DEFAULT_VOICE_TENANT_ID, "modolo");
    assert.equal(getVoiceTenant(DEFAULT_VOICE_TENANT_ID), modolo);
    const ids = listVoiceTenantIds();
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, ["modolo", ...DEMO_TENANTS.map((tenant) => tenant.id)]);
    for (const demo of DEMO_TENANTS) assert.equal(getVoiceTenant(demo.id), demo);
  });

  it("matches ids exactly and never reaches the prototype", () => {
    for (const id of ["MODOLO", " modolo", "modolo ", "__proto__", "constructor", "toString", "", 42, null, undefined, {}]) {
      assert.equal(getVoiceTenant(id), null, String(id));
    }
  });

  it("holds only valid tenants; demo tenants are marked as demos", () => {
    for (const id of listVoiceTenantIds()) {
      const tenant = getVoiceTenant(id);
      assert.ok(tenant);
      assert.deepEqual(validateVoiceTenant(tenant), [], id);
    }
    for (const demo of DEMO_TENANTS) {
      assert.equal(demo.kind, "demo", demo.id);
      assert.ok(demo.id.startsWith("demo-"), demo.id);
      assert.equal(demo.privacy.recordAudio, false, demo.id);
    }
  });
});

describe("toVoicePublicConfig", () => {
  const SERVER_ONLY_KEYS = ["knowledge", "rules", "notifyEmail", "allowedOrigins", "handoff", "tasks", "calendar", "hours", "number", "targets", "answerPolicy", "persona", "plan"];

  function withTransfer(): VoiceTenantConfig {
    return broken((t) => {
      t.tools = [...t.tools, "transfer_call"];
      t.handoff.transfer = { enabled: true, ringSeconds: 20, targets: [{ id: "owner", label: { de: "Francesco" }, number: TRANSFER_NUMBER }] };
    });
  }

  it("builds the public subset of the tenant", () => {
    const config = toVoicePublicConfig(modolo, { locale: "it", limits: DEFAULT_VOICE_LIMITS, modes: ["local", "scripted"] });
    assert.deepEqual(config, {
      tenant: "modolo",
      kind: "live",
      businessName: "Modolo Digital Studio",
      sector: "studio",
      locale: "it",
      locales: ["de", "it", "en", "fr"],
      assistantName: modolo.persona.assistantName,
      greeting: modolo.greeting,
      privacyUrl: modolo.privacy.noticeUrl,
      limits: {
        maxCallSeconds: DEFAULT_VOICE_LIMITS.maxCallSeconds,
        warnBeforeEndSeconds: DEFAULT_VOICE_LIMITS.warnBeforeEndSeconds,
        silenceTimeoutSeconds: DEFAULT_VOICE_LIMITS.silenceTimeoutSeconds,
        maxTurnChars: DEFAULT_VOICE_LIMITS.maxTurnChars,
      },
      modes: ["local", "scripted"],
      endpoints: { session: VOICE_SESSION_ENDPOINT, turn: VOICE_TURN_ENDPOINT, end: VOICE_END_ENDPOINT },
    });
  });

  it("falls back to the default locale and drops unknown or repeated modes", () => {
    const config = toVoicePublicConfig(broken((t) => (t.locales = ["de", "it"])), {
      locale: "fr",
      limits: DEFAULT_VOICE_LIMITS,
      modes: ["realtime", "telepathy" as never, "realtime", "scripted"],
    });
    assert.equal(config.locale, "de");
    assert.deepEqual(config.modes, ["realtime", "scripted"]);
    assert.deepEqual(Object.keys(config.greeting), ["de", "it"], "texts only for the tenant's languages");
  });

  it("never carries knowledge, rules, numbers, the recipient or the origins", () => {
    const tenant = withTransfer();
    const config = toVoicePublicConfig(tenant, { locale: "de", limits: DEFAULT_VOICE_LIMITS, modes: ["local"] });
    const json = JSON.stringify(config);
    const keys = keysIn(JSON.parse(json));
    for (const key of SERVER_ONLY_KEYS) assert.ok(!keys.has(key), `public config has a "${key}" key`);
    assert.ok(!json.includes(TRANSFER_NUMBER) && !json.includes(TRANSFER_NUMBER.slice(3)), "a transfer number leaked");
    assert.ok(!json.includes(SITE.email), "the summary recipient leaked");
    for (const origin of tenant.allowedOrigins) assert.ok(!json.includes(origin), `allowed origin ${origin} leaked`);
    for (const rule of tenant.rules) assert.ok(!json.includes(rule), "a rule leaked");
    for (const t of tenant.tasks) assert.ok(!json.includes(t.when), "a task instruction leaked");
    const knowledge = tenant
      .knowledge()
      .sections.flatMap((section) => Object.values(section.content))
      .filter((text): text is string => typeof text === "string" && text.length > 40);
    for (const text of knowledge) assert.ok(!json.includes(text), "a knowledge section leaked");
    assert.deepEqual(Object.keys(config.limits).sort(), ["maxCallSeconds", "maxTurnChars", "silenceTimeoutSeconds", "warnBeforeEndSeconds"]);
  });

  it("copies texts key by key, so nothing else on those objects travels", () => {
    const tenant = broken((t) => {
      (t.greeting as Record<string, string>).secret = "server-only";
    });
    const json = JSON.stringify(toVoicePublicConfig(tenant, { locale: "de", limits: DEFAULT_VOICE_LIMITS, modes: [] }));
    assert.ok(!json.includes("server-only"));
  });
});
