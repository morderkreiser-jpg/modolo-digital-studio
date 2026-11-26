// Texts of the voice stage that depend on its language rule (review finding N3), kept pure so the
// rule is tested without React: the stage speaks the page's language (uiLocale) in every control,
// status and notice, whatever language the conversation or the example is in.
import { formatVoiceString, getVoiceStrings } from "@/lib/voice/i18n";
import type { VoiceLocale, VoicePublicConfig } from "@/lib/voice/types";

function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/**
 * The stage's title in the page's language: the business's own name for its assistant when it has
 * one in that language, else the plain description ("L'assistente AI di Hotel Beispielhof" for a
 * German-only business on the Italian page). Never a title in another language than the page's.
 */
export function stageTitle(config: Pick<VoicePublicConfig, "assistantName" | "businessName">, uiLocale: VoiceLocale): string {
  const own = config.assistantName[uiLocale];
  return own ? capitalize(own) : formatVoiceString(getVoiceStrings(uiLocale).assistantFallback, { business: config.businessName });
}
