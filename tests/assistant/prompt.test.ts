// Prompt assembly (lib/assistant/server/prompt.ts) on fake tenants: the cache-safe two-block
// system prompt, the quote tool, tool-input parsing and the history sent to the model.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getStrings } from "@/lib/assistant/i18n";
import { LOCALE_NAMES } from "@/lib/assistant/localize";
import {
  QUOTE_TOOL_NAME,
  buildSystem,
  buildTools,
  getKnowledgeVersion,
  parseQuoteToolInput,
  toModelMessages,
} from "@/lib/assistant/server/prompt";
import type { PromptContext } from "@/lib/assistant/server/prompt";
import type { ChatTurn } from "@/lib/assistant/types";
import { contentText, makeTenant } from "./fixtures";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DATE = /\b20\d\d-\d\d-\d\d\b/;
const tenant = makeTenant();

function ctx(patch: Partial<PromptContext> = {}): PromptContext {
  return {
    tenant,
    locale: "it",
    region: "ch",
    page: "/it/servizi",
    state: { quoteFormShown: false, leadSubmitted: false },
    remainingMessages: 17,
    now: new Date("2026-11-15T23:30:00Z"), // 00:30 on 16 November in Zurich
    ...patch,
  };
}

const staticText = (patch: Partial<PromptContext> = {}) => buildSystem(ctx(patch))[0].text;
const dynamicText = (patch: Partial<PromptContext> = {}) => buildSystem(ctx(patch))[1].text;

describe("buildSystem", () => {
  it("returns exactly two text blocks with cache_control on the first only", () => {
    const blocks = buildSystem(ctx());
    assert.equal(blocks.length, 2);
    for (const block of blocks) {
      assert.equal(block.type, "text");
      assert.ok(block.text.trim().length > 0);
    }
    assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
    assert.ok(!blocks[1].cache_control, "the dynamic block must not carry a cache breakpoint");
  });

  it("keeps the static block byte-identical when only page, date, state or remaining messages change", () => {
    const reference = JSON.stringify(buildSystem(ctx())[0]);
    const variants: Array<Partial<PromptContext>> = [
      { page: "/de/preise" },
      { page: undefined },
      { now: new Date("2027-03-01T08:00:00Z") },
      { now: undefined },
      { state: { quoteFormShown: true, leadSubmitted: true } },
      { state: undefined },
      { remainingMessages: 0 },
      { remainingMessages: 29 },
    ];
    for (const variant of variants) {
      assert.equal(JSON.stringify(buildSystem(ctx(variant))[0]), reference, JSON.stringify(variant));
    }
  });

  it("puts the generic rules, the tenant rules and the region's knowledge in the static block", () => {
    const text = staticText();
    assert.ok(text.includes(tenant.ai.rules[0]), "tenant.ai.rules");
    assert.ok(text.includes("Sito: CHF 1200."), "Swiss Italian knowledge variant");
    assert.ok(!text.includes("EUR 900"), "another region's prices");
    assert.ok(/hold for the whole conversation/i.test(text), "the persistence rule from the contract (§1)");
  });

  it("keeps dates, page paths and conversation state out of the static block", () => {
    const text = staticText({ page: "/it/servizi/sito-per-saloni" });
    assert.doesNotMatch(text, DATE);
    assert.ok(!text.includes("/it/servizi/sito-per-saloni"));
  });

  it("renders the static block for the requested region and locale", () => {
    assert.ok(staticText({ region: "it" }).includes("Sito: EUR 900."));
    assert.ok(!staticText({ region: "it" }).includes("CHF 1200"));
    assert.ok(staticText({ locale: "en" }).includes("Website: CHF 1200."));
  });

  it("puts today's Zurich date, page, language, region and remaining messages in the dynamic block", () => {
    const text = dynamicText();
    assert.ok(text.includes("2026-11-16"), `Zurich date expected in: ${text}`);
    assert.ok(text.includes("/it/servizi"));
    assert.ok(text.includes(LOCALE_NAMES.it.english) || text.includes(LOCALE_NAMES.it.native), "UI language name");
    assert.ok(text.includes("Switzerland (prices in CHF)"), "region label");
    assert.ok(/\b17\b/.test(text), "remaining messages");
  });

  it("dates the dynamic block in Europe/Zurich across daylight saving time", () => {
    assert.ok(dynamicText({ now: new Date("2026-07-01T22:30:00Z") }).includes("2026-07-02"), "summer: UTC+2");
    assert.ok(dynamicText({ now: new Date("2026-01-15T22:59:00Z") }).includes("2026-01-15"), "winter: UTC+1");
  });

  it("reflects the conversation state and remaining messages in the dynamic block", () => {
    const base = dynamicText();
    assert.notEqual(dynamicText({ state: { quoteFormShown: true, leadSubmitted: false } }), base);
    assert.notEqual(dynamicText({ state: { quoteFormShown: false, leadSubmitted: true } }), base);
    assert.notEqual(dynamicText({ remainingMessages: 3 }), base);
  });

  it("separates tenants: another tenant's rules never appear", () => {
    const other = makeTenant({ ai: { rules: ["Other tenant: always answer in verse."] } });
    assert.ok(!staticText().includes("always answer in verse"));
    assert.ok(buildSystem(ctx({ tenant: other }))[0].text.includes("always answer in verse"));
  });
});

