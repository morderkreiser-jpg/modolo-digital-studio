// UI strings of the voice widget (lib/voice/i18n.ts): the four languages carry exactly the same
// keys and placeholders, nothing is empty, German is written the Swiss way, and the copy keeps
// the house rules (no exclamation marks, no emojis, always says it is an AI).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatVoiceString, getVoiceStrings, VOICE_LANGUAGE_NAMES } from "@/lib/voice/i18n";
import { VOICE_LOCALES, VOICE_TOOLS, type VoiceLocale } from "@/lib/voice/types";
import {
  VOICE_END_REASONS,
  VOICE_FAILURE_CODES,
  VOICE_NOTICE_CODES,
  VOICE_STATUSES,
} from "@/components/voice/voice-machine";

/** Every string of a table as [dotted path, value]. */
function flatten(value: unknown, path = ""): Array<[string, unknown]> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, inner]) => flatten(inner, path ? `${path}.${key}` : key));
  }
  return [[path, value]];
}

const tables = Object.fromEntries(VOICE_LOCALES.map((locale) => [locale, flatten(getVoiceStrings(locale))])) as Record<
  VoiceLocale,
  Array<[string, unknown]>
>;

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("voice strings", () => {
  it("have exactly the same keys in de, it, en and fr", () => {
    const reference = tables.de.map(([path]) => path).sort();
    assert.ok(reference.length > 50);
    for (const locale of VOICE_LOCALES) {
      assert.deepEqual(tables[locale].map(([path]) => path).sort(), reference, locale);
    }
  });

  it("have no empty values", () => {
    for (const locale of VOICE_LOCALES) {
      for (const [path, value] of tables[locale]) {
        assert.equal(typeof value, "string", `${locale}.${path}`);
        assert.ok((value as string).trim() !== "", `${locale}.${path} is empty`);
      }
    }
  });

  it("write German without the sharp s", () => {
    for (const [path, value] of tables.de) {
      assert.ok(!String(value).includes("ß"), `de.${path}: ${value}`);
    }
  });

  it("use the same placeholders in every language", () => {
    const reference = new Map(tables.en.map(([path, value]) => [path, placeholders(String(value))]));
    for (const locale of VOICE_LOCALES) {
      for (const [path, value] of tables[locale]) {
        assert.deepEqual(placeholders(String(value)), reference.get(path), `${locale}.${path}`);
      }
    }
  });

  it("cover every state, end reason, notice, failure and tool", () => {
    for (const locale of VOICE_LOCALES) {
      const strings = getVoiceStrings(locale);
      assert.deepEqual(Object.keys(strings.status).sort(), [...VOICE_STATUSES].sort(), locale);
      assert.deepEqual(Object.keys(strings.ended).sort(), [...VOICE_END_REASONS].sort(), locale);
      assert.deepEqual(Object.keys(strings.notices).sort(), [...VOICE_NOTICE_CODES].sort(), locale);
      assert.deepEqual(Object.keys(strings.errors).sort(), [...VOICE_FAILURE_CODES].sort(), locale);
      assert.deepEqual(Object.keys(strings.tools).sort(), [...VOICE_TOOLS].sort(), locale);
    }
  });

  it("keep the house style: no exclamation marks, no emojis", () => {
    for (const locale of VOICE_LOCALES) {
      for (const [path, value] of tables[locale]) {
        assert.ok(!String(value).includes("!"), `${locale}.${path}`);
        assert.ok(!/\p{Extended_Pictographic}/u.test(String(value)), `${locale}.${path}`);
      }
    }
  });

  it("say before the start that the visitor talks to an AI, and when the microphone comes on", () => {
    const ai: Record<VoiceLocale, RegExp> = {
      de: /\bKI\b/,
      it: /intelligenza artificiale|\bAI\b/,
      en: /\bAI\b/,
      fr: /intelligence artificielle|\bIA\b/,
    };
    for (const locale of VOICE_LOCALES) {
      const strings = getVoiceStrings(locale);
      assert.match(strings.introLive, ai[locale], locale);
      assert.ok(strings.introLive.includes("{start}"), `${locale}: names the start button`);
      assert.match(strings.consentText, /\{minutes\}/, locale);
      assert.ok(strings.fictional.includes("{business}"), `${locale}: demo businesses say they are invented`);
    }
  });

  it("label the example as one, without sound", () => {
    assert.equal(getVoiceStrings("de").modeScripted, "Beispielgespräch, ohne Ton");
    assert.equal(getVoiceStrings("de").modeLocal, "Testmodus mit der Stimme des Browsers");
  });

  it("name every language in itself", () => {
    assert.deepEqual(Object.keys(VOICE_LANGUAGE_NAMES).sort(), [...VOICE_LOCALES].sort());
    assert.equal(VOICE_LANGUAGE_NAMES.fr, "Français");
  });

  it("fall back to German for an unknown language", () => {
    assert.equal(getVoiceStrings("xx" as VoiceLocale), getVoiceStrings("de"));
  });
});

describe("formatVoiceString", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    assert.equal(formatVoiceString("Noch {time} für {name}", { time: "0:24" }), "Noch 0:24 für {name}");
    assert.equal(formatVoiceString("{seconds} s", { seconds: 0 }), "0 s");
  });
});
