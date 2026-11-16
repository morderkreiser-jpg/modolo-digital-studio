// Homepage copy: section 06 · FAQ header (en/de/it), COPY.md §11.1. The questions and answers are
// FAQS in lib/site-data.ts (shared with the FAQPage JSON-LD, so the page and the schema cannot drift).
import type { Locale } from "@/lib/i18n";

export type FaqSectionCopy = {
  kicker: string;
  h2: readonly [string, string];
};

export const FAQ_SECTION: Record<Locale, FaqSectionCopy> = {
  de: { kicker: "06 · Fragen", h2: ["Häufige Fragen.", "Kurze Antworten."] },
  it: { kicker: "06 · Domande", h2: ["Domande frequenti.", "Risposte brevi."] },
  en: { kicker: "06 · Questions", h2: ["Common questions.", "Short answers."] },
};
