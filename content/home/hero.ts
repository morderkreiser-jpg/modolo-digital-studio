import type { Locale } from "@/lib/i18n";
import type { ProjectId } from "@/data/projects";
import { REPLY_TEXT as R } from "./promises";
import type { Prices } from "./prices";

// Hero film copy, film v2 «Websites wie diese.» (SP\v2\a\COPY-HERO.md, verbatim). The H1 is approved by
// Francesco: do not edit it. The kicker is the first <span> inside the <h1> (SEO); h1[0] is cream, h1[1] gold.
// Strings that contain a price are functions of Prices; hero-film.tsx builds them for region "ch" only,
// so every visitor (region IT too) reads CHF. Every amount comes from lib/pricing.ts via buildPrices().
//
// The live credit under the H1 names the website on screen. The host («bjstudiodebelleza.ch») comes from
// FILM.projects (lib/film-media.ts, written by the film build from the published variant); this file holds
// only the label after it. A project the published film does not show is never named, even if it has a
// label here (zumove: only once its owner has said yes in writing).

export type RailKey = "essential" | "business" | "start" | "fixed";
export type RailCell = { key: RailKey; label: string; value: string };

export type HeroCopy = {
  kicker: string;
  h1: readonly [string, string];
  /** Badge before the host: «Online» / «Live». */
  creditLive: string;
  /** Label after the host, per project the film can show. */
  credit: Partial<Record<ProjectId, string>>;
  /** The credit link's accessible name: `${prefix} a (…) ${and} b (…).` (COPY §3). */
  creditSr: { prefix: string; and: string };
  /** sub[0] in both layouts, sub[1] (leading space) in Layout L only. */
  sub: readonly [string, string];
  /** Layout P only, one line. */
  priceLine1: (p: Prices) => string;
  /** Layout L 768–1023 px only. */
  priceLine2: string;
  cta: string;
  secondary: string;
  chipName: string;
  chipReply: string;
  /** Layout L rail, in this order; cells are styled by key, never by index. */
  rail: (p: Prices) => RailCell[];
  toggle: { playing: string; notPlaying: string };
  /** Not rendered (COPY §13). */
  alternates: {
    h1Line2: string;
    literal: readonly [string, string];
    /** Phone price line if Francesco answers «no» to SPEC Q2 (measure IT/EN before using). */
    priceLine1OnePage: (p: Prices) => string;
  };
};