describe("buildSystem: what the assistant can't do", () => {
  const line = (text: string, marker: string) => text.split("\n").find((entry) => entry.includes(marker)) ?? "";

  it("says it can't pass messages on, contact anyone, book, open links or look things up", () => {
    const text = staticText({ locale: "en" });
    for (const marker of [
      "can't pass messages on",
      `contact the owner or staff of ${tenant.branding.name}`,
      "book or schedule appointments",
      "open links",
      "Google listings",
    ]) {
      assert.ok(text.includes(marker), marker);
    }
  });

  it("never lets it claim that something was passed on: only the form or a direct message reaches the business", () => {
    const sentence = line(staticText(), "Nothing written in this chat reaches");
    assert.ok(sentence.includes(tenant.branding.name), sentence);
    assert.ok(sentence.includes("quote form"), sentence);
    assert.ok(sentence.includes("never say or suggest that you have passed something on"), sentence);

    const noLeads = makeTenant({ leads: { ...tenant.leads, enabled: false } });
    const withoutForm = line(buildSystem(ctx({ tenant: noLeads }))[0].text, "Nothing written in this chat reaches");
    assert.ok(withoutForm.includes("writes to them directly"), withoutForm);
    assert.ok(!withoutForm.includes("quote form"), "no quote form to point to when leads are off");
  });

  it("points to the quote button by its label in the UI language, never to a form above", () => {
    for (const locale of tenant.locales) {
      const label = getStrings(locale, tenant.strings).quoteChip;
      const sentence = line(staticText({ locale }), `«${label}»`);
      assert.ok(sentence, `${locale}: the button label «${label}» is in the prompt`);
      assert.ok(sentence.includes("gone after a page reload"), sentence);
      assert.ok(sentence.includes('never to a form "above"'), sentence);
    }
  });

  it("uses the tenant's own label when it overrides the button text", () => {
    const custom = makeTenant({ strings: { de: { quoteChip: "Angebot holen" } } });
    assert.ok(buildSystem(ctx({ tenant: custom, locale: "de" }))[0].text.includes("«Angebot holen»"));
    assert.ok(buildSystem(ctx({ tenant: custom, locale: "en" }))[0].text.includes(`«${getStrings("en").quoteChip}»`));
  });

  it("never mentions the button when the tenant takes no quote requests", () => {
    const noLeads = makeTenant({ leads: { ...tenant.leads, enabled: false } });
    for (const locale of noLeads.locales) {
      assert.ok(!buildSystem(ctx({ tenant: noLeads, locale }))[0].text.includes(`«${getStrings(locale).quoteChip}»`), locale);
    }
  });

  it("tells the model that a form shown earlier may have been closed", () => {
    assert.match(dynamicText({ state: { quoteFormShown: true, leadSubmitted: false } }), /may have closed it/);
  });
});

describe("buildTools", () => {
  function quoteSchema(tools: ReturnType<typeof buildTools>) {
    assert.equal(tools.length, 1);
    const [tool] = tools;
    assert.equal(tool.name, QUOTE_TOOL_NAME);
    assert.equal(tool.input_schema.type, "object");
    return { tool, properties: (tool.input_schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }> };
  }

  it("names the tool offer_quote_form", () => {
    assert.equal(QUOTE_TOOL_NAME, "offer_quote_form");
  });

  it("offers one quote tool whose service enum equals the tenant's lead service ids", () => {
    const { tool, properties } = quoteSchema(buildTools(tenant));
    assert.ok((tool.description ?? "").trim().length > 0, "the model needs a description to decide when to call it");
    assert.deepEqual(properties.service?.enum, tenant.leads.services.map((service) => service.id));
    assert.equal(properties.summary?.type, "string");
  });

  it("follows each tenant's own services", () => {
    const restaurant = makeTenant({
      leads: { ...tenant.leads, services: [{ id: "catering", label: { en: "Catering" } }, { id: "event", label: { en: "Event" } }] },
    });
    assert.deepEqual(quoteSchema(buildTools(restaurant)).properties.service?.enum, ["catering", "event"]);
  });

  it("keeps the API's default buffered tool input (no eager_input_streaming)", () => {
    const [tool] = buildTools(tenant);
    assert.notEqual((tool as { eager_input_streaming?: unknown }).eager_input_streaming, true);
  });

  it("is byte-stable across calls (tools are part of the cached prefix)", () => {
    assert.equal(JSON.stringify(buildTools(tenant)), JSON.stringify(buildTools(tenant)));
  });

  it("returns no tools when the tenant's leads are disabled", () => {
    assert.deepEqual(buildTools(makeTenant({ leads: { ...tenant.leads, enabled: false } })), []);
  });
});

