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
      de: "Webdesigner Winterthur — Websites, die Kunden bringen",
      it: "Web designer a Winterthur — siti che portano clienti",
      en: "Web Designer in Winterthur — websites that bring customers",
    },
    metaDescription: {
      de: "Webdesigner in Winterthur und persönliche Alternative zur Webagentur: von Hand gebaute, bei Google auffindbare Websites für lokale Betriebe. Festpreis, gratis Erstberatung.",
      it: "Web designer a Winterthur: costruisco a mano siti veloci e trovabili su Google per le attività locali. Prezzo fisso, prima consulenza gratuita, un'unica persona di riferimento.",
      en: "Web designer in Winterthur: I hand-build fast, Google-friendly websites for local businesses. Fixed price, free first consultation, one personal contact.",
    },
    eyebrow: { de: "Webdesign · Winterthur", it: "Web design · Winterthur", en: "Web design · Winterthur" },
    h1: { de: "Dein Webdesigner in ", it: "Il tuo web designer a ", en: "Your web designer in " },
    h1accent: { de: "Winterthur", it: "Winterthur", en: "Winterthur" },
    intro: {
      de: "Ich bin Francesco, Webdesigner in Winterthur. Ich baue von Hand Websites, die deinen Betrieb bei Google sichtbar machen und Besucher in Kunden verwandeln — für Restaurants, Praxen, B&Bs und kleine Läden in Winterthur und Umgebung.",
      it: "Sono Francesco, web designer a Winterthur. Costruisco a mano siti che rendono la tua attività visibile su Google e trasformano i visitatori in clienti — per ristoranti, studi, B&B e piccoli negozi di Winterthur e dintorni.",
      en: "I'm Francesco, a web designer in Winterthur. I hand-build websites that make your business visible on Google and turn visitors into customers — for restaurants, practices, B&Bs and small shops in and around Winterthur.",
    },
    localTitle: { de: "Lokal, mit Gesicht", it: "Locale, con un volto", en: "Local, with a face" },
    localBody: {
      de: "Lokal heisst: ein Ansprechpartner statt Callcenter, ein Kaffee statt endloser E-Mails, und jemand, der Winterthur kennt. Vom ersten Gespräch bis zum Launch machst du alles mit mir — und danach bin ich für Updates und Fragen da.",
      it: "Locale significa: una persona di riferimento invece di un call center, un caffè invece di email infinite, e qualcuno che conosce Winterthur. Dalla prima chiacchierata al lancio fai tutto con me — e dopo ci sono per aggiornamenti e domande.",
      en: "Local means one contact instead of a call centre, a coffee instead of endless emails, and someone who knows Winterthur. From the first chat to launch you do everything with me — and afterwards I'm here for updates and questions.",
    },
    ctaHeading: {
      de: "Erzähl mir von deinem Betrieb in Winterthur",
      it: "Raccontami la tua attività a Winterthur",
      en: "Tell me about your business in Winterthur",
    },
  },
  zuerich: {
    slug: "zuerich",
    areaServedType: "City",
    areaServedName: "Zürich",
    navLabel: { de: "Zürich", it: "Zurigo", en: "Zürich" },
    metaTitle: {
      de: "Webdesigner Zürich — Websites, die gefunden werden",
      it: "Web designer a Zurigo — siti che si fanno trovare",
      en: "Web Designer in Zürich — websites that get found",
    },
    metaDescription: {
      de: "Webdesigner und Webagentur-Alternative für Zürich: von Hand gebaute Websites mit lokalem SEO, damit Kundinnen und Kunden dich finden. Festpreis, gratis Erstberatung.",
      it: "Web designer per Zurigo: siti costruiti a mano con SEO locale, così i clienti ti trovano in città. Prezzo fisso, prima consulenza gratuita, seguito di persona.",
      en: "Web designer for Zürich: hand-built websites with local SEO so customers find you in the city. Fixed price, free first consultation, personally handled.",
    },
    eyebrow: { de: "Webdesign · Zürich", it: "Web design · Zurigo", en: "Web design · Zürich" },
    h1: { de: "Dein Webdesigner für ", it: "Il tuo web designer per ", en: "Your web designer for " },
    h1accent: { de: "Zürich", it: "Zurigo", en: "Zürich" },
    intro: {
      de: "Ich baue Websites für Betriebe in Zürich, die nicht nur schön sind, sondern gefunden werden. In Zürich ist die Konkurrenz gross — eine schnelle, klare Website mit sauberem lokalem SEO entscheidet, ob dich jemand findet oder den Nächsten anklickt.",
      it: "Costruisco siti per le attività di Zurigo che non sono solo belli, ma si fanno trovare. A Zurigo la concorrenza è alta — un sito veloce e chiaro con una SEO locale curata decide se qualcuno trova te o clicca sul prossimo.",
      en: "I build websites for Zürich businesses that aren't just beautiful — they get found. Competition in Zürich is fierce, and a fast, clear website with clean local SEO decides whether someone finds you or clicks the next result.",
    },
    localTitle: { de: "Schon in Zürich umgesetzt", it: "Già realizzato a Zurigo", en: "Already built in Zürich" },
    localBody: {
      de: "Ich habe bereits für Zürcher Kunden gebaut: ZüriKey, die Web-App für Mietdossiers, und BJ Studio, ein mehrsprachiges Beauty-Studio mit Terminbuchung über WhatsApp. Verschiedene Betriebe, dasselbe Ziel — online gefunden werden und Anfragen gewinnen.",
      it: "Ho già lavorato per clienti di Zurigo: ZüriKey, la web app per i dossier d'affitto, e BJ Studio, uno studio beauty multilingua con prenotazione via WhatsApp. Attività diverse, stesso obiettivo — farsi trovare online e ottenere richieste.",
      en: "I've already built for Zürich clients: ZüriKey, the web app for rental dossiers, and BJ Studio, a multilingual beauty studio with WhatsApp booking. Different businesses, one goal — get found online and win enquiries.",
    },
    ctaHeading: {
      de: "Bereit, in Zürich gefunden zu werden?",
      it: "Pronto a farti trovare a Zurigo?",
      en: "Ready to get found in Zürich?",
    },
  },
  schweiz: {
    slug: "schweiz",
    areaServedType: "Country",
    areaServedName: "Switzerland",
    navLabel: { de: "Schweiz", it: "Svizzera", en: "Switzerland" },
    metaTitle: {
      de: "Website erstellen lassen — Webdesigner in der ganzen Schweiz",
      it: "Farsi creare un sito — web designer in tutta la Svizzera",
      en: "Get a website built — web designer across Switzerland",
    },
    metaDescription: {
      de: "Von Hand gebaute Websites für kleine Betriebe in der ganzen Schweiz: schnell, auffindbar, zum Festpreis. Ein persönlicher Ansprechpartner, remote und vor Ort.",
      it: "Siti costruiti a mano per piccole attività in tutta la Svizzera: veloci, trovabili, a prezzo fisso. Un'unica persona di riferimento, da remoto e di persona.",
      en: "Hand-built websites for small businesses across Switzerland: fast, findable, fixed price. One personal contact, remote and in person.",
    },
    eyebrow: { de: "Webdesign · Schweiz", it: "Web design · Svizzera", en: "Web design · Switzerland" },
    h1: { de: "Website erstellen lassen in der ", it: "Farsi creare un sito in ", en: "Get your website built across " },
    h1accent: { de: "ganzen Schweiz", it: "tutta la Svizzera", en: "Switzerland" },
    intro: {
      de: "Egal ob Winterthur, Zürich, St. Gallen oder Tessin — ich baue Websites für kleine Betriebe in der ganzen Schweiz. Das meiste läuft online, mit Calls und Updates; wenn es Sinn macht, komme ich vorbei. Die Distanz war noch nie ein Problem.",
      it: "Che tu sia a Winterthur, Zurigo, San Gallo o in Ticino — costruisco siti per piccole attività in tutta la Svizzera. Gran parte del lavoro è online, con call e aggiornamenti; quando ha senso, passo di persona. La distanza non è mai stata un problema.",
      en: "Whether you're in Winterthur, Zürich, St. Gallen or Ticino — I build websites for small businesses across Switzerland. Most of it happens online, with calls and updates; when it makes sense, I come by. Distance has never been a problem.",
    },
    localTitle: { de: "100% Made in Switzerland", it: "100% Made in Switzerland", en: "100% Made in Switzerland" },
    localBody: {
      de: "Ich arbeite aus Winterthur, kenne den Schweizer Markt und schreibe sauberes Schweizer Hochdeutsch — dazu Italienisch und Englisch, wenn dein Betrieb mehrsprachig ist. Festpreis vorab, keine Überraschungen, und immer dieselbe Person, die antwortet: ich.",
      it: "Lavoro da Winterthur, conosco il mercato svizzero e scrivo in tedesco svizzero corretto — oltre a italiano e inglese, se la tua attività è multilingua. Prezzo fisso concordato prima, nessuna sorpresa, e sempre la stessa persona che risponde: io.",
      en: "I work from Winterthur, know the Swiss market and write proper Swiss High German — plus Italian and English if your business is multilingual. Fixed price agreed upfront, no surprises, and always the same person answering: me.",
    },
    ctaHeading: {
      de: "Wo in der Schweiz bist du zu Hause?",
      it: "Dove sei in Svizzera?",
      en: "Where in Switzerland are you based?",
    },
  },
};