export const HERO: Record<Locale, HeroCopy> = {
  de: {
    kicker: "Webdesign in Winterthur und Zürich",
    h1: ["Websites wie diese.", "Aus Winterthur."],
    creditLive: "Online",
    credit: {
      bjstudio: "Kosmetikstudio in Zürich · Kundin",
      zurikey: "meine eigene Web-App für die Wohnungssuche",
      zumove: "Umzugsfirma in Uster · Kunde",
    },
    creditSr: { prefix: "Im Film:", and: "und" },
    sub: [
      "Ich erstelle Websites und Google-Profile für Restaurants, Coiffeure und Läden.",
      " Du hast direkt mit mir zu tun, nicht mit einer Agentur.",
    ],
    priceLine1: (p) => `Website ab ${p.essential} · Google-Profil ab ${p.start}`,
    priceLine2: "Fixpreis, schriftlich vor dem Start",
    cta: "Per WhatsApp schreiben",
    secondary: "Gratis: Google-Check per Video", // → #gratis-check, arrow icon aria-hidden
    chipName: "Francesco Modolo, Winterthur",
    chipReply: `Ich antworte ${R.de.mid}`,
    rail: (p) => [
      { key: "essential", label: "Website, eine Seite", value: `ab ${p.essential}` },
      { key: "business", label: "Website, bis 6 Seiten", value: `ab ${p.business}` }, // hidden 1024–1279 px
      { key: "start", label: "Google-Profil", value: `ab ${p.start}` },
      { key: "fixed", label: "Fixpreis", value: "schriftlich vor dem Start" },
    ],
    toggle: { playing: "Film anhalten", notPlaying: "Film abspielen" },
    alternates: {
      h1Line2: "Gebaut in Winterthur.",
      literal: ["Websites und Google-Profile", "für Betriebe in Winterthur."],
      priceLine1OnePage: (p) => `Eine Seite ab ${p.essential} · Google-Profil ab ${p.start}`,
    },
  },
  it: {
    kicker: "Web design a Winterthur e Zurigo",
    h1: ["Siti come questi.", "Fatti a Winterthur."],
    creditLive: "Online",
    credit: {
      bjstudio: "centro estetico a Zurigo · cliente",
      zurikey: "la mia web app per chi cerca casa",
      zumove: "ditta di traslochi a Uster · cliente",
    },
    creditSr: { prefix: "Nel video:", and: "e" },
    sub: [
      // no-break spaces: without them the line split as «Si parla / italiano.»
      "Creo siti web e profili Google per pizzerie, ristoranti e negozi. Si parla italiano.",
      " Tratti solo con me, non con un'agenzia.",
    ],
    priceLine1: (p) => `Sito da ${p.essential} · Profilo Google da ${p.start}`,
    priceLine2: "Prezzo fisso, per iscritto prima di iniziare",
    cta: "Scrivimi su WhatsApp",
    secondary: "Video gratis: come ti vede Google",
    chipName: "Francesco Modolo, Winterthur",
    chipReply: `Ti rispondo io ${R.it.mid}`,
    rail: (p) => [
      { key: "essential", label: "Sito, una pagina", value: `da ${p.essential}` },
      { key: "business", label: "Sito, fino a 6 pagine", value: `da ${p.business}` },
      { key: "start", label: "Profilo Google", value: `da ${p.start}` },
      { key: "fixed", label: "Prezzo fisso", value: "per iscritto prima di iniziare" },
    ],
    toggle: { playing: "Pausa video", notPlaying: "Riproduci video" },
    alternates: {
      h1Line2: "Costruiti a Winterthur.",
      literal: ["Siti web e profili Google", "per attività a Winterthur."],
      priceLine1OnePage: (p) => `Una pagina da ${p.essential} · Profilo Google da ${p.start}`,
    },
  },
  en: {
    kicker: "Web design in Winterthur and Zürich",
    h1: ["Websites like these.", "Made in Winterthur."],
    creditLive: "Live",
    credit: {
      bjstudio: "beauty studio in Zürich · client",
      zurikey: "my own flat-hunting web app",
      zumove: "moving company in Uster · client",
    },
    creditSr: { prefix: "In the film:", and: "and" },
    sub: [
      "I build websites and set up Google profiles for restaurants, salons, shops and trades.",
      " You deal only with me, not with an agency.",
    ],
    priceLine1: (p) => `Site from ${p.essential} · Google profile from ${p.start}`,
    priceLine2: "Fixed price, in writing before we start",
    cta: "Message me on WhatsApp",
    secondary: "Free video: how you look on Google",
    chipName: "Francesco Modolo, Winterthur",
    chipReply: `I reply ${R.en.mid}`,
    rail: (p) => [
      { key: "essential", label: "Website, one page", value: `from ${p.essential}` },
      { key: "business", label: "Website, up to 6 pages", value: `from ${p.business}` },
      { key: "start", label: "Google profile", value: `from ${p.start}` },
      { key: "fixed", label: "Fixed price", value: "in writing before we start" },
    ],
    toggle: { playing: "Pause film", notPlaying: "Play film" },
    alternates: {
      h1Line2: "Built in Winterthur.",
      literal: ["Websites and Google profiles", "for businesses in Winterthur."],
      priceLine1OnePage: (p) => `One page from ${p.essential} · Google profile from ${p.start}`,
    },
  },
};
