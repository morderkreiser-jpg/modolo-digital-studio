// Widget strings (lib/assistant/i18n.ts), checked structurally: the key names are the widget's own
// design, so these tests only use the contract: complete per locale, Swiss German spelling, an
// explicit AI disclosure, every error code covered, and working tenant overrides.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STRINGS, getStrings } from "@/lib/assistant/i18n";
import { ASSISTANT_LOCALES } from "@/lib/assistant/types";

const CHAT_ERROR_CODES = ["bad_request", "too_large", "forbidden", "rate_limited", "session_limit", "budget_exhausted", "unavailable", "upstream", "timeout", "refused"];
const LEAD_ERROR_CODES = ["invalid", "bad_request", "forbidden", "rate_limited", "unavailable", "delivery_failed"];
const FIELD_ERROR_CODES = ["required", "too_short", "too_long", "invalid_email", "invalid_phone", "invalid_option", "consent_required"];

/** Leaf paths ("a.b.c") → leaf value, for strings, numbers and functions alike. */
function leaves(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) leaves(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9.]/g, "");
const asRecord = (value: unknown) => value as Record<string, unknown>;

describe("DEFAULT_STRINGS", () => {
  it("has the same keys in every locale, with non-empty texts", () => {
    const reference = [...leaves(DEFAULT_STRINGS.en).keys()].sort();
    assert.ok(reference.length > 0);
    for (const locale of ASSISTANT_LOCALES) {
      const entries = leaves(DEFAULT_STRINGS[locale]);
      assert.deepEqual([...entries.keys()].sort(), reference, `keys of ${locale}`);
      for (const [path, value] of entries) {
        if (typeof value === "string") assert.ok(value.trim().length > 0, `${locale}.${path} is empty`);
      }
    }
  });

  it("writes Swiss German: no ß anywhere in the German strings", () => {
    for (const [path, value] of leaves(DEFAULT_STRINGS.de)) {
      if (typeof value === "string") assert.ok(!value.includes("ß"), `de.${path}: ${value}`);
    }
  });

  it("states in every language that the assistant is an AI", () => {
    for (const locale of ASSISTANT_LOCALES) {
      const texts = [...leaves(DEFAULT_STRINGS[locale]).values()].filter((value): value is string => typeof value === "string");
      assert.ok(texts.some((text) => /\b(AI|KI|IA)\b/.test(text)), `no AI disclosure in ${locale}`);
    }
  });

  it("has a string for every chat error, lead error and field error code", () => {
    const paths = [...leaves(DEFAULT_STRINGS.en).keys()].map(normalize);
    for (const code of new Set([...CHAT_ERROR_CODES, ...LEAD_ERROR_CODES, ...FIELD_ERROR_CODES])) {
      const wanted = normalize(code);
      assert.ok(paths.some((path) => path.includes(wanted)), `no string key for "${code}"`);
    }
  });

  it("words the quote-form checkbox as an acknowledgement of the privacy policy, linked inside the sentence", () => {
    // The canonical wording shared with the privacy policy: "I have read the {privacy}…", not "I agree…".
    const opening: Record<string, string> = {
      en: "I have read the {privacy}.",
      de: "Ich habe die {privacy} gelesen.",
      it: "Ho letto l'{privacy}.",
    };
    for (const locale of ASSISTANT_LOCALES) {
      const { consent, privacyLink } = DEFAULT_STRINGS[locale].form;
      assert.ok(consent.startsWith(opening[locale]), `${locale}: ${consent}`);
      assert.equal(consent.split("{privacy}").length, 2, `${locale}: exactly one {privacy} slot`);
      assert.equal(consent.split("{days}").length, 2, `${locale}: exactly one {days} slot`);
      assert.ok(!/\b(agree|einverstanden|accetto)\b/i.test(consent), `${locale}: worded as consent`);
      assert.ok(privacyLink.trim() && !/[{}]/.test(privacyLink), `${locale}: link text`);
    }
  });
});

describe("getStrings", () => {
  it("returns the defaults of the requested locale", () => {
    for (const locale of ASSISTANT_LOCALES) assert.deepEqual(getStrings(locale), DEFAULT_STRINGS[locale]);
  });

  it("applies tenant overrides on top of the defaults without touching them", () => {
    const entries = Object.entries(DEFAULT_STRINGS.it).filter(([, value]) => typeof value === "string");
    assert.ok(entries.length > 0, "expected at least one top-level string to override");
    const [key, original] = entries[0];
    const defaults = asRecord(DEFAULT_STRINGS.it);
    // The contract leaves the overrides shape open: the tenant's per-locale `strings` map
    // (TenantConfig["strings"]) or a flat partial for one locale. Either is accepted.
    const custom = "Testo personalizzato";
    const shapes: unknown[] = [{ it: { [key]: custom } }, { [key]: custom }];
    const overridden = shapes
      .map((overrides) => asRecord(getStrings("it", overrides as Parameters<typeof getStrings>[1])))
      .find((strings) => strings[key] === custom);
    assert.ok(overridden, `an override of "${key}" was not applied in either shape`);
    assert.equal(defaults[key], original, "defaults must not be mutated");
    for (const other of Object.keys(overridden).filter((name) => name !== key)) {
      assert.deepEqual(overridden[other], defaults[other], other);
    }
    const german = asRecord(getStrings("de", shapes[0] as Parameters<typeof getStrings>[1]));
    assert.equal(german[key], asRecord(DEFAULT_STRINGS.de)[key], "Italian overrides must not leak into German");
  });
});
