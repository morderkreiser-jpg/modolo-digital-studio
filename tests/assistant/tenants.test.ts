// The real Modolo tenant (lib/assistant/tenants) checked against the contract's shared decisions,
// its rendered prompt, and the browser-facing config (lib/assistant/server/public-config.ts),
// which must never carry server-only data.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getStrings } from "@/lib/assistant/i18n";
import { isValidEmail } from "@/lib/assistant/lead-schema";
import { pickText } from "@/lib/assistant/localize";
import { renderKnowledge } from "@/lib/assistant/server/knowledge";
import { buildSystem, buildTools } from "@/lib/assistant/server/prompt";
import { toPublicConfig } from "@/lib/assistant/server/public-config";
import { DEFAULT_TENANT_ID, getTenant, listTenantIds } from "@/lib/assistant/tenants";
import { PUBLISHED_PRICE_REGIONS, THIRD_PERSON, formatAmount } from "@/lib/assistant/tenants/modolo/knowledge";
import { ASSISTANT_CHAT_ENDPOINT, ASSISTANT_LEAD_ENDPOINT, ASSISTANT_LOCALES, DEFAULT_LIMITS } from "@/lib/assistant/types";
import type { AssistantLocale, TenantConfig } from "@/lib/assistant/types";
import { BRANDING, CARE, GOOD_TO_KNOW, INCLUDED, WEBSITES } from "@/lib/pricing";
import { isRegion } from "@/lib/region";
import { makeLimits, makeTenant } from "./fixtures";

// Client sites from the portfolio (lib/site-data.ts): the tenant rules forbid linking to them.
const CLIENT_DOMAINS = ["zurikey.ch", "saporivivi.ch", "bjstudiodebelleza.ch"];
// Contract §4: never claim "no VAT"; the knowledge says "final price, nothing added".
const NO_VAT = /senza\s+iva|keine\s+mwst|keine\s+mehrwertsteuer|ohne\s+mwst|no\s+vat|without\s+vat|vat[- ]free/i;
const SERVER_ONLY_KEYS = ["notifyEmail", "knowledge", "ai", "allowedOrigins", "rules"];

function modolo(): TenantConfig {
  const tenant = getTenant("modolo");
  assert.ok(tenant, 'getTenant("modolo") must return the Modolo tenant');
  return tenant;
}

// First-person pronouns per locale, as whole words (Unicode-aware: \b would split "persönlich").
// lib/pricing.ts speaks as Francesco; what reaches the model must not (THIRD_PERSON in knowledge.ts).
const WORD = (words: string, flags = "") =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, `u${flags}`);
const FIRST_PERSON: Record<AssistantLocale, RegExp> = {
  en: WORD("I|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself"),
  de: WORD("ich|mir|mich|mein\\p{L}*", "i"),
  it: WORD("io|me|mi|mio|mia|miei|mie", "i"),
};

/** Every string stored under `locale` anywhere in a nested value (the Tri texts of lib/pricing.ts). */
function textsFor(value: unknown, locale: string, out: string[] = []): string[] {
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === locale && typeof child === "string") out.push(child);
      else textsFor(child, locale, out);
    }
  }
  return out;
}

/** The knowledge rendered with only the given sections, exactly as the prompt renders it. */
function renderSections(tenant: TenantConfig, ids: string[], locale: AssistantLocale, region: string): string {
  const kb = tenant.knowledge();
  for (const id of ids) assert.ok(kb.sections.some((section) => section.id === id), `section "${id}" exists`);
  const sections = kb.sections.filter((section) => ids.includes(section.id));
  return renderKnowledge({ version: kb.version, sections }, locale, region, tenant.defaultLocale);
}

/** Every key and string anywhere in a JSON-like value, and whether a function hides in it. */
function walk(value: unknown, keys = new Set<string>(), strings: string[] = []) {
  let hasFunction = typeof value === "function";
  if (typeof value === "string") strings.push(value);
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      hasFunction = walk(child, keys, strings).hasFunction || hasFunction;
    }
  }
  return { keys, strings, hasFunction };
}

