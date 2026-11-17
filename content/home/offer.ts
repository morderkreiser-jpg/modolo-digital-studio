// Homepage copy: section 02 · Angebot & Preise (the price ladder), incl. rung 0 = the free Google
// check on video (components/home/gratis-check.tsx). Strings verbatim from COPY.md §7.
// Every amount comes from lib/pricing.ts through buildPrices() (content/home/prices.ts), so the
// homepage can never drift from /preise. «von Hand / a mano / hand-coded» only next to Signature.
import type { Locale } from "@/lib/i18n";
import { VIDEO_TEXT as V } from "./promises";
import type { Prices } from "./prices";

/**
 * Placeholder the server puts where the typed business name goes: Offer renders
 * PREFILL[lang].checkNamed(GRATIS_CHECK_TOKEN) and the client island swaps the token for the name.
 * The prefill builders are functions and cannot cross the server → client boundary; a template
 * string can. Lives here, not in the "use client" module, because a constant exported from a client
 * module reaches server code as a client reference, not as a string.
 */
export const GRATIS_CHECK_TOKEN = "{name}";

export type OfferRung = {
  step: string;
  h3: string;
  price: string;
  text: string;
  meta: string;
  second?: string; // rung 1 only: the on-site variant
  link: string; // WhatsApp, tag per rung (PREFILL.rungN)
};

export type GratisCheckCopy = {
  step: string; // stays «CHF 0» in region IT too (it is the free rung)
  h3: string;
  text: string;
  fieldLabel: string;
  placeholder: string;
  button: string;
  micro: string;
};

export type OfferCopy = {
  kicker: string;
  h2: readonly [string, string];
  lead: string;
  check: GratisCheckCopy;
  rungs: (p: Prices) => OfferRung[];
  footnote: (p: Prices) => string;
  allPrices: string; // → /de/preise · /it/prezzi · /pricing
  newTab: string; // sr-only after links that open a new tab (COPY §17)
  /** Phones only (integrator, mobile length): the disclosure that holds each rung's text. */
  more: string;
  /** Phones only: the disclosure that holds the footnote (extras and payment terms). */
  footnoteSummary: string;
};

