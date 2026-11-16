// Homepage copy: section 04 · Stimmen (en/de/it). Strings verbatim from COPY.md §9.
// The review texts, names, stars and provenance labels are NOT here: they come unchanged from
// data/reviews.ts through components/testimonials.tsx. Nothing in a review is ever edited.
import type { Locale } from "@/lib/i18n";
import { GOOGLE_RATING as G } from "./promises";

// «Stand 14.11.2026» is written from GOOGLE_RATING.verifiedOn, so the date can never drift from
// the numbers it belongs to (COPY §9: re-verify and update verifiedOn on the day `show` goes on).
const [Y, M, D] = G.verifiedOn.split("-").map(Number);
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dotted = `${String(D).padStart(2, "0")}.${String(M).padStart(2, "0")}.${Y}`;
const english = `${D} ${MONTH_EN[M - 1]} ${Y}`;

export type ReviewsCopy = {
  kicker: string;
  h2: readonly [string, string];
  /** Link label while GOOGLE_RATING.show === false (default). */
  link: string;
  /** Link label once GOOGLE_RATING.show === true. */
  ratingLine: string;
  /** Accessible name of the swipe row on phones (it is a focusable scroll region there). */
  rowLabel: string;
};

export const REVIEWS_SECTION: Record<Locale, ReviewsCopy> = {
  de: {
    kicker: "04 · Stimmen",
    h2: ["Was andere schreiben.", "Nachzulesen auf Google."],
    link: "Alle Bewertungen auf Google lesen",
    ratingLine: `Google-Profil: ${G.value} ★ aus ${G.count} Bewertungen (Stand ${dotted}). Alle lesen`,
    rowLabel: "Bewertungen",
  },
  it: {
    kicker: "04 · Recensioni",
    h2: ["Cosa scrivono di me.", "Le trovi su Google."],
    link: "Leggile tutte su Google",
    ratingLine: `Profilo Google: ${G.value} ★ su ${G.count} recensioni (aggiornato al ${dotted}). Leggile tutte`,
    rowLabel: "Recensioni",
  },
  en: {
    kicker: "04 · Reviews",
    h2: ["What people write.", "Read it all on Google."],
    link: "Read them all on Google",
    ratingLine: `Google profile: ${G.valueEn} ★ from ${G.count} reviews (as of ${english}). Read them all`,
    rowLabel: "Reviews",
  },
};

/**
 * Which three voices, in which order (SPEC §4.4). Andrea Gonaj stays on Google but not on the
 * homepage. /de opens with the Swiss German original; /it and / open with the Italian ones and
 * the dialect review comes last, labelled as a translation.
 */
export const REVIEWS_PICK: Record<Locale, { order: readonly string[]; exclude: readonly string[] }> = {
  de: { order: ["Alessio Fede", "Renald Cepele", "Daniel Jose"], exclude: ["Andrea Gonaj"] },
  it: { order: ["Renald Cepele", "Daniel Jose", "Alessio Fede"], exclude: ["Andrea Gonaj"] },
  en: { order: ["Renald Cepele", "Daniel Jose", "Alessio Fede"], exclude: ["Andrea Gonaj"] },
};
