// Knowledge rendering (lib/assistant/server/knowledge.ts) with a small fake knowledge base:
// region variants, locale fallbacks, empty sections and maintainer notes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderKnowledge } from "@/lib/assistant/server/knowledge";
import type { KnowledgeBase } from "@/lib/assistant/types";

const KB: KnowledgeBase = {
  version: "test-1",
  sections: [
    {
      id: "pricing",
      title: { en: "Prices", de: "Preise", it: "Prezzi" },
      content: { en: "Default EN prices", de: "Standardpreise DE", it: "Prezzi predefiniti IT" },
      byRegion: {
        ch: { en: "CHF EN prices", de: "CHF DE Preise", it: "Prezzi CHF IT" },
        it: { en: "EUR EN prices", de: "EUR DE Preise", it: "Prezzi EUR IT" },
      },
      source: "MAINTAINER-NOTE-components/home.tsx:42",
    },
    { id: "empty", title: { en: "Empty section" }, content: {} },
    { id: "partial", title: { de: "Nur Deutsch", it: "Solo italiano" }, content: { de: "Inhalt DE", it: "Contenuto IT" } },
    { id: "contact", title: { en: "Contact" }, content: { en: "Write to [us](mailto:hello@fixture.example)." } },
  ],
};

describe("renderKnowledge", () => {
  it("renders each section as `## <title>` followed by its content", () => {
    const text = renderKnowledge(KB, "en", "ch", "en");
    assert.ok(text.includes("## Prices\nCHF EN prices\n"), text);
    assert.ok(text.includes("## Contact\nWrite to [us](mailto:hello@fixture.example)."), text);
  });

  it("uses the region's variant in the requested locale", () => {
    assert.ok(renderKnowledge(KB, "it", "ch", "en").includes("## Prezzi\nPrezzi CHF IT"));
    assert.ok(renderKnowledge(KB, "de", "it", "en").includes("## Preise\nEUR DE Preise"));
  });

  it("never mixes in another region's prices", () => {
    const ch = renderKnowledge(KB, "en", "ch", "en");
    assert.ok(!ch.includes("EUR"), ch);
    const it = renderKnowledge(KB, "en", "it", "en");
    assert.ok(!it.includes("CHF"), it);
  });

  it("uses the default content for a region without a variant", () => {
    const text = renderKnowledge(KB, "it", "de-region", "en");
    assert.ok(text.includes("## Prezzi\nPrezzi predefiniti IT"), text);
  });

  it("falls back to the given fallback locale before the global en → de → it chain", () => {
    // The "partial" section has no English: the fallback (it) must win over the chain (which would pick de).
    const text = renderKnowledge(KB, "en", "ch", "it");
    assert.ok(text.includes("## Solo italiano\nContenuto IT"), text);
    assert.ok(!text.includes("Inhalt DE"), text);
  });

  it("skips sections without content in any locale", () => {
    assert.ok(!renderKnowledge(KB, "en", "ch", "en").includes("Empty section"));
  });

  it("keeps the knowledge base's section order", () => {
    const text = renderKnowledge(KB, "en", "ch", "en");
    assert.ok(text.indexOf("## Prices") < text.indexOf("## Contact"));
  });

  it("never renders maintainer notes (`source`)", () => {
    for (const region of ["ch", "it", "xx"]) {
      assert.ok(!renderKnowledge(KB, "en", region, "en").includes("MAINTAINER-NOTE"), region);
    }
  });

  it("is deterministic (the output feeds a cached prompt prefix)", () => {
    assert.equal(renderKnowledge(KB, "de", "ch", "en"), renderKnowledge(KB, "de", "ch", "en"));
  });
});
