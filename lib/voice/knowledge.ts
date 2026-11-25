// Knowledge of a voice tenant as the plain text block of the system prompt, for ONE locale, and
// the adapter that turns the text chat's knowledge base (lib/assistant) into voice knowledge.
//
// Pure and deterministic: the rendered text is part of the cached prompt prefix, so equal inputs
// must always give byte-identical output. No Node or Next APIs; the only import from the chat
// assistant is a type, so this module never pulls a tenant's data into a bundle by itself.
import type { KnowledgeBase } from "@/lib/assistant/types";
import {
  VOICE_LOCALES,
  type VoiceKnowledge,
  type VoiceKnowledgeSection,
  type VoiceLocale,
  type VoiceText,
} from "@/lib/voice/types";

/**
 * The best string of `text` for `locale`: the locale itself, then `fallback` (usually the tenant's
 * default locale), then any language in VOICE_LOCALES order, then "". Never throws.
 */
export function pickVoiceText(text: VoiceText | undefined, locale: VoiceLocale, fallback: VoiceLocale): string {
  if (!text || typeof text !== "object") return "";
  const own = (key: VoiceLocale): string => {
    const value = Object.hasOwn(text, key) ? text[key] : undefined;
    return typeof value === "string" ? value : "";
  };
  const exact = own(locale);
  if (exact) return exact;
  const second = own(fallback);
  if (second) return second;
  for (const candidate of VOICE_LOCALES) {
    const value = own(candidate);
    if (value) return value;
  }
  return "";
}

/**
 * "## <title>\n<content>" per section, sections separated by a blank line. A section without text
 * in any language is skipped; a missing title falls back to the section id. `source` is a
 * maintainer note and never rendered.
 */
export function renderVoiceKnowledge(kb: VoiceKnowledge, locale: VoiceLocale, fallback: VoiceLocale): string {
  const blocks: string[] = [];
  for (const section of kb?.sections ?? []) {
    const content = pickVoiceText(section.content, locale, fallback).trim();
    if (!content) continue;
    const title = pickVoiceText(section.title, locale, fallback).trim() || section.id;
    blocks.push(`## ${title}\n${content}`);
  }
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// Adapter from the chat assistant's knowledge base
// ---------------------------------------------------------------------------------------------

// The chat knowledge base exists in the site's languages only. French is deliberately absent from
// the adapted knowledge: inventing French copy here would mean writing facts by hand. A French
// caller gets the tenant's fallback language in the prompt, and the model states those same facts
// in French (the prompt tells it to answer in the caller's language).
const CHAT_LOCALES = ["en", "de", "it"] as const satisfies readonly VoiceLocale[];

// Markdown of the chat knowledge ("[label](url)", "**bold**"). The voice knowledge is plain text
// (VoiceKnowledgeSection): a link keeps only its label, because nobody can click a link on a call
// and a URL read aloud is noise. The chat writes email links as "[address](mailto:address)", so
// email addresses survive as their label; page links become page names ("Preise", "Datenschutz").
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const MARKDOWN_BOLD = /\*\*([^*\n]+)\*\*/g;

/** Chat markdown as plain text: links keep their label, bold markers go. Bullets stay. */
export function toPlainKnowledgeText(text: string): string {
  return text.replace(MARKDOWN_LINK, "$1").replace(MARKDOWN_BOLD, "$1");
}

/**
 * The chat assistant's knowledge base as voice knowledge for ONE price region: per language, the
 * region's variant (`byRegion[region]`) wins over the default content, exactly like the chat's
 * renderKnowledge; markdown becomes plain text; sections without text in any language are
 * dropped. Facts are neither added nor reworded. The version carries the region, so the voice
 * prompt cache follows the chat knowledge and never mixes two regions.
 */
export function fromAssistantKnowledge(kb: KnowledgeBase, region: string): VoiceKnowledge {
  const sections: VoiceKnowledgeSection[] = [];
  for (const section of kb.sections) {
    const regional = section.byRegion && Object.hasOwn(section.byRegion, region) ? section.byRegion[region] : undefined;
    const title: VoiceText = {};
    const content: VoiceText = {};
    for (const locale of CHAT_LOCALES) {
      const titleText = section.title[locale];
      if (titleText) title[locale] = toPlainKnowledgeText(titleText);
      const text = regional?.[locale] || section.content[locale];
      if (text) content[locale] = toPlainKnowledgeText(text);
    }
    if (Object.keys(content).length === 0) continue;
    const adapted: VoiceKnowledgeSection = { id: section.id, title, content };
    if (section.source) adapted.source = section.source;
    sections.push(adapted);
  }
  return { version: `${kb.version}@${region}`, sections };
}
