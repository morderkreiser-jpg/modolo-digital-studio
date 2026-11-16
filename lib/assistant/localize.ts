// Localization helpers shared by client and server. Pure module.
import type { AssistantLocale, LocalizedText } from "./types";

/** Fallback chain when a text is missing in the requested locale. */
const FALLBACK_ORDER: AssistantLocale[] = ["en", "de", "it"];

/**
 * Pick the best string for `locale`: exact match, then `fallback` (usually the tenant's default
 * locale), then en → de → it, then "". Never throws.
 */
export function pickText(
  text: LocalizedText | undefined,
  locale: AssistantLocale,
  fallback?: AssistantLocale,
): string {
  if (!text) return "";
  if (text[locale]) return text[locale] as string;
  if (fallback && text[fallback]) return text[fallback] as string;
  for (const l of FALLBACK_ORDER) if (text[l]) return text[l] as string;
  return "";
}

/** Replace {name} placeholders. Unknown placeholders are left untouched. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  // Own keys only: "{constructor}" must not resolve to Object.prototype.constructor.
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/** Native language names, used by the language switcher and in the prompt. */
export const LOCALE_NAMES: Record<AssistantLocale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  de: { native: "Deutsch", english: "German" },
  it: { native: "Italiano", english: "Italian" },
};
