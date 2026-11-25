// The demo businesses as the sales page lists them: id, trade name in the page's language, and the
// example conversations it will play.
//
// SERVER-SIDE: the demo tenants carry knowledge, rules and placeholder numbers that never reach the
// browser. The client chooser gets only ids, labels and the stages VoiceMount renders on the server.
import "server-only";
import type { Locale } from "@/lib/i18n";
import { DEMO_SCRIPTS, DEMO_SECTOR_LABELS, DEMO_TENANTS } from "@/lib/voice/demos";
import { examplesForPage, type PageExamples } from "@/lib/voice/landing";

export interface DemoEntry {
  /** The tenant id; also the anchor of the business in the chooser (#demo-sanitaer). */
  id: string;
  /** The trade, in the page's language ("Sanitär und Heizung"). */
  label: string;
  examples: PageExamples;
}

/**
 * Shown first: the plumber, the first of the problem section's situations ("under the sink").
 * Every site language has an example for it.
 */
export const DEFAULT_DEMO_ID = "demo-sanitaer";

/** Every demo business that has an example to play, in the order of DEMO_TENANTS. */
export function demoEntries(locale: Locale): DemoEntry[] {
  return DEMO_TENANTS.flatMap((tenant) => {
    const examples = examplesForPage(DEMO_SCRIPTS, tenant.id, locale);
    if (examples.scripts.length === 0) return [];
    const labels = DEMO_SECTOR_LABELS[tenant.business.sector];
    const label = labels?.[locale] ?? labels?.de ?? tenant.business.name;
    return [{ id: tenant.id, label, examples }];
  });
}
