// Renders a tenant's knowledge base as the plain text block of the system prompt, for ONE
// locale and ONE region. Pure and deterministic: the output is part of the cached prompt prefix,
// so equal inputs must always give byte-identical text.
import type { AssistantLocale, KnowledgeBase, LocalizedText } from "@/lib/assistant/types";
import { pickText } from "@/lib/assistant/localize";

function regionalText(byRegion: Record<string, LocalizedText> | undefined, region: string): LocalizedText | undefined {
  return byRegion && Object.hasOwn(byRegion, region) ? byRegion[region] : undefined;
}

/**
 * "## <title>\n<content>\n\n" per section. Content: the region's variant in the requested locale,
 * else the default content (with pickText fallbacks), else the region's variant in a fallback
 * locale (a section that only exists per region must not vanish). Empty sections are skipped.
 */
export function renderKnowledge(
  kb: KnowledgeBase,
  locale: AssistantLocale,
  region: string,
  fallbackLocale: AssistantLocale,
): string {
  let out = "";
  for (const section of kb.sections) {
    const regional = regionalText(section.byRegion, region);
    const content = (
      regional?.[locale] ||
      pickText(section.content, locale, fallbackLocale) ||
      pickText(regional, locale, fallbackLocale)
    ).trim();
    if (!content) continue;
    const title = pickText(section.title, locale, fallbackLocale).trim() || section.id;
    out += `## ${title}\n${content}\n\n`;
  }
  return out;
}
