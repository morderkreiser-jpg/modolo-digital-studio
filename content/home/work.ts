// Homepage copy: section 01 · Arbeiten (en/de/it). Strings verbatim from COPY.md §6 (+ §17 alt texts).
// Facts (urls, flags, screenshots) live in data/projects.ts; this file only holds words.
// German UI terms quoted inside IT/EN strings («Termin buchen») are wrapped in <span lang="de">
// by components/home/work.tsx, so keep them spelled exactly like this.
import type { Locale } from "@/lib/i18n";

export type WorkCopy = {
  kicker: string;
  h2: readonly [string, string];
  /** Exactly one rendered client project (BJ Studio). */
  leadOneClient: string;
  /** Two or more rendered client projects. */
  leadManyClients: string;
  newTabSrOnly: string;
  projects: {
    bjstudio: {
      label: string;
      h3: string;
      bullets: readonly string[];
      pill: string;
      phoneCaption: string;
      alt: string;
    };
    zumove: { label: string; facts: readonly string[]; pill: string; pendingBadge: string };
    zurikey: { label: string; text: string; pill: string };
  };
  /** WhatsApp text link, tag «Arbeiten»; the arrow is aria-hidden. */
  cta: string;
};

export const WORK: Record<Locale, WorkCopy> = {
  de: {
    kicker: "01 · Arbeiten",
    h2: ["Nicht glauben.", "Nachschauen."],
    leadOneClient: "Diese Website habe ich für ein Kosmetikstudio in Zürich gebaut. Sie ist online, unter ihrer eigenen Adresse. Schau sie dir selbst an, am besten auf dem Handy.",
    leadManyClients: "Diese Websites habe ich für Betriebe aus der Region gebaut, ZüriKey ist mein eigenes Projekt. Sie sind online, unter ihren eigenen Adressen. Schau sie dir selbst an, am besten auf dem Handy.",
    newTabSrOnly: "(öffnet in neuem Tab)",
    projects: {
      bjstudio: {
        label: "Kundin · Kosmetikstudio · Zürich-Schwamendingen",
        h3: "BJ Studio de Belleza",
        bullets: [
          "Website mit Behandlungen und Preisen",
          "«Termin buchen» öffnet direkt WhatsApp",
          "Lokales SEO, damit man das Studio in Zürich findet",
        ],
        pill: "bjstudiodebelleza.ch",
        phoneCaption: "bjstudiodebelleza.ch auf dem Handy · Stand November 2026",
        alt: "Startseite von bjstudiodebelleza.ch auf einem Handy: «Wimpernverlängerung & Beauty in Zürich Schwamendingen» mit dem Knopf «Termin buchen»",
      },
      zumove: {
        label: "Kunde · Umzugsfirma · Uster",
        facts: ["Website mit Film auf der Startseite", "Offerte anfragen oder Fotos per WhatsApp schicken", "Online seit September 2026"],
        pill: "zumove.ch",
        pendingBadge: "Nur Vorschau: Marcos OK fehlt noch",
      },
      zurikey: {
        label: "Eigenes Projekt · Web-App · Zürich",
        text: "ZüriKey hilft bei der Wohnungssuche in Zürich: Mietdossier und Bewerbungsschreiben auf Deutsch, fertig als PDF. Gebaut und betrieben von mir, kein Kundenauftrag.",
        pill: "zurikey.ch",
      },
    },
    cta: "So eine Website anfragen",
  },
  it: {
    kicker: "01 · Lavori",
    h2: ["Non serve credermi.", "Basta guardare."],
    leadOneClient: "Questo sito l'ho fatto per un centro estetico di Zurigo. È online, al suo indirizzo. Aprilo tu, meglio dal telefono.",
    leadManyClients: "Questi siti li ho fatti per attività della zona; ZüriKey invece è un mio progetto. Sono online, ai loro indirizzi. Aprili tu, meglio dal telefono.",
    newTabSrOnly: "(si apre in una nuova scheda)",
    projects: {
      bjstudio: {
        label: "Cliente · Centro estetico · Zurigo-Schwamendingen",
        h3: "BJ Studio de Belleza",
        bullets: [
          "Sito con trattamenti e prezzi",
          "«Termin buchen» (prenota) apre direttamente WhatsApp",
          "SEO locale, per farsi trovare a Zurigo",
        ],
        pill: "bjstudiodebelleza.ch",
        phoneCaption: "bjstudiodebelleza.ch sul telefono · novembre 2026",
        alt: "La home di bjstudiodebelleza.ch su un telefono: «Wimpernverlängerung & Beauty in Zürich Schwamendingen» con il pulsante «Termin buchen»",
      },
      zumove: {
        label: "Cliente · Ditta di traslochi · Uster",
        facts: ["Sito con un video a tutto schermo in apertura", "Preventivo online o foto via WhatsApp", "Online da settembre 2026"],
        pill: "zumove.ch",
        pendingBadge: "Solo anteprima: manca ancora l'ok di Marco",
      },
      zurikey: {
        label: "Progetto personale · Web app · Zurigo",
        text: "ZüriKey aiuta chi cerca casa a Zurigo: dossier d'affitto e lettera di presentazione in tedesco, pronti in PDF. L'ho costruita e la gestisco io, non è un lavoro per un cliente.",
        pill: "zurikey.ch",
      },
    },
    cta: "Chiedimi un sito così",
  },
  en: {
    kicker: "01 · Work",
    h2: ["No need to trust me.", "Look for yourself."],
    leadOneClient: "I built this website for a beauty studio in Zürich. It's live, at its own address. Have a look yourself, ideally on your phone.",
    leadManyClients: "I built these websites for local businesses; ZüriKey is my own project. They're live, at their own addresses. Have a look yourself, ideally on your phone.",
    newTabSrOnly: "(opens in a new tab)",
    projects: {
      bjstudio: {
        label: "Client · Beauty studio · Zürich-Schwamendingen",
        h3: "BJ Studio de Belleza",
        bullets: [
          "Website with treatments and prices",
          "“Termin buchen” (book) opens WhatsApp directly",
          "Local SEO, so people in Zürich find the studio",
        ],
        pill: "bjstudiodebelleza.ch",
        phoneCaption: "bjstudiodebelleza.ch on a phone · November 2026",
        alt: "The bjstudiodebelleza.ch home page on a phone: “Wimpernverlängerung & Beauty in Zürich Schwamendingen” with the “Termin buchen” button",
      },
      zumove: {
        label: "Client · Moving company · Uster",
        facts: ["Website with a full-screen film on the home page", "Request a quote or send photos on WhatsApp", "Live since September 2026"],
        pill: "zumove.ch",
        pendingBadge: "Preview only: waiting for Marco's OK",
      },
      zurikey: {
        label: "My own project · Web app · Zürich",
        text: "ZüriKey helps flat-hunters in Zürich: a rental dossier and a cover letter in German, ready as a PDF. Built and run by me, not a client job.",
        pill: "zurikey.ch",
      },
    },
    cta: "Ask about a site like this",
  },
};
