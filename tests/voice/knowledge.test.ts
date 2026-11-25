// Voice knowledge (lib/voice/knowledge.ts): text picking, rendering for the prompt, the adapter
// from the chat assistant's knowledge base, and the Modolo voice knowledge built from it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildModoloKnowledge } from "@/lib/assistant/tenants/modolo/knowledge";
import type { KnowledgeBase } from "@/lib/assistant/types";
import { fromAssistantKnowledge, pickVoiceText, renderVoiceKnowledge, toPlainKnowledgeText } from "@/lib/voice/knowledge";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { VOICE_LOCALES } from "@/lib/voice/types";
import type { VoiceKnowledge } from "@/lib/voice/types";

describe("pickVoiceText", () => {
  it("prefers the locale, then the fallback, then any language in VOICE_LOCALES order", () => {
    const text = { de: "Hallo", it: "Ciao", en: "Hello" };
    assert.equal(pickVoiceText(text, "it", "de"), "Ciao");
    assert.equal(pickVoiceText(text, "fr", "en"), "Hello");
    assert.equal(pickVoiceText({ it: "Ciao", en: "Hello" }, "fr", "de"), "Ciao", "first of de, it, en, fr");
    assert.equal(pickVoiceText({ fr: "Bonjour" }, "de", "it"), "Bonjour");
  });

  it("skips empty strings and non-strings and returns an empty string when nothing fits", () => {
    assert.equal(pickVoiceText({ de: "", en: "Hello" }, "de", "de"), "Hello");
    assert.equal(pickVoiceText({ de: 42 } as never, "de", "de"), "");
    assert.equal(pickVoiceText(undefined, "de", "en"), "");
    assert.equal(pickVoiceText({}, "de", "en"), "");
  });

  it("never reads inherited properties", () => {
    const text = Object.create({ de: "inherited" }) as Record<string, string>;
    assert.equal(pickVoiceText(text, "de", "de"), "");
  });
});

describe("renderVoiceKnowledge", () => {
  const kb: VoiceKnowledge = {
    version: "t-1",
    sections: [
      { id: "prices", title: { de: "Preise", en: "Prices" }, content: { de: "Haarschnitt 50 Franken.", en: "Haircut 50 francs." }, source: "maintainer-note" },
      { id: "empty", title: { de: "Leer" }, content: { de: "   " } },
      { id: "untitled", title: {}, content: { en: "Only English." } },
    ],
  };

  it("renders '## Title' and the content per section, separated by a blank line", () => {
    assert.equal(renderVoiceKnowledge(kb, "de", "de"), "## Preise\nHaarschnitt 50 Franken.\n\n## untitled\nOnly English.");
  });

  it("skips empty sections, falls back per section and never renders the source note", () => {
    const text = renderVoiceKnowledge(kb, "fr", "en");
    assert.ok(text.startsWith("## Prices\nHaircut 50 francs."));
    assert.ok(!text.includes("Leer"));
    assert.ok(!text.includes("maintainer-note"));
  });

  it("is deterministic", () => {
    assert.equal(renderVoiceKnowledge(kb, "it", "de"), renderVoiceKnowledge(kb, "it", "de"));
  });
});

