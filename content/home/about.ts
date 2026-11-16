// Homepage copy: Chi siamo (#chi-siamo, FROZEN section, BRIEF §4.1) (en/de/it).
// `cta` has its own key (same label as the hero's primary CTA) so the hero copy can change alone.
// `kicker` is the section number only (SPEC §4.5 / COPY §10: 03 → 05); about.tsx renders
// `{t.kicker} · {t.label}` once the integrator renumbers it. Nothing else here may change.
import type { Locale } from "@/lib/i18n";

export type AboutCopy = {
  kicker: string;
  label: string;
  heading1: string;
  headingAccent: string;
  p1: string;
  cta: string;
  founder: {
    eyebrow: string;
    name: string;
    role: string;
    portraitAlt: string;
    bio1: string;
  };
};

export const ABOUT: Record<Locale, AboutCopy> = {
  en: {
    kicker: "05",
    label: "Who's behind it",
    heading1: "Not an agency. ",
    headingAccent: "And not a one-man show.",
    p1: "Your point of contact is always me, Francesco: I take on just a few projects at a time and see each one through personally, from the first message to the day you go live. But I'm not a one-man show doing everything half-well — when a job needs it, I bring in trusted specialists, like a real photographer and videomaker for the shoots. So you get the upside of always talking to one person, without the risk of depending on one person.",
    cta: "Get a fixed-price offer",
    founder: {
      eyebrow: "The founder",
      name: "Francesco Modolo",
      role: "Web Designer & Developer",
      portraitAlt: "Francesco Modolo — Founder of Modolo Digital Studio",
      bio1: "For over four years I've been building websites for small businesses across Switzerland: the code, the design and the SEO I do myself; for photos and video a trusted professional works alongside me. I work on each one as if the site were mine, because it's my name that goes on it.",
    },
  },
  de: {
    kicker: "05",
    label: "Wer dahintersteckt",
    heading1: "Keine Agentur. ",
    headingAccent: "Und trotzdem nicht allein.",
    p1: "Deine feste Ansprechperson bin immer ich, Francesco: Ich nehme nur wenige Projekte auf einmal an und betreue jedes einzeln, vom ersten Schreiben bis zum Tag, an dem du online gehst. Aber ich bin kein Einzelkämpfer, der alles halb macht — wenn ein Projekt es braucht, hole ich vertraute Spezialisten dazu, etwa einen richtigen Fotografen und Videomaker für die Shootings. So hast du eine einzige Ansprechperson, ohne das Risiko, von einer einzigen Person abhängig zu sein.",
    cta: "Offerte zum Festpreis anfordern",
    founder: {
      eyebrow: "Der Gründer",
      name: "Francesco Modolo",
      role: "Webdesigner & Entwickler",
      portraitAlt: "Francesco Modolo — Gründer von Modolo Digital Studio",
      bio1: "Seit über vier Jahren baue ich Websites für kleine Betriebe in der ganzen Schweiz: Code, Design und SEO mache ich selbst; für Fotos und Videos unterstützt mich ein Profi, dem ich vertraue. Ich arbeite daran, als wäre es meine eigene Website, denn es ist mein Name, der draufsteht.",
    },
  },
  it: {
    kicker: "05",
    label: "Chi c'è dietro",
    heading1: "Non un'agenzia. ",
    headingAccent: "E nemmeno da solo.",
    p1: "Il tuo referente sono sempre io, Francesco: prendo pochi progetti alla volta e li seguo uno per uno, dal primo messaggio al giorno in cui vai online. Ma non sono un uomo-solo che fa tutto a metà — quando un lavoro lo richiede coinvolgo specialisti di fiducia, come un fotografo e videomaker veri per gli shooting. Così hai il bello di parlare sempre con una persona sola, senza il rischio di dipendere da una sola persona.",
    cta: "Chiedi un'offerta a prezzo fisso",
    founder: {
      eyebrow: "Il fondatore",
      name: "Francesco Modolo",
      role: "Web Designer & Sviluppatore",
      portraitAlt: "Francesco Modolo — Fondatore di Modolo Digital Studio",
      bio1: "Da oltre quattro anni costruisco siti per piccole attività in tutta la Svizzera: il codice, il design e la SEO li faccio io; per foto e video mi affianca un professionista di fiducia. Ci lavoro come se il sito fosse mio, perché è il mio nome quello che ci metto sopra.",
    },
  },
};
