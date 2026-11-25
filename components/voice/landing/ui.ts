// The few labels of the voice sales page that are not sales copy: navigation, status labels,
// list headings and screen-reader hints. The sales copy itself lives in content/voice/landing.ts
// and is used exactly as written there.
//
// Plain strings (safe for server and client). German in Swiss spelling ("ss"), "du" like the copy;
// Italian "tu". Only the three site languages: the French page is not routed (D9).
import type { Locale } from "@/lib/i18n";

export interface LandingUi {
  /** The back link above the hero, as on the pricing page. */
  back: string;
  /** Screen-reader prefix of a status label ("Status: Geplant"). */
  statusPrefix: string;
  status: { pilot: string; planned: string };
  /** Headings of the two lists in the pilot section. */
  youGet: string;
  iAsk: string;
  /** Next to the stage when the example is not in the page's language (always German then). */
  germanOnly: string;
  /** Screen-reader text after a business whose example is in German. */
  inGerman: string;
  /** Screen-reader text after a trade in the sector list: the link leads to its example. */
  exampleCall: string;
  /** Link to the contact form on the homepage. */
  contactForm: string;
}

export const LANDING_UI: Record<Locale, LandingUi> = {
  de: {
    back: "Zurück zur Startseite",
    statusPrefix: "Status:",
    status: { pilot: "Pilotphase", planned: "Geplant" },
    youGet: "Das bekommst du",
    iAsk: "Darum bitte ich dich",
    germanOnly: "Dieses Beispiel gibt es nur auf Deutsch.",
    inGerman: "auf Deutsch",
    exampleCall: "Beispielgespräch",
    contactForm: "Zum Kontaktformular",
  },
  it: {
    back: "Torna alla home",
    statusPrefix: "Stato:",
    status: { pilot: "Fase pilota", planned: "In programma" },
    youGet: "Cosa ricevi",
    iAsk: "Cosa ti chiedo",
    germanOnly: "Questo esempio c'è solo in tedesco.",
    inGerman: "in tedesco",
    exampleCall: "chiamata di esempio",
    contactForm: "Vai al modulo di contatto",
  },
  en: {
    back: "Back to home",
    statusPrefix: "Status:",
    status: { pilot: "Pilot phase", planned: "Planned" },
    youGet: "What you get",
    iAsk: "What I ask of you",
    germanOnly: "This example is only available in German.",
    inGerman: "in German",
    exampleCall: "example call",
    contactForm: "Go to the contact form",
  },
};

const NB = " ";

/**
 * The copy with no-break spaces where a line break would split a unit from its number
 * ("25 Sekunden", "24 ore", "CHF 149"). Only spaces change; the words stay exactly as written.
 */
export function keepTogether(text: string): string {
  return text
    .replace(/\bCHF (?=\d)/g, `CHF${NB}`)
    .replace(
      /(\d) (Sekunden|Minuten|Stunden|secondi|minuti|ore|seconds|minutes|hours|Monat|mese|month)\b/g,
      `$1${NB}$2`,
    );
}