describe("fromAssistantKnowledge", () => {
  const chat: KnowledgeBase = {
    version: "chat-7",
    sections: [
      {
        id: "pricing",
        title: { en: "**Prices**", de: "Preise", it: "Prezzi" },
        content: { en: "Default prices.", de: "Standardpreise.", it: "Prezzi standard." },
        byRegion: {
          ch: { en: "- **Site**: CHF 1200.", de: "- **Website**: CHF 1200." },
          it: { en: "- Site: EUR 900.", de: "- Website: EUR 900.", it: "- Sito: EUR 900." },
        },
        source: "lib/pricing.ts",
      },
      {
        id: "contact",
        title: { en: "Contact", de: "Kontakt", it: "Contatti" },
        content: {
          en: "Email: [info@example.ch](mailto:info@example.ch), [WhatsApp](https://wa.me/41000000000), [contact form](/#contatti)",
        },
      },
      { id: "only-other-region", title: { en: "X" }, content: {}, byRegion: { it: { en: "Italian only." } } },
    ],
  };
  const voice = fromAssistantKnowledge(chat, "ch");

  it("takes the region's variant per language and the default content where the region has none", () => {
    const pricing = voice.sections.find((section) => section.id === "pricing");
    assert.ok(pricing);
    assert.equal(pricing.content.en, "- Site: CHF 1200.");
    assert.equal(pricing.content.de, "- Website: CHF 1200.");
    assert.equal(pricing.content.it, "Prezzi standard.");
    assert.ok(!JSON.stringify(voice).includes("EUR 900"), "another region's prices");
  });

  it("turns markdown into plain text: links keep their label, bold markers go", () => {
    const contact = voice.sections.find((section) => section.id === "contact");
    assert.equal(contact?.content.en, "Email: info@example.ch, WhatsApp, contact form");
    assert.equal(voice.sections[0].title.en, "Prices");
    assert.equal(toPlainKnowledgeText("**a** [b](https://c.d/e) - f"), "a b - f");
  });

  it("leaves French absent, keeps ids, order and sources, and drops sections without text", () => {
    assert.deepEqual(
      voice.sections.map((section) => section.id),
      ["pricing", "contact"],
    );
    for (const section of voice.sections) assert.equal(section.content.fr, undefined);
    assert.equal(voice.sections[0].source, "lib/pricing.ts");
  });

  it("carries the chat version and the region in its version", () => {
    assert.equal(voice.version, "chat-7@ch");
    assert.notEqual(fromAssistantKnowledge(chat, "it").version, voice.version);
  });
});

describe("Modolo voice knowledge", () => {
  const chat = buildModoloKnowledge();
  const kb = MODOLO_VOICE_TENANT.knowledge();
  const texts = kb.sections.flatMap((section) => [...Object.values(section.content), ...Object.values(section.title)]);

  it("is the chat knowledge for the Swiss price list, without the chat-only section, plus the voice section", () => {
    const expected = [...chat.sections.map((section) => section.id).filter((id) => id !== "chat"), "about_this_voice_assistant"];
    assert.deepEqual(
      kb.sections.map((section) => section.id),
      expected,
    );
    const adapted = fromAssistantKnowledge(chat, "ch");
    for (const section of adapted.sections.filter((s) => s.id !== "chat")) {
      const voice = kb.sections.find((s) => s.id === section.id);
      assert.deepEqual(voice?.content, section.content, `section "${section.id}" is taken over unchanged`);
    }
  });

  it("is plain text: no markdown links, bold markers or URLs", () => {
    for (const text of texts) {
      assert.ok(typeof text === "string");
      assert.ok(!text.includes("]("), text.slice(0, 80));
      assert.ok(!text.includes("**"), text.slice(0, 80));
      assert.ok(!/https?:\/\/|mailto:|wa\.me/.test(text), text.slice(0, 80));
    }
    assert.ok(texts.some((text) => text?.includes("info@modolodigitalstudio.ch")), "the email address survives as text");
  });

  it("never carries the text chat's processing facts", () => {
    for (const text of texts) assert.ok(!/Anthropic|Resend|session storage|Sitzungsspeicher/i.test(text ?? ""));
  });

  it("states only what the prototype does about itself, in all four languages", () => {
    const section = kb.sections.find((s) => s.id === "about_this_voice_assistant");
    assert.ok(section);
    for (const locale of VOICE_LOCALES) {
      const content = section.content[locale];
      assert.ok(content && section.title[locale], `voice section in ${locale}`);
      assert.ok(!/Anthropic|OpenAI|Google|Resend|Ireland|Irland|Irlanda|Irlande|USA|United States|\d/.test(content), content);
      assert.ok(!content.includes("ß"));
    }
    assert.match(section.content.en ?? "", /AI voice assistant/);
    assert.match(section.content.en ?? "", /does not record the audio/);
  });

  it("is built once and versioned after the chat knowledge", () => {
    assert.equal(MODOLO_VOICE_TENANT.knowledge(), kb);
    assert.ok(kb.version.startsWith(`${chat.version}@ch+voice-`), kb.version);
  });
});