describe("parseQuoteToolInput", () => {
  it("returns a quote_form action with a valid service and summary", () => {
    assert.deepEqual(parseQuoteToolInput({ service: "website", summary: "Sito per un salone a Winterthur." }, tenant), {
      kind: "quote_form",
      service: "website",
      summary: "Sito per un salone a Winterthur.",
    });
  });

  it("omits a service that is not one of the tenant's ids", () => {
    const action = parseQuoteToolInput({ service: "hacking", summary: "Qualcosa" }, tenant);
    assert.ok(action);
    assert.equal(action.service, undefined);
    assert.equal(action.summary, "Qualcosa");
  });

  it("caps the summary at 600 characters and strips control characters", () => {
    const long = parseQuoteToolInput({ service: "website", summary: "s".repeat(1000) }, tenant);
    assert.ok(long?.summary && long.summary.length > 0 && long.summary.length <= 600, String(long?.summary?.length));
    const dirty = parseQuoteToolInput({ summary: "Riga\u0000 uno\u0007 e\u001b[2J due" }, tenant);
    assert.ok(dirty?.summary);
    assert.doesNotMatch(dirty.summary, CONTROL);
  });

  it("returns null for junk input", () => {
    for (const input of [null, undefined, "website", 42, true]) {
      assert.equal(parseQuoteToolInput(input, tenant), null, String(input));
    }
  });

  it("ignores non-string fields and never passes other input keys through", () => {
    const action = parseQuoteToolInput({ service: 42, summary: { text: "x" } }, tenant);
    if (action) {
      assert.equal(action.service, undefined);
      assert.equal(action.summary, undefined);
    }
    const extra = parseQuoteToolInput({ service: "website", summary: "ok", url: "javascript:alert(1)", html: "<b>x</b>" }, tenant);
    assert.ok(extra);
    for (const key of Object.keys(extra)) assert.ok(["kind", "service", "summary"].includes(key), key);
  });
});

describe("toModelMessages", () => {
  const u = (content: string): ChatTurn => ({ role: "user", content });
  const a = (content: string): ChatTurn => ({ role: "assistant", content });
  const simplify = (turns: ChatTurn[], max: number) =>
    toModelMessages(turns, max).map((message) => ({ role: message.role, text: contentText(message.content) }));

  it("forwards the whole conversation when it fits", () => {
    assert.deepEqual(simplify([u("u1"), a("a1"), u("u2")], 14), [
      { role: "user", text: "u1" },
      { role: "assistant", text: "a1" },
      { role: "user", text: "u2" },
    ]);
  });

  it("keeps the last N turns, then drops leading assistant turns", () => {
    const turns = [u("u1"), a("a1"), u("u2"), a("a2"), u("u3")];
    assert.deepEqual(simplify(turns, 3), [
      { role: "user", text: "u2" },
      { role: "assistant", text: "a2" },
      { role: "user", text: "u3" },
    ]);
    assert.deepEqual(simplify(turns, 2), [{ role: "user", text: "u3" }]);
  });

  it("merges consecutive same-role turns with a blank line", () => {
    assert.deepEqual(simplify([u("u1"), u("u2"), a("a1"), a("a2"), u("u3")], 14), [
      { role: "user", text: "u1\n\nu2" },
      { role: "assistant", text: "a1\n\na2" },
      { role: "user", text: "u3" },
    ]);
  });

  it("always starts and ends with a user message (no prefill) and uses only user/assistant roles", () => {
    for (let max = 1; max <= 7; max += 1) {
      const messages = toModelMessages([a("welcome"), u("u1"), a("a1"), u("u2"), a("a2"), u("u3")], max);
      assert.ok(messages.length > 0, `max ${max}`);
      assert.equal(messages[0].role, "user", `max ${max}`);
      assert.equal(messages.at(-1)?.role, "user", `max ${max}`);
      for (const message of messages) assert.ok(message.role === "user" || message.role === "assistant");
    }
  });
});

describe("getKnowledgeVersion", () => {
  it("returns the tenant's knowledge base version", () => {
    assert.equal(getKnowledgeVersion(tenant), tenant.knowledge().version);
  });
});
