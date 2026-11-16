// Localization helpers (lib/assistant/localize.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCALE_NAMES, interpolate, pickText } from "@/lib/assistant/localize";
import { ASSISTANT_LOCALES } from "@/lib/assistant/types";

describe("pickText", () => {
  const full = { en: "Hello", de: "Hallo", it: "Ciao" };

  it("returns the exact locale when present", () => {
    assert.equal(pickText(full, "it"), "Ciao");
    assert.equal(pickText(full, "de", "en"), "Hallo");
  });

  it("uses the explicit fallback locale before the global chain", () => {
    // Without the fallback the chain en → de → it would pick German.
    assert.equal(pickText({ de: "Hallo", it: "Ciao" }, "en", "it"), "Ciao");
  });

  it("falls back en → de → it when neither the locale nor the fallback exist", () => {
    assert.equal(pickText({ de: "Hallo", it: "Ciao" }, "en"), "Hallo");
    assert.equal(pickText({ it: "Ciao" }, "de", "en"), "Ciao");
    assert.equal(pickText({ en: "Hello", it: "Ciao" }, "de"), "Hello");
  });

  it("treats empty strings as missing", () => {
    assert.equal(pickText({ it: "", en: "Hello" }, "it"), "Hello");
  });

  it("returns an empty string for undefined or empty texts, never throwing", () => {
    assert.equal(pickText(undefined, "en"), "");
    assert.equal(pickText({}, "it", "de"), "");
  });
});

describe("interpolate", () => {
  it("replaces every placeholder, including repeated ones and numbers", () => {
    assert.equal(
      interpolate("{name}, ti risponde {owner} entro {days} giorni, {name}.", { name: "Anna", owner: "Francesco", days: 2 }),
      "Anna, ti risponde Francesco entro 2 giorni, Anna.",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    assert.equal(interpolate("Ciao {name} {missing}", { name: "Anna" }), "Ciao Anna {missing}");
  });

  it("leaves placeholders named like Object.prototype members untouched", () => {
    // A `key in values` check would resolve these to inherited functions.
    assert.equal(interpolate("{constructor} {toString}", {}), "{constructor} {toString}");
  });

  it("inserts values literally (no `$&`-style replacement patterns, no recursion)", () => {
    assert.equal(interpolate("Hi {name}", { name: "$& $1 {name}" }), "Hi $& $1 {name}");
  });
});

describe("LOCALE_NAMES", () => {
  it("names every supported locale natively and in English", () => {
    for (const locale of ASSISTANT_LOCALES) {
      assert.ok(LOCALE_NAMES[locale].native.length > 0, locale);
      assert.ok(LOCALE_NAMES[locale].english.length > 0, locale);
    }
    assert.equal(LOCALE_NAMES.it.english, "Italian");
    assert.equal(LOCALE_NAMES.de.native, "Deutsch");
  });
});
