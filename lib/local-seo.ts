// Local-SEO landing pages ("Webdesigner Winterthur/Zürich", "Webdesign Schweiz").
// One page per area, per locale, at /webdesign/[city]. Content is unique per area (no thin
// doorway pages) and shares the homepage's first-person, conversion-focused voice.
import type { Locale } from "./i18n";

export const LOCAL_CITIES = ["winterthur", "zuerich", "schweiz"] as const;
export type CitySlug = (typeof LOCAL_CITIES)[number];
export const isCitySlug = (x: string): x is CitySlug =>
  (LOCAL_CITIES as readonly string[]).includes(x);

type Tri = Record<Locale, string>;

export type LocalArea = {
  slug: CitySlug;
  areaServedType: "City" | "Country";
  areaServedName: string; // schema.org areaServed name (e.g. "Winterthur", "Switzerland")
  navLabel: Tri; // short localized label for links/chips (e.g. "Zürich" / "Zurigo")
  metaTitle: Tri;
  metaDescription: Tri;
  eyebrow: Tri;
  h1: Tri;
  h1accent: Tri;
  intro: Tri;
  localTitle: Tri;
  localBody: Tri;
  ctaHeading: Tri;
};

export const LOCAL_AREAS: Record<CitySlug, LocalArea> = {
  winterthur: {
    slug: "winterthur",
    areaServedType: "City",
    areaServedName: "Winterthur",
    navLabel: { de: "Winterthur", it: "Winterthur", en: "Winterthur" },
    metaTitle: {
      de: "Webdesigner in Winterthur",
      it: "Web designer a Winterthur",
      en: "Web designer in Winterthur",
    },
    metaDescription: {
      de: "Webdesigner in Winterthur: Websites und Google-Profile für lokale Betriebe, zum Fixpreis und ohne Pflicht-Abo. Du schreibst immer direkt mit mir.",
      it: "Web designer a Winterthur: siti e profili Google per attività locali, a prezzo fisso e senza abbonamento obbligatorio. Tratti sempre direttamente con me.",
      en: "Web designer in Winterthur: websites and Google profiles for local businesses, at a fixed price, no required subscription. You always deal with me.",
    },
    eyebrow: { de: "Webdesign · Winterthur", it: "Web design · Winterthur", en: "Web design · Winterthur" },
    h1: { de: "Dein Webdesigner in ", it: "Il tuo web designer a ", en: "Your web designer in " },
    h1accent: { de: "Winterthur", it: "Winterthur", en: "Winterthur" },
    intro: {
      de: "Ich bin Francesco, Webdesigner in Winterthur. Ich baue Websites und bringe Google-Profile in Ordnung, damit man deinen Betrieb findet: für Coiffeure, Kosmetikstudios, Restaurants, Läden und Handwerker in Winterthur und Umgebung.",
      it: "Sono Francesco, web designer a Winterthur. Creo siti e sistemo profili Google perché i clienti trovino la tua attività: per ristoranti, pizzerie, parrucchieri, centri estetici, negozi e artigiani di Winterthur e dintorni.",
      en: "I'm Francesco, a web designer in Winterthur. I build websites and sort out Google profiles so people can find your business: for hair salons, beauty studios, restaurants, shops and trades in and around Winterthur.",
    },
    localTitle: { de: "Lokal, mit Gesicht", it: "Locale, con un volto", en: "Local, with a face" },
    localBody: {
      de: "Lokal heisst: eine feste Ansprechperson statt Callcenter, und jemand, der Winterthur kennt. Vom ersten Schreiben bis zum Launch hast du es nur mit mir zu tun, und für Fotos komme ich bei dir vorbei.",
      it: "Locale significa: una sola persona di riferimento invece di un call center, e qualcuno che conosce Winterthur. Dal primo messaggio al lancio tratti solo con me, e per le foto passo da te.",
      en: "Local means one fixed contact instead of a call centre, and someone who knows Winterthur. From the first message to launch you deal only with me, and for photos I come to you.",
    },
    ctaHeading: {
      de: "Erzähl mir von deinem Betrieb in Winterthur.",
      it: "Raccontami della tua attività a Winterthur.",
      en: "Tell me about your business in Winterthur.",
    },
  },
  zuerich: {
    slug: "zuerich",
    areaServedType: "City",
    areaServedName: "Zürich",
    navLabel: { de: "Zürich", it: "Zurigo", en: "Zürich" },
    metaTitle: {
      de: "Webdesigner für Zürich",
      it: "Web designer per Zurigo",
      en: "Web designer for Zürich",
    },
    metaDescription: {
      de: "Webdesigner für Zürich: Websites und Google-Profile mit lokalem SEO, damit Kundinnen und Kunden dich finden. Fixpreis, kein Pflicht-Abo.",
      it: "Web designer per Zurigo: siti e profili Google con SEO locale, così i clienti ti trovano in città. Prezzo fisso, nessun abbonamento obbligatorio.",
      en: "Web designer for Zürich: websites and Google profiles with local SEO, so customers in the city find you. Fixed price, no required subscription.",
    },
    eyebrow: { de: "Webdesign · Zürich", it: "Web design · Zurigo", en: "Web design · Zürich" },
    h1: { de: "Dein Webdesigner für ", it: "Il tuo web designer per ", en: "Your web designer for " },
    h1accent: { de: "Zürich", it: "Zurigo", en: "Zürich" },
    intro: {
      de: "Ich baue Websites und bringe Google-Profile in Ordnung für Betriebe in Zürich. Hier ist die Konkurrenz gross: Eine schnelle, klare Website mit sauberem lokalem SEO entscheidet mit, ob dich jemand findet oder das nächste Resultat anklickt.",
      it: "Creo siti e sistemo profili Google per le attività di Zurigo. Qui la concorrenza è forte: un sito veloce e chiaro, con una SEO locale fatta bene, conta molto quando qualcuno sceglie tra te e il risultato successivo.",
      en: "I build websites and sort out Google profiles for businesses in Zürich. Competition here is tough: a fast, clear website with clean local SEO helps decide whether someone finds you or clicks the next result.",
    },
    localTitle: { de: "Schon in Zürich umgesetzt", it: "Già realizzato a Zurigo", en: "Already built in Zürich" },
    localBody: {
      de: "In Zürich habe ich die Website von BJ Studio gebaut, einem Kosmetikstudio in Schwamendingen: «Termin buchen» öffnet direkt WhatsApp. Dazu ZüriKey, meine eigene Web-App für Mietdossiers, kein Kundenauftrag.",
      it: "A Zurigo ho fatto il sito di BJ Studio, un centro estetico a Schwamendingen: «Termin buchen» apre direttamente WhatsApp. E ZüriKey, la mia web app per i dossier d'affitto, non un lavoro per un cliente.",
      en: "In Zürich I built the website of BJ Studio, a beauty studio in Schwamendingen: “Termin buchen” opens WhatsApp directly. Plus ZüriKey, my own web app for rental dossiers, not a client job.",
    },
    ctaHeading: {
      de: "Erzähl mir von deinem Betrieb in Zürich.",
      it: "Raccontami della tua attività a Zurigo.",
      en: "Tell me about your business in Zürich.",
    },
  },
  schweiz: {
    slug: "schweiz",
    areaServedType: "Country",
    areaServedName: "Switzerland",
    navLabel: { de: "Schweiz", it: "Svizzera", en: "Switzerland" },
    metaTitle: {
      de: "Website erstellen lassen in der Schweiz",
      it: "Farsi fare un sito in Svizzera",
      en: "Get a website built in Switzerland",
    },
    metaDescription: {
      de: "Websites für kleine Betriebe in der ganzen Schweiz, zum Fixpreis. Eine feste Ansprechperson: per WhatsApp, per E-Mail und, wenn es sinnvoll ist, vor Ort.",
      it: "Siti per piccole attività in tutta la Svizzera, a prezzo fisso. Una sola persona di riferimento: su WhatsApp, per e-mail e, quando ha senso, di persona.",
      en: "Websites for small businesses across Switzerland, at a fixed price. One personal contact: on WhatsApp, by e-mail and, when it makes sense, in person.",
    },
    eyebrow: { de: "Webdesign · Schweiz", it: "Web design · Svizzera", en: "Web design · Switzerland" },
    h1: { de: "Website erstellen lassen in der ", it: "Farsi creare un sito in ", en: "Get your website built across " },
    h1accent: { de: "ganzen Schweiz", it: "tutta la Svizzera", en: "Switzerland" },
    intro: {
      de: "Egal ob Winterthur, Zürich, St. Gallen oder Tessin — ich baue Websites für kleine Betriebe in der ganzen Schweiz. Das meiste läuft online, mit schriftlichen Updates; wenn es Sinn macht, komme ich vorbei. Die Distanz war noch nie ein Problem.",
      it: "Che tu sia a Winterthur, Zurigo, San Gallo o in Ticino — costruisco siti per piccole attività in tutta la Svizzera. Gran parte del lavoro è online, con aggiornamenti scritti; quando ha senso, passo di persona. La distanza non è mai stata un problema.",
      en: "Whether you're in Winterthur, Zürich, St. Gallen or Ticino — I build websites for small businesses across Switzerland. Most of it happens online, with written updates; when it makes sense, I come by. Distance has never been a problem.",
    },
    localTitle: { de: "Aus Winterthur, für die ganze Schweiz", it: "Da Winterthur, per tutta la Svizzera", en: "From Winterthur, for all of Switzerland" },
    localBody: {
      de: "Von Winterthur aus arbeite ich für die ganze Schweiz, kenne den Schweizer Markt und schreibe sauberes Schweizer Hochdeutsch — dazu Italienisch und Englisch, wenn dein Betrieb mehrsprachig ist. Fixpreis vorab, keine Überraschungen, und immer dieselbe Person, die antwortet: ich.",
      it: "Lavoro da Winterthur, conosco il mercato svizzero e scrivo in tedesco svizzero corretto — oltre a italiano e inglese, se la tua attività è multilingua. Prezzo fisso concordato prima, nessuna sorpresa, e sempre la stessa persona che risponde: io.",
      en: "I work from Winterthur, know the Swiss market and write proper Swiss High German — plus Italian and English if your business is multilingual. Fixed price agreed upfront, no surprises, and always the same person answering: me.",
    },
    ctaHeading: {
      de: "Schreib mir, wo dein Betrieb ist.",
      it: "Scrivimi dove si trova la tua attività.",
      en: "Tell me where your business is.",
    },
  },
};