describe("tenant registry", () => {
  it("resolves the default Modolo tenant by exact id", () => {
    assert.equal(DEFAULT_TENANT_ID, "modolo");
    assert.equal(modolo().id, "modolo");
    assert.ok(listTenantIds().includes("modolo"));
    for (const id of listTenantIds()) assert.equal(getTenant(id)?.id, id);
  });

  it("returns null for unknown, near-miss, non-string and prototype-key ids", () => {
    for (const id of [
      "nope",
      "MODOLO",
      " modolo",
      "modolo ",
      "",
      undefined,
      null,
      42,
      {},
      ["modolo"],
      { toString: () => "modolo" },
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      assert.equal(getTenant(id), null, `getTenant(${JSON.stringify(id) ?? String(id)})`);
    }
  });
});

describe("Modolo tenant data", () => {
  it("matches the contract's shared decisions (§5b)", () => {
    const tenant = modolo();
    assert.equal(tenant.defaultLocale, "en", "lead emails are in the tenant default locale: en");
    for (const locale of ASSISTANT_LOCALES) assert.ok(tenant.locales.includes(locale), locale);
    assert.equal(tenant.leads.retentionDays, 365);
    assert.ok(isValidEmail(tenant.leads.notifyEmail), "notifyEmail must be a valid address");
    assert.ok(tenant.ai.rules.length > 0, "tenant rules (§4)");
  });

  it("has complete, unique lead options with labels in every locale", () => {
    const { leads } = modolo();
    assert.ok(leads.services.length > 0);
    const lists = { services: leads.services, ...leads.budgetOptions };
    assert.ok("default" in leads.budgetOptions, "budgetOptions.default is the fallback list");
    for (const [name, options] of Object.entries(lists)) {
      const ids = options.map((option) => option.id);
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ids`);
      for (const option of options) {
        for (const locale of ASSISTANT_LOCALES) assert.ok(pickText(option.label, locale).length > 0, `${name}.${option.id} ${locale}`);
      }
    }
  });

  it("has consistent regions and per-locale UI texts", () => {
    const tenant = modolo();
    assert.ok(tenant.regions.ids.includes(tenant.regions.default));
    for (const region of Object.values(tenant.regions.byCountry ?? {})) assert.ok(tenant.regions.ids.includes(region), region);
    for (const region of tenant.regions.ids) assert.ok(pickText(tenant.regions.labels[region], "en").length > 0, region);
    for (const locale of tenant.locales) {
      assert.ok(pickText(tenant.welcome, locale).length > 0, `welcome ${locale}`);
      assert.ok(pickText(tenant.privacyUrl, locale).length > 0, `privacyUrl ${locale}`);
      assert.ok((tenant.starters[locale] ?? []).length <= 4, `at most 4 starters (${locale})`);
    }
  });

  it("has a versioned knowledge base with unique, non-empty sections", () => {
    const kb = modolo().knowledge();
    assert.ok(kb.version.length > 0);
    assert.ok(kb.sections.length > 0);
    const ids = kb.sections.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate section ids");
    for (const section of kb.sections) assert.ok(Object.values(section.content).some((text) => (text ?? "").trim().length > 0), section.id);
  });

  it("renders knowledge that respects the tenant rules for every locale and region", () => {
    const tenant = modolo();
    for (const locale of tenant.locales) {
      for (const region of tenant.regions.ids) {
        const text = renderKnowledge(tenant.knowledge(), locale, region, tenant.defaultLocale);
        assert.ok(text.trim().length > 0, `${locale}/${region}`);
        assert.doesNotMatch(text, NO_VAT, `${locale}/${region}: "no VAT" wording`);
        for (const domain of CLIENT_DOMAINS) assert.ok(!text.includes(domain), `${locale}/${region}: link to client site ${domain}`);
      }
    }
  });
});

describe("Modolo knowledge: price list in the third person", () => {
  it("still finds every first-person passage it rewrites in lib/pricing.ts", () => {
    // A rewrite whose source was edited stops applying in silence; Italian verbs ("Configuro")
    // carry no pronoun the check below could see, so each pair must still match.
    for (const locale of ASSISTANT_LOCALES) {
      const source = textsFor([WEBSITES, CARE, BRANDING, GOOD_TO_KNOW, INCLUDED], locale).join("\n");
      assert.ok(THIRD_PERSON[locale].length > 0, locale);
      for (const [from] of THIRD_PERSON[locale]) {
        assert.ok(source.includes(from), `${locale}: «${from}» is no longer in lib/pricing.ts; update THIRD_PERSON in knowledge.ts`);
      }
    }
  });

  it("recognises first-person wording, and the rewrites have none", () => {
    const samples: Record<AssistantLocale, string[]> = {
      en: ["You always talk to me — no call centre", "I come to you", "Send my photos"],
      de: ["Du sprichst immer mit mir — kein Callcenter", "Ich komme vorbei", "Meine Fotos"],
      it: ["Parli sempre con me, mai un call center", "Vengo io da te", "Le mie foto"],
    };
    for (const locale of ASSISTANT_LOCALES) {
      for (const sample of samples[locale]) assert.match(sample, FIRST_PERSON[locale], `${locale}: ${sample}`);
      for (const [, to] of THIRD_PERSON[locale]) assert.doesNotMatch(to, FIRST_PERSON[locale], `${locale}: ${to}`);
    }
  });

  it("has no first-person pronoun in the price list or the website inclusions, in any locale or region", () => {
    const tenant = modolo();
    for (const locale of tenant.locales) {
      for (const region of tenant.regions.ids) {
        const text = renderSections(tenant, ["pricing", "included"], locale, region);
        const hit = FIRST_PERSON[locale].exec(text);
        const around = hit ? text.slice(Math.max(0, hit.index - 60), hit.index + 60) : "";
        assert.equal(hit, null, `${locale}/${region}: first person «${hit?.[0]}» in …${around}…`);
        assert.ok(text.includes("Francesco"), `${locale}/${region}: the rewrites name Francesco`);
      }
    }
  });
});

describe("Modolo knowledge: prices and running costs", () => {
  it("opens the Websites group with where website packages start, only where prices are published", () => {
    const tenant = modolo();
    const first = WEBSITES.items.find((item) => item.from);
    assert.ok(first, "a website package priced 'from'");
    const entryServices = WEBSITES.items.filter((item) => !item.from);
    for (const locale of tenant.locales) {
      for (const region of tenant.regions.ids) {
        assert.ok(isRegion(region), region);
        const lines = renderSections(tenant, ["pricing"], locale, region).split("\n");
        const heading = lines.findIndex((line) => line.startsWith(`**${WEBSITES.title[locale]}**`));
        assert.ok(heading >= 0, `${locale}/${region}: Websites heading`);
        const next = lines[heading + 1] ?? "";
        if (!PUBLISHED_PRICE_REGIONS.includes(region)) {
          assert.ok(next.startsWith("- "), `${locale}/${region}: no summary line without published prices: ${next}`);
          continue;
        }
        assert.ok(!next.startsWith("- "), `${locale}/${region}: a summary line follows the heading`);
        assert.ok(next.includes(formatAmount(first.price[region], region, locale)), `${locale}/${region}: ${next}`);
        for (const item of [first, ...entryServices]) assert.ok(next.includes(`**${item.name[locale]}**`), `${locale}/${region}: ${next}`);
      }
    }
  });

  it("files only Google-listing and booking services at a fixed price under Websites", () => {
    // The summary line calls every fixed-price item of the group "not a website": keep it true.
    for (const item of WEBSITES.items.filter((entry) => !entry.from)) {
      assert.match(`${item.name.en}. ${item.desc.en}`, /google|book/i, item.name.en);
    }
    const first = WEBSITES.items.find((item) => item.from);
    assert.ok(first);
    assert.doesNotMatch(first.name.en, /google|book/i, "the first package priced 'from' must be a website");
  });

  it("quotes no amount for a region whose prices the website does not publish", () => {
    const tenant = modolo();
    for (const region of tenant.regions.ids.filter((id) => isRegion(id) && !PUBLISHED_PRICE_REGIONS.includes(id))) {
      for (const locale of tenant.locales) {
        assert.doesNotMatch(renderSections(tenant, ["pricing"], locale, region), /(?:CHF|EUR|€)\s?\d|\d\s?(?:CHF|EUR|€)/, `${locale}/${region}`);
      }
    }
  });

  it("tells every visitor that domain and hosting cost something every year", () => {
    const tenant = modolo();
    const runningCosts: Record<AssistantLocale, string> = {
      en: "Domain and hosting cost something every year",
      de: "Domain und Hosting kosten wie bei jeder Website etwas pro Jahr",
      it: "Dominio e hosting hanno un costo annuale",
    };
    for (const locale of tenant.locales) {
      for (const region of tenant.regions.ids) {
        const text = renderKnowledge(tenant.knowledge(), locale, region, tenant.defaultLocale);
        assert.ok(text.includes(runningCosts[locale]), `${locale}/${region}`);
      }
    }
  });
});

describe("Modolo knowledge: about this chat", () => {
  // The canonical privacy facts, as the privacy policy states them.
  const markers: Record<AssistantLocale, string[]> = {
    en: ["Anthropic Ireland, Limited (Ireland)", "United States", "not used to train", "limited period", "session storage", "per IP address", "24 hours", "Resend", "12 months", "sensitive personal data"],
    de: ["Anthropic Ireland, Limited (Irland)", "USA", "nicht zum Training", "begrenzte Zeit", "Sitzungsspeicher", "pro IP-Adresse", "24 Stunden", "Resend", "12 Monate", "sensiblen Personendaten"],
    it: ["Anthropic Ireland, Limited (Irlanda)", "Stati Uniti", "non vengono usati per addestrare", "periodo limitato", "memoria di sessione", "per indirizzo IP", "24 ore", "Resend", "12 mesi", "dati personali sensibili"],
  };

  it("states the processor, what is sent, retention, counters and quote requests like the privacy policy", () => {
    const tenant = modolo();
    for (const locale of tenant.locales) {
      const text = renderSections(tenant, ["chat"], locale, tenant.regions.default);
      for (const marker of markers[locale]) assert.ok(text.includes(marker), `${locale}: «${marker}»`);
      assert.ok(text.includes(tenant.leads.notifyEmail), `${locale}: quote requests go to ${tenant.leads.notifyEmail}`);
      // Anthropic's own terms set its retention period: the chat never names a number of days.
      assert.doesNotMatch(text, /\d+\s*(?:days|Tage|giorni)/, locale);
    }
  });

  it("never names the processor Anthropic, PBC anywhere in the knowledge", () => {
    const tenant = modolo();
    for (const locale of tenant.locales) {
      for (const region of tenant.regions.ids) {
        assert.doesNotMatch(renderKnowledge(tenant.knowledge(), locale, region, tenant.defaultLocale), /Anthropic, PBC|San Francisco/, `${locale}/${region}`);
      }
    }
  });
});

describe("Modolo UI strings", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  const at = (tree: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((node, key) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined), tree);

  it("says in the quote form that Francesco replies personally, in every locale", () => {
    const tenant = modolo();
    for (const locale of tenant.locales) {
      const { form } = getStrings(locale, tenant.strings);
      assert.match(form.intro, /Francesco/, locale);
      assert.match(form.successText, /Francesco/, locale);
      assert.ok(form.successText.includes("{name}"), `${locale}: the success text greets the visitor by name`);
    }
  });

  it("overrides only existing strings, with no placeholder the widget cannot fill", () => {
    const tenant = modolo();
    const entries = Object.entries(tenant.strings ?? {});
    assert.ok(entries.length > 0, "Modolo overrides some strings");
    for (const [locale, overrides] of entries) {
      assert.ok(tenant.locales.includes(locale as AssistantLocale), locale);
      const applied = getStrings(locale as AssistantLocale, tenant.strings);
      const defaults = getStrings(locale as AssistantLocale);
      for (const [path, text] of Object.entries(overrides ?? {})) {
        assert.equal(typeof text, "string");
        // getStrings ignores unknown keys, so an applied override proves the key exists.
        assert.equal(at(applied, path), text, `${locale}: ${path} is applied`);
        const original = at(defaults, path);
        assert.equal(typeof original, "string", `${locale}: ${path}`);
        for (const name of placeholders(text ?? "")) {
          assert.ok(placeholders(String(original)).includes(name), `${locale}: ${path} uses {${name}}, which the default does not`);
        }
      }
    }
  });

  it("ships the overrides to the browser", () => {
    const tenant = modolo();
    const config = toPublicConfig(tenant, { locale: "de", limits: DEFAULT_LIMITS, leadsAvailable: true });
    assert.deepEqual(config.strings, tenant.strings);
    for (const locale of tenant.locales) {
      assert.deepEqual(getStrings(locale, config.strings), getStrings(locale, tenant.strings), locale);
    }
  });
});

describe("Modolo prompt", () => {
  it("has a cacheable static block for every locale and region", () => {
    const tenant = modolo();
    for (const locale of tenant.locales) {
      for (const region of tenant.regions.ids) {
        const blocks = buildSystem({ tenant, locale, region, remainingMessages: 10, now: new Date("2026-11-15T10:00:00Z") });
        assert.equal(blocks.length, 2);
        assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
        // Prompt caching needs a prefix of at least 512 tokens; 3000 characters is safely above it.
        assert.ok(blocks[0].text.length >= 3000, `${locale}/${region}: static block is ${blocks[0].text.length} chars`);
      }
    }
  });

  it("prices per region: the static blocks of different regions differ", () => {
    const tenant = modolo();
    if (tenant.regions.ids.length < 2) return;
    const [first, second] = tenant.regions.ids;
    const block = (region: string) => buildSystem({ tenant, locale: "en", region, remainingMessages: 10 })[0].text;
    assert.notEqual(block(first), block(second));
  });

  it("offers the quote tool with exactly the tenant's service ids", () => {
    const tenant = modolo();
    const [tool] = buildTools(tenant);
    const properties = (tool?.input_schema.properties ?? {}) as Record<string, { enum?: unknown[] }>;
    assert.deepEqual(properties.service?.enum, tenant.leads.services.map((service) => service.id));
  });

  it("answers Swiss German dialect in Swiss Standard German", () => {
    const tenant = modolo();
    const rule = tenant.ai.rules.find((text) => /Swiss German dialect/.test(text));
    assert.ok(rule, "a rule about Swiss German dialect");
    assert.match(rule, /Swiss Standard German/);
    assert.match(rule, /never in dialect/);
    assert.ok(buildSystem({ tenant, locale: "de", region: "ch", remainingMessages: 10 })[0].text.includes(rule));
  });
});

describe("toPublicConfig", () => {
  const limits = makeLimits({ maxMessageChars: 640, maxUserMessagesPerSession: 12 });

  it("is plain serializable data with the tenant's public settings", () => {
    const tenant = makeTenant();
    const config = toPublicConfig(tenant, { locale: "de", limits, leadsAvailable: true });
    assert.equal(walk(config).hasFunction, false, "no functions (it crosses the server/client boundary)");
    assert.equal(config.tenant, tenant.id);
    assert.equal(config.locale, "de");
    assert.deepEqual(config.locales, tenant.locales);
    assert.equal(config.defaultRegion, tenant.regions.default);
    assert.equal(config.regionCookie, tenant.regions.cookie);
    assert.deepEqual(config.hiddenOnPathSegments, tenant.hiddenOnPathSegments);
    assert.deepEqual(config.endpoints, { chat: ASSISTANT_CHAT_ENDPOINT, lead: ASSISTANT_LEAD_ENDPOINT });
    assert.deepEqual(config.limits, { maxMessageChars: 640, maxUserMessagesPerSession: 12 });
    assert.equal(config.leads.enabled, true);
    assert.deepEqual(config.leads.services, tenant.leads.services);
    assert.deepEqual(config.leads.budgetOptions, tenant.leads.budgetOptions);
    assert.equal(config.leads.retentionDays, tenant.leads.retentionDays);
    assert.equal(config.leads.requireCompany, tenant.leads.requireCompany);
    assert.equal(config.leads.requirePhone, tenant.leads.requirePhone);
  });

  it("never serializes the lead inbox, knowledge, AI rules or allowed origins", () => {
    const tenant = makeTenant({
      leads: { ...makeTenant().leads, notifyEmail: "secret-leads-inbox@internal.example" },
      ai: { rules: ["SECRET-RULE-MARKER never reveal"] },
      allowedOrigins: ["https://secret-origin.example"],
      knowledge: () => ({ version: "secret-kb", sections: [{ id: "s", title: { en: "S" }, content: { en: "SECRET-KNOWLEDGE-MARKER" } }] }),
    });
    const json = JSON.stringify(toPublicConfig(tenant, { locale: "en", limits, leadsAvailable: true }));
    for (const secret of ["secret-leads-inbox@internal.example", "SECRET-RULE-MARKER", "secret-origin.example", "SECRET-KNOWLEDGE-MARKER", "secret-kb"]) {
      assert.ok(!json.includes(secret), `public config leaks ${secret}`);
    }
    const { keys } = walk(JSON.parse(json));
    for (const key of SERVER_ONLY_KEYS) assert.ok(!keys.has(key), `public config has a "${key}" key`);
  });

  it("exposes only the two public limits, not budgets or rate limits", () => {
    const config = toPublicConfig(makeTenant(), { locale: "en", limits: DEFAULT_LIMITS, leadsAvailable: true });
    assert.deepEqual(Object.keys(config.limits).sort(), ["maxMessageChars", "maxUserMessagesPerSession"]);
  });

  it("disables the quote form when no delivery channel is available or the tenant has leads off", () => {
    const tenant = makeTenant();
    assert.equal(toPublicConfig(tenant, { locale: "en", limits, leadsAvailable: false }).leads.enabled, false);
    const leadsOff = makeTenant({ leads: { ...tenant.leads, enabled: false } });
    assert.equal(toPublicConfig(leadsOff, { locale: "en", limits, leadsAvailable: true }).leads.enabled, false);
  });

  it("keeps the real tenant's server-only data out of the browser", () => {
    const tenant = modolo();
    const config = toPublicConfig(tenant, { locale: "it", limits: DEFAULT_LIMITS, leadsAvailable: true });
    const { keys, strings, hasFunction } = walk(config);
    assert.equal(hasFunction, false);
    for (const key of SERVER_ONLY_KEYS) assert.ok(!keys.has(key), `public config has a "${key}" key`);
    const json = JSON.stringify(config);
    for (const rule of tenant.ai.rules) assert.ok(!json.includes(rule), "an AI rule leaked into the public config");
    const knowledge = tenant
      .knowledge()
      .sections.flatMap((section) => Object.values(section.content))
      .filter((text): text is string => typeof text === "string" && text.length > 80);
    for (const text of knowledge) assert.ok(!strings.includes(text), "a knowledge section leaked into the public config");
  });
});