export const OFFER: Record<Locale, OfferCopy> = {
  de: {
    kicker: "02 · Angebot & Preise",
    h2: ["Zuerst Google.", "Dann die Website."],
    lead: "Viele Kunden sehen zuerst deinen Google-Eintrag und erst danach deine Website. Darum fange ich oft dort an. Der Preis für die Arbeit ist fix, du bekommst ihn schriftlich vor dem Start. Für eine Website zahlst du danach nur noch Domain und Hosting, einmal im Jahr.",
    check: {
      step: "Schritt 0 · CHF 0",
      h3: "Gratis-Check per Video",
      text: `Schreib mir den Namen deines Betriebs. Ich suche ihn auf Google wie ein Kunde und nehme dabei meinen Bildschirm auf: was Google zeigt, was fehlt und die drei Dinge, die ich zuerst ändern würde. Das Video bekommst du ${V.de.long} per WhatsApp.`,
      fieldLabel: "Name und Ort deines Betriebs",
      placeholder: "z. B. Coiffeur Muster, Töss",
      button: "Video anfordern",
      micro: "Ein Video von mir, keine automatische Analyse. Kein Termin, kein Abo. WhatsApp öffnet sich mit dem fertigen Text, du kannst ihn vor dem Senden ändern.",
    },
    // The two websites are one step in two sizes (you pick one), so both cards say «Schritt 2».
    rungs: (p) => [
      {
        step: "Schritt 1", h3: "Google-Profil", price: p.start, // no "ab": Start is a fixed price (pricing.ts from:false)
        text: "Ich bringe deinen Google-Eintrag in Ordnung: richtige Öffnungszeiten, eine Beschreibung auf Deutsch und Italienisch, deine Leistungen und ein Kontakt-Knopf, der auf dem Handy funktioniert. Die Fotos schickst du mir.",
        meta: "An einem Nachmittag erledigt",
        second: `Vor Ort: ${p.onSite}. Ich komme vorbei, mache 8 bis 10 Fotos selbst und schreibe den Text.`,
        link: "Google-Profil anfragen",
      },
      {
        step: "Schritt 2 · eine Seite", h3: "Website mit einer Seite", price: `ab ${p.essential}`,
        text: "Alles, was ein neuer Kunde wissen muss, auf einer Seite: Angebot, Preise, Öffnungszeiten, Anfahrt und ein WhatsApp-Knopf. Eigenes Design, gebaut mit Framer.",
        meta: "Etwa 1 bis 2 Wochen, sobald Texte und Fotos da sind",
        link: "Eine Seite anfragen",
      },
      {
        step: "Schritt 2 · bis 6 Seiten", h3: "Website bis 6 Seiten", price: `ab ${p.business}`,
        text: "Für Betriebe mit mehr Angebot: eigene Seiten für Leistungen, Team und Galerie. News und Aktionen trägst du später selbst ein. Gebaut mit Framer.",
        meta: "Etwa 3 bis 4 Wochen",
        link: "Website bis 6 Seiten anfragen",
      },
    ],
    footnote: (p) =>
      `Ausserdem: Online-Terminbuchung einrichten, ${p.booking}; das Abo des Buchungstools zahlst du direkt beim Anbieter. Signature, von Hand programmiert (Next.js) und mehrsprachig: ab ${p.signature}. Betreuung ab ${p.care} im Monat, nie Pflicht. Zahlung: die Hälfte beim Start, die Hälfte bei der Lieferung.`,
    allPrices: "Alle Preise und Details",
    newTab: "(öffnet in neuem Tab)",
    more: "Was dazugehört",
    footnoteSummary: "Weitere Leistungen und Zahlung",
  },
  it: {
    kicker: "02 · Servizi e prezzi",
    h2: ["Prima Google.", "Poi il sito."],
    lead: "Molti clienti vedono prima la tua scheda Google e solo dopo il sito. Per questo spesso comincio da lì. Il prezzo del lavoro è fisso e lo hai per iscritto prima di iniziare. Per un sito, poi, paghi solo dominio e hosting, una volta all'anno.",
    check: {
      step: "Passo 0 · CHF 0",
      h3: "Controllo Google gratuito, in video",
      text: `Scrivimi il nome della tua attività. La cerco su Google come farebbe un cliente e registro lo schermo: cosa mostra Google, cosa manca e le tre cose che sistemerei per prime. Il video ti arriva su WhatsApp ${V.it.long}.`,
      fieldLabel: "Nome e località della tua attività",
      placeholder: "es. Pizzeria Rossi, Töss",
      button: "Richiedi il video",
      micro: "Un video fatto da me, non un'analisi automatica. Nessun appuntamento, nessun abbonamento. WhatsApp si apre con il testo già scritto: puoi cambiarlo prima di inviarlo.",
    },
    rungs: (p) => [
      {
        step: "Passo 1", h3: "Profilo Google", price: p.start,
        text: "Sistemo la tua scheda Google: orari giusti, descrizione in tedesco e in italiano, i tuoi servizi e un pulsante di contatto che funziona dal telefono. Le foto me le mandi tu.",
        meta: "Fatto in un pomeriggio",
        second: `Da te: ${p.onSite}. Vengo io, faccio 8–10 foto e scrivo il testo.`,
        link: "Chiedi il profilo Google",
      },
      {
        step: "Passo 2 · una pagina", h3: "Sito di una pagina", price: `da ${p.essential}`,
        text: "Tutto quello che un nuovo cliente deve sapere, in una pagina: cosa offri, prezzi, orari, come arrivare e un pulsante WhatsApp. Design su misura, realizzato con Framer.",
        meta: "Circa 1–2 settimane, da quando testi e foto sono pronti",
        link: "Chiedi il sito di una pagina",
      },
      {
        step: "Passo 2 · fino a 6 pagine", h3: "Sito fino a 6 pagine", price: `da ${p.business}`,
        text: "Per chi ha più cose da mostrare: pagine per servizi, team e galleria. Novità e promozioni le aggiorni tu. Realizzato con Framer.",
        meta: "Circa 3–4 settimane",
        link: "Chiedi il sito fino a 6 pagine",
      },
    ],
    footnote: (p) =>
      `Inoltre: prenotazione online configurata, ${p.booking}; l'abbonamento allo strumento lo paghi tu, direttamente al fornitore. Signature, programmato a mano (Next.js) e multilingue: da ${p.signature}. Assistenza da ${p.care} al mese, mai obbligatoria. Pagamento: metà all'inizio, metà alla consegna.`,
    allPrices: "Tutti i prezzi e i dettagli",
    newTab: "(si apre in una nuova scheda)",
    more: "Cosa comprende",
    footnoteSummary: "Altri servizi e come si paga",
  },
  en: {
    kicker: "02 · Services & prices",
    h2: ["Google first.", "Then the website."],
    lead: "Many customers see your Google listing first and your website only after that. That's why I often start there. The price for the work is fixed, and you get it in writing before I start. For a website, all you pay after that is domain and hosting, once a year.",
    check: {
      step: "Step 0 · CHF 0",
      h3: "Free Google check, on video",
      text: `Send me the name of your business. I search for it on Google the way a customer would and record my screen: what Google shows, what's missing and the three things I'd change first. You get the video on WhatsApp ${V.en.long}.`,
      fieldLabel: "Name and town of your business",
      placeholder: "e.g. Salon Muster, Töss",
      button: "Ask for the video",
      micro: "A video made by me, not an automated report. No appointment, no subscription. WhatsApp opens with the text ready; you can change it before sending.",
    },
    rungs: (p) => [
      {
        step: "Step 1", h3: "Google profile", price: p.start,
        text: "I sort out your Google listing: correct opening hours, a description in German and Italian, your services and a contact button that works on a phone. You send me the photos.",
        meta: "Done in one afternoon",
        second: `On site: ${p.onSite}. I come to you, take 8–10 photos myself and write the text.`,
        link: "Ask about the Google profile",
      },
      {
        step: "Step 2 · one page", h3: "One-page website", price: `from ${p.essential}`,
        text: "Everything a new customer needs to know, on one page: what you offer, prices, opening hours, directions and a WhatsApp button. Your own design, built with Framer.",
        meta: "About 1–2 weeks once texts and photos are ready",
        link: "Ask about a one-page site",
      },
      {
        step: "Step 2 · up to 6 pages", h3: "Website up to 6 pages", price: `from ${p.business}`,
        text: "For businesses with more to show: pages for services, team and gallery. You update news and offers yourself. Built with Framer.",
        meta: "About 3–4 weeks",
        link: "Ask about the 6-page website",
      },
    ],
    footnote: (p) =>
      `Also: online booking set up, ${p.booking}; you pay the booking tool's subscription directly to the provider. Signature, hand-coded (Next.js) and multilingual: from ${p.signature}. Care from ${p.care} a month, never required. Payment: half at the start, half on delivery.`,
    allPrices: "All prices and details",
    newTab: "(opens in a new tab)",
    more: "What's included",
    footnoteSummary: "Other services and payment terms",
  },
};
