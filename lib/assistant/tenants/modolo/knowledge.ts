// Business knowledge of Modolo Digital Studio for the AI assistant. SERVER-ONLY at runtime.
//
// Where the facts come from (never from memory):
//   - packages, prices, care plans, terms and the "every website includes" list are GENERATED
//     from lib/pricing.ts, so a change on /prezzi reaches the assistant with the next deploy
//     (its first-person copy is put in the third person on the way: THIRD_PERSON below);
//   - FAQ and page titles from lib/site-data.ts, contacts and addresses from lib/site.ts, the
//     labels of the /webdesign/* links from lib/local-seo.ts, every link from localizedHref
//     (lib/i18n.ts);
//   - copy that only exists inside client components (service pages, method, guarantee,
//     portfolio, free Google check), the served areas (areaText), the reviews line and the
//     privacy facts of the chat are transcribed here; each section's `source` cites file:line.
//     data/reviews.ts is not read. components/home.tsx citations refer to the committed file
//     (HEAD 19eec56). A homepage redesign is in progress in the working tree (content/home/*,
//     data/projects.ts, not committed and therefore never imported here): every transcribed
//     claim is one that BOTH versions make, in the narrower wording where they differ.
// The version carries a hash of every section, so a change in the imported data changes it too.
// Bump KNOWLEDGE_DATE when transcribed copy is edited.
import type { KnowledgeBase, KnowledgeSection } from "@/lib/assistant/types";
import { localizedHref, type Locale } from "@/lib/i18n";
import { LOCAL_AREAS, LOCAL_CITIES } from "@/lib/local-seo";
import {
  BRANDING,
  CARE,
  GOOD_TO_KNOW,
  HOURLY,
  INCLUDED,
  INCLUDED_TITLE,
  PRICING_UI,
  VAT,
  WEBSITES,
  type CarePlan,
  type PriceItem,
} from "@/lib/pricing";
import { CURRENCY, DEFAULT_REGION, REGIONS, type Region } from "@/lib/region";
import { SERVICE_SLUGS, SITE, type ServiceSlug } from "@/lib/site";
import { FAQS, LEGAL_META, SERVICE_META } from "@/lib/site-data";

type Tri = Record<Locale, string>;

// Date of the last edit of the transcribed copy; a second edit on the same day adds ".2", ".3"…
const KNOWLEDGE_DATE = "2026-11-16.2";

/** One text per site locale, built by the same function (adding a locale is a compile error here). */
function perLocale(build: (locale: Locale) => string): Tri {
  return { en: build("en"), de: build("de"), it: build("it") };
}

// ---------------------------------------------------------------------------------------------
// Regions and money
// ---------------------------------------------------------------------------------------------

/**
 * Regions whose prices the website publishes. components/pricing-page.tsx (`const region: Region
 * = "ch"`) forces the Swiss list for EVERY visitor since commit 91b4279 (2026-07-10, "Client wants
 * only Swiss (CHF) prices shown for the moment"), and the committed homepage and service pages use
 * the region only for the WhatsApp number: no page shows EUR amounts. Quoting the EUR amounts of
 * lib/pricing.ts would contradict the site, so Italian visitors get the packages without amounts
 * and are pointed to a personal quote.
 * Add "it" here as soon as ANY page (the homepage included, e.g. the redesign's EUR swap for
 * region "it") shows EUR amounts to visitors from Italy, in the same commit. Give Italy its own
 * VAT line then: the GOOD_TO_KNOW VAT entry is a Swiss tax status (and update the VAT rule in
 * config.ts, which tells the model the knowledge says nothing about VAT for Italy).
 */
export const PUBLISHED_PRICE_REGIONS: readonly Region[] = ["ch"];

/** WhatsApp number per region: Italian visitors get the Italian line, like the site (components/use-region.ts). */
export const WHATSAPP_BY_REGION: Record<Region, { number: string; display: string }> = {
  ch: { number: SITE.phone, display: SITE.phoneDisplay },
  it: { number: SITE.phoneIt, display: SITE.phoneItDisplay },
};

// Same rule as THOUSANDS/groupThousands in components/pricing-page.tsx (English comma, Swiss German apostrophe,
// Italian dot), repeated because a client component must not be imported on the server: the
// assistant has to print an amount exactly as the pricing page shows it to the same reader.
const THOUSANDS: Tri = { en: ",", de: "'", it: "." };

/** "1'690" (de), "1,690" (en), "1.690" (it). */
export function formatNumber(value: number, locale: Locale): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS[locale]);
}

/** "CHF 1'690" (de), "CHF 1,690" (en), "CHF 1.690" (it): the pricing page's `amount()`. */
export function formatAmount(value: number, region: Region, locale: Locale): string {
  return `${CURRENCY[region]} ${formatNumber(value, locale)}`;
}

/** Resolves the {cur}/{hourly}/{vat} tokens of lib/pricing.ts like the pricing page's `resolve()`. */
function fillTokens(text: string, region: Region, locale: Locale): string {
  return text
    .replaceAll("{cur}", CURRENCY[region])
    .replaceAll("{hourly}", formatNumber(HOURLY[region], locale))
    .replaceAll("{vat}", VAT[region]);
}

function priceText(item: { from: boolean; price: Record<Region, number> }, region: Region, locale: Locale): string {
  const amount = formatAmount(item.price[region], region, locale);
  return item.from ? `${PRICING_UI[locale].from} ${amount}` : amount;
}

/**
 * lib/pricing.ts speaks in Francesco's voice ("I come to you", "You always talk to me"); the
 * assistant is not Francesco, and a first-person line in its knowledge invites it to speak as him.
 * So every first-person passage of that copy is swapped for a faithful third-person version,
 * exact string for exact string, in every section built from lib/pricing.ts. A source edit that
 * makes a pair stop matching fails tests/assistant/tenants.test.ts (every pair must still match,
 * and the price list may hold no first-person pronoun) until the pair is updated.
 * The pairs also carry commit c71e0bc ("Stop promising phone calls"), which reworded the on-site
 * Google profile in German only: lib/pricing.ts:170 and :172 still bill "ten minutes on the
 * phone" in English and Italian, and Francesco does not call.
 */
export const THIRD_PERSON: Record<Locale, ReadonlyArray<readonly [from: string, to: string]>> = {
  en: [
    ["I come to you", "Francesco comes to you"],
    ["You send me your photos; I do the rest.", "You send Francesco your photos; he does the rest."],
    [
      "but I come to you: I shoot the 8–10 photos myself at your place, write the German and Italian text, and set the whole thing up. Your effort: ten minutes on the phone and twenty on site.",
      "but Francesco comes to you: he shoots the 8–10 photos himself at your place, writes the German and Italian text, and sets the whole thing up. Your effort: ten minutes to agree the details and twenty on site.",
    ],
    [
      "I set up the booking tool with your services, durations and breaks, put it on your website and wire the Book button into your Google listing.",
      "Francesco sets up the booking tool with your services, durations and breaks, puts it on your website and wires the Book button into your Google listing.",
    ],
    ["You always talk to me — no call centre", "You always deal with Francesco directly — no call centre"],
  ],
  de: [
    ["Ich komme vorbei", "Francesco kommt vorbei"],
    ["Die Fotos schickst du mir; den Rest mache ich.", "Die Fotos schickst du Francesco; den Rest macht er."],
    [
      "aber ich komme zu dir: Ich mache die acht bis zehn Fotos selber bei dir, schreibe den deutschen und italienischen Text und richte alles ein.",
      "aber Francesco kommt zu dir: Er macht die acht bis zehn Fotos selber bei dir, schreibt den deutschen und italienischen Text und richtet alles ein.",
    ],
    [
      "Ich richte das Buchungstool mit deinen Leistungen, Dauern und Pausen ein, baue es in deine Website und verbinde den Termin-Button mit deinem Google-Eintrag.",
      "Francesco richtet das Buchungstool mit deinen Leistungen, Dauern und Pausen ein, baut es in deine Website ein und verbindet den Termin-Button mit deinem Google-Eintrag.",
    ],
    ["Du sprichst immer mit mir — kein Callcenter", "Du hast immer direkt mit Francesco zu tun — kein Callcenter"],
  ],
  it: [
    ["Vengo io da te", "Francesco viene da te"],
    ["Le foto me le mandi tu, al resto penso io.", "Le foto le mandi tu a Francesco, al resto pensa lui."],
    [
      "ma vengo io: faccio io le 8–10 foto da te, scrivo il testo in tedesco e italiano e imposto tutto. Il tuo impegno: dieci minuti al telefono e venti sul posto.",
      "ma viene Francesco di persona: fa lui le 8–10 foto da te, scrive il testo in tedesco e italiano e imposta tutto. Il tuo impegno: dieci minuti per accordarsi e venti sul posto.",
    ],
    [
      "Configuro lo strumento con i tuoi servizi, le durate e le pause, lo metto sul sito e collego il pulsante Prenota alla tua scheda Google.",
      "Francesco configura lo strumento con i tuoi servizi, le durate e le pause, lo mette sul sito e collega il pulsante Prenota alla tua scheda Google.",
    ],
    ["Parli sempre con me, mai un call center", "Tratti sempre direttamente con Francesco, mai con un call center"],
  ],
};

// Longest pair first, so a short pair can never cut into a longer one that contains it
// ("I come to you" is both the English badge and the start of the on-site description).
function longestFirst(pairs: ReadonlyArray<readonly [string, string]>): ReadonlyArray<readonly [string, string]> {
  return [...pairs].sort((a, b) => b[0].length - a[0].length);
}
const THIRD_PERSON_SORTED: Record<Locale, ReadonlyArray<readonly [string, string]>> = {
  en: longestFirst(THIRD_PERSON.en),
  de: longestFirst(THIRD_PERSON.de),
  it: longestFirst(THIRD_PERSON.it),
};

/** lib/pricing.ts copy as the assistant may state it: in the third person (see THIRD_PERSON). */
function inThirdPerson(text: string, locale: Locale): string {
  let out = text;
  for (const [from, to] of THIRD_PERSON_SORTED[locale]) out = out.replaceAll(from, to);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Packages and prices (generated from lib/pricing.ts)
// ---------------------------------------------------------------------------------------------

// GOOD_TO_KNOW entries that hold in every market. Anything else (the hourly rate, the VAT line,
// any entry added later) is shown only next to a published price list: it may carry an amount
// or a Swiss-only statement, so an unknown entry is withheld rather than shown everywhere.
const MARKET_NEUTRAL_TERMS: ReadonlySet<string> = new Set(["Quotes", "Payment", "Revisions", "Ownership"]);
const NEUTRAL_TERMS = GOOD_TO_KNOW.filter((entry) => MARKET_NEUTRAL_TERMS.has(entry.label.en));
const PRICE_LIST_NOTES = GOOD_TO_KNOW.filter((entry) => !MARKET_NEUTRAL_TERMS.has(entry.label.en));

/**
 * One package line. `metaIsUnit`: branding metas are units ("half day", "per page") that belong
 * next to the price; website metas are delivery notes that close the line.
 */
function packageLine(item: PriceItem, locale: Locale, region: Region | null, metaIsUnit: boolean): string {
  const meta = item.meta?.[locale];
  const qualifiers = [item.badge?.[locale], metaIsUnit && !region ? meta : undefined].filter(Boolean);
  const name = `**${item.name[locale]}**${qualifiers.length ? ` (${qualifiers.join(", ")})` : ""}`;
  const price = region ? `${priceText(item, region, locale)}${metaIsUnit && meta ? ` (${meta})` : ""}. ` : "";
  const delivery = !metaIsUnit && meta ? ` (${meta})` : "";
  return `- ${name}: ${price}${item.desc[locale]}${delivery}`;
}

function careLine(plan: CarePlan, locale: Locale, region: Region | null): string {
  const price = region ? `${formatAmount(plan.price[region], region, locale)}${PRICING_UI[locale].perMonth}. ` : "";
  return `- **${plan.name}**: ${price}${plan.features.map((feature) => feature[locale]).join(" · ")}.`;
}

function groupHeading(group: { title: Tri; tagline: Tri }, locale: Locale): string {
  return `**${group.title[locale]}** (${group.tagline[locale]}):`;
}

const AND: Tri = { en: "and", de: "und", it: "e" };

function joinList(items: string[], locale: Locale): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${AND[locale]} ${items[items.length - 1]}`;
}

const WEBSITES_START: Record<Locale, { start: string; one: string; many: string }> = {
  en: {
    start: "Websites start from {amount} ({package}).",
    one: "{names} is for the Google listing and online booking, not a website.",
    many: "{names} are for the Google listing and online booking, not websites.",
  },
  de: {
    start: "Websites gibt es ab {amount} ({package}).",
    one: "{names} ist für den Google-Eintrag und die Online-Terminbuchung da, keine Website.",
    many: "{names} sind für den Google-Eintrag und die Online-Terminbuchung da, keine Websites.",
  },
  it: {
    start: "I siti partono da {amount} ({package}).",
    one: "{names} serve per la scheda Google e le prenotazioni online, non è un sito.",
    many: "{names} servono per la scheda Google e le prenotazioni online, non sono siti.",
  },
};

/**
 * The Websites group of lib/pricing.ts opens with fixed-price services for the Google listing and
 * bookings (CHF 390 and up), while every website package is priced "from": without this line,
 * "how much is a website?" invites the cheapest Google service as the answer. Generated from the
 * `from` flags, so a new entry service joins the list by itself; tests/assistant/tenants.test.ts
 * fails if a fixed-price item is ever not a Google or booking service.
 */
function websitesStartLine(locale: Locale, region: Region): string | null {
  const firstWebsite = WEBSITES.items.find((item) => item.from);
  if (!firstWebsite) return null;
  const badge = firstWebsite.badge?.[locale];
  const copy = WEBSITES_START[locale];
  const start = copy.start
    .replace("{amount}", formatAmount(firstWebsite.price[region], region, locale))
    .replace("{package}", `**${firstWebsite.name[locale]}**${badge ? `, ${badge}` : ""}`);
  const entries = WEBSITES.items.filter((item) => !item.from).map((item) => `**${item.name[locale]}**`);
  if (entries.length === 0) return start;
  return `${start} ${(entries.length === 1 ? copy.one : copy.many).replace("{names}", joinList(entries, locale))}`;
}

// Written for the assistant, from what the site states: /prezzi labels its list "Switzerland ·
// CHF" (lib/pricing.ts:74,95,116) and every project gets a fixed quote (lib/pricing.ts:421-425).
const UNPUBLISHED_PRICES: Tri = {
  en: "The website publishes no prices for Italy. Clients in Italy get a fixed quote for their project, agreed before work starts: ask through the quote form, WhatsApp or email. The prices on the pricing page are the Swiss prices in CHF and apply to clients in Switzerland. The packages as published on the pricing page:",
  de: "Für Italien veröffentlicht die Website keine Preise. Kundinnen und Kunden in Italien bekommen für ihr Projekt eine Festpreis-Offerte, vereinbart vor Arbeitsbeginn: Anfrage über das Anfrageformular, WhatsApp oder E-Mail. Die Preise auf der Preisseite sind die Schweizer Preise in CHF und gelten für Kundinnen und Kunden in der Schweiz. Die Pakete, wie sie auf der Preisseite stehen:",
  it: "Per l'Italia il sito non pubblica prezzi. I clienti in Italia ricevono un preventivo a prezzo fisso per il loro progetto, concordato prima di iniziare: si chiede con il modulo di richiesta, su WhatsApp o via email. I prezzi della pagina prezzi sono quelli svizzeri in CHF e valgono per i clienti in Svizzera. I pacchetti come pubblicati nella pagina prezzi:",
};

function pricingText(locale: Locale, region: Region): string {
  const published = PUBLISHED_PRICE_REGIONS.includes(region);
  const priced = published ? region : null;
  const websitesStart = published ? websitesStartLine(locale, region) : null;
  const lines = [
    published ? `${fillTokens(PRICING_UI[locale].subtitle, region, locale)}.` : UNPUBLISHED_PRICES[locale],
    "",
    groupHeading(WEBSITES, locale),
    ...(websitesStart ? [websitesStart] : []),
    ...WEBSITES.items.map((item) => packageLine(item, locale, priced, false)),
    "",
    groupHeading(CARE, locale),
    ...CARE.plans.map((plan) => careLine(plan, locale, priced)),
    "",
    groupHeading(BRANDING, locale),
    ...BRANDING.items.map((item) => packageLine(item, locale, priced, true)),
  ];
  if (published && PRICE_LIST_NOTES.length > 0) {
    lines.push(
      "",
      `${PRICING_UI[locale].goodToKnow}:`,
      ...PRICE_LIST_NOTES.map((entry) => `- ${entry.label[locale]} — ${fillTokens(entry.value[locale], region, locale)}`),
    );
  }
  return inThirdPerson(lines.join("\n"), locale);
}

/** The "every website includes" list of lib/pricing.ts, in the third person. */
function includedText(locale: Locale): string {
  return inThirdPerson(INCLUDED.map((item) => `- ${item[locale]}`).join("\n"), locale);
}

// ---------------------------------------------------------------------------------------------
// Transcribed copy (client components; sources cited per section)
// ---------------------------------------------------------------------------------------------

const ABOUT: Tri = {
  en: [
    "- Modolo Digital Studio is the web studio of Francesco Modolo (founder, web designer and developer), a sole proprietorship based in Winterthur, Switzerland.",
    "- He builds websites, sorts out Google profiles and makes brands and content for small local businesses and professionals, for example restaurants, shops and beauty studios.",
    "- He has been building websites for small businesses across Switzerland for over four years. Code, design and SEO he does himself; for photos and video a trusted professional (photographer and videomaker) joins him when a job needs it.",
    "- He takes on only a few projects at a time and handles each one personally, from the first message to the day the site goes live. Clients always deal with him: no agency, no call centre.",
    "- Most of the work happens online, with written updates; when it makes sense he meets clients in person.",
  ].join("\n"),
  de: [
    "- Modolo Digital Studio ist das Web-Studio von Francesco Modolo (Gründer, Webdesigner und Entwickler), ein Einzelunternehmen mit Sitz in Winterthur.",
    "- Er baut Websites, bringt Google-Profile in Ordnung und gestaltet Marken und Inhalte für kleine lokale Betriebe und Fachleute, zum Beispiel Restaurants, Läden und Kosmetikstudios.",
    "- Seit über vier Jahren baut er Websites für kleine Betriebe in der ganzen Schweiz. Code, Design und SEO macht er selbst; für Fotos und Videos holt er einen Profi dazu, dem er vertraut (Fotograf und Videomaker), wenn ein Projekt es braucht.",
    "- Er nimmt nur wenige Projekte auf einmal an und betreut jedes persönlich, von der ersten Nachricht bis zum Tag, an dem die Website online geht. Ansprechperson ist immer er: keine Agentur, kein Callcenter.",
    "- Der grösste Teil läuft online, mit schriftlichen Updates; wenn es Sinn macht, trifft er Kundinnen und Kunden persönlich.",
  ].join("\n"),
  it: [
    "- Modolo Digital Studio è lo studio web di Francesco Modolo (fondatore, web designer e sviluppatore), ditta individuale con sede a Winterthur, in Svizzera.",
    "- Costruisce siti, sistema profili Google e cura brand e contenuti per piccole attività locali e professionisti, per esempio ristoranti, negozi e centri estetici.",
    "- Da oltre quattro anni costruisce siti per piccole attività in tutta la Svizzera. Codice, design e SEO li fa lui; per foto e video, quando un lavoro lo richiede, lo affianca un professionista di fiducia (fotografo e videomaker).",
    "- Prende pochi progetti alla volta e li segue uno per uno di persona, dal primo messaggio al giorno in cui il sito va online. Il referente è sempre lui: niente agenzia, niente call center.",
    "- Gran parte del lavoro è online, con aggiornamenti scritti; quando ha senso incontra i clienti di persona.",
  ].join("\n"),
};

const SERVICES_INTRO: Tri = {
  en: "Five service areas, each with its own page (see Useful links). Website packages, the Google profile service, online booking and the care plans are in the section Packages and prices.",
  de: "Fünf Leistungsbereiche, jeder mit eigener Seite (siehe Nützliche Links). Website-Pakete, das Google-Profil-Angebot, die Online-Terminbuchung und die Care-Pakete stehen im Abschnitt Pakete und Preise.",
  it: "Cinque aree di servizio, ognuna con la sua pagina (vedi Link utili). Pacchetti sito, servizio per la scheda Google, prenotazione online e pacchetti Care sono nella sezione Pacchetti e prezzi.",
};

const SERVICE_DETAILS: Record<ServiceSlug, Tri> = {
  web: {
    en: "custom web design tailored to your brand; high-performance development (fast, secure, mobile-first); local SEO optimisation to rank in your area; Google Business profile setup and optimisation; responsive layouts that look great on every device; ongoing support and maintenance after launch.",
    de: "massgeschneidertes Webdesign, abgestimmt auf deine Marke; performante Entwicklung (schnell, sicher, mobile-first); lokale SEO-Optimierung für deine Region; Einrichtung und Optimierung deines Google-Business-Profils; responsive Layouts, die auf jedem Gerät überzeugen; laufender Support und Wartung nach dem Launch.",
    it: "web design su misura, in linea con il tuo brand; sviluppo performante (veloce, sicuro, mobile-first); ottimizzazione SEO locale per emergere nella tua zona; configurazione e ottimizzazione del profilo Google Business; layout responsive, perfetti su ogni dispositivo; assistenza e manutenzione continua dopo il lancio.",
  },
  brand: {
    en: "logo design and full visual identity; colour palette and typography system; branded Canva templates for everyday use; brand guidelines to keep everything consistent; visual kit for social media; business cards, flyers and price lists; print-ready files, sent straight to the printer.",
    de: "Logodesign und komplette visuelle Identität; Farbpalette und Typografie-System; gebrandete Canva-Vorlagen für den Alltag; Markenrichtlinien für durchgängige Konsistenz; Visual-Kit für Social Media; Visitenkarten, Flyer und Preislisten; druckfertige Daten, direkt für die Druckerei.",
    it: "design del logo e identità visiva completa; palette colori e sistema tipografico; template Canva brandizzati per l'uso quotidiano; linee guida del brand per la massima coerenza; kit visivo per i social media; biglietti da visita, flyer e listini; file pronti per la stampa, da mandare in tipografia.",
  },
  content: {
    en: "Francesco shoots the photos himself; the social media side he runs together with Project Visibility. Includes professional photo shoots; social media management (with Project Visibility); content planning and an editorial calendar; visual storytelling for your brand; images optimised for web and social; consistent, on-brand content. Made for your business, not bought from a stock library.",
    de: "Die Fotos macht Francesco selber; die Social-Media-Betreuung führt er zusammen mit Project Visibility. Enthalten: professionelle Fotoshootings; Social-Media-Betreuung (mit Project Visibility); Content-Planung und Redaktionskalender; visuelles Storytelling für deine Marke; optimierte Bilder für Web und Social; konsistenter, markengerechter Content. Für deinen Betrieb gemacht, nicht aus einer Bilddatenbank gekauft.",
    it: "le foto le fa Francesco; la parte social la segue insieme a Project Visibility. Comprende shooting fotografici professionali; gestione social media (con Project Visibility); pianificazione contenuti e calendario editoriale; visual storytelling per il tuo brand; immagini ottimizzate per web e social; contenuti coerenti e in linea con il brand. Fatti per la tua attività, non comprati da una banca di immagini.",
  },
  ads: {
    en: "Google Ads and Meta campaign setup; creatives: graphics, flyers, short video, ad copy; a landing page built for the campaign; audiences and areas defined with you; conversion tracking, so you see what came back; you set the budget, and it always stays on your own account; a short monthly report in plain words: spend, enquiries, cost per enquiry. Fixed price per project; advertising is not on the price list.",
    de: "Kampagnen bei Google Ads und Meta einrichten; Material: Sujets, Flyer, kurzes Video, Anzeigentexte; eine Landingpage, die zur Kampagne passt; Zielgruppen und Gebiet zusammen festgelegt; Messung der Anfragen, damit du siehst, was zurückkommt; das Budget bestimmst du, und es bleibt immer auf deinem eigenen Konto; ein kurzer Monatsbericht in klaren Worten: Ausgaben, Anfragen, Kosten pro Anfrage. Festpreis pro Projekt; Werbung steht nicht in der Preisliste.",
    it: "campagne Google Ads e Meta, impostate da zero; materiali: grafiche, flyer, video brevi, testi degli annunci; una landing page costruita per la campagna; pubblico e zona decisi insieme; misurazione delle richieste, per vedere cosa è tornato indietro; il budget lo decidi tu e resta sempre sul tuo account; un report mensile corto e in parole chiare: spesa, richieste, costo per richiesta. Prezzo fisso per progetto; la pubblicità non è nel listino.",
  },
  email: {
    en: "newsletter design and setup; automated email campaigns and flows; audience segmentation; on-brand, mobile-friendly templates; performance tracking and optimisation; strategy to turn subscribers into clients.",
    de: "Newsletter-Design und -Einrichtung; automatisierte E-Mail-Kampagnen und Flows; Zielgruppen-Segmentierung; markengerechte, mobiloptimierte Vorlagen; Performance-Tracking und Optimierung; Strategie, um Abonnenten zu Kunden zu machen.",
    it: "design e configurazione della newsletter; campagne email automatizzate e flussi; segmentazione del pubblico; template in linea col brand e ottimizzati per mobile; monitoraggio dei risultati e ottimizzazione; strategia per trasformare gli iscritti in clienti.",
  },
};

// The live homepage promises replies "within 24 hours". Francesco confirmed on 2026-11-16 that
// this includes weekends, so the redesign's Monday-Friday narrowing (content/home/promises.ts,
// REPLY.weekendsConfirmed) no longer applies here.
const REPLY_TIME: Tri = {
  en: "within 24 hours",
  de: "innert 24 Stunden",
  it: "entro 24 ore",
};

const FREE_CHECK: Tri = {
  en: `- **Free Google check on video**: send Francesco the name of your business on WhatsApp. He searches for your business on Google the way a customer would and records a short video, without jargon: what a customer sees and the 3 things he would fix first. You get it on WhatsApp ${REPLY_TIME.en}. Free, no obligation.`,
  de: `- **Gratis Google-Check als Video**: Schick Francesco den Namen deines Betriebs auf WhatsApp. Er sucht deinen Betrieb bei Google, wie es ein Kunde tun würde, und nimmt ein kurzes Video auf, ohne Fachchinesisch: was ein Kunde sieht und die 3 Dinge, die er zuerst ändern würde. Du bekommst es auf WhatsApp, ${REPLY_TIME.de}. Gratis, unverbindlich.`,
  it: `- **Check Google gratuito in video**: manda a Francesco su WhatsApp il nome della tua attività. La cerca su Google come farebbe un cliente e registra un breve video, senza paroloni: cosa vede un cliente e le 3 cose che sistemerebbe per prime. Lo ricevi su WhatsApp ${REPLY_TIME.it}. Gratis, senza impegno.`,
};

const PROCESS: Tri = {
  en: [
    `1. You write to Francesco (WhatsApp, email or the contact form) about your business and what you need. He replies ${REPLY_TIME.en}, says whether and how he can help and, when he knows enough, gives you the fixed price straight away. No commitment.`,
    "2. You see the design before anything goes live: tailor-made, never a template. You tell him what to change.",
    "3. He builds the site, puts it online and gets it found on Google. After the final payment the domain, files and logins are yours. Afterwards he stays around for updates and changes, as the single person to message; care plans are optional.",
    "- Availability: Francesco takes on only a few projects at a time and tells you the next free start date when you write to him. No start dates are published.",
  ].join("\n"),
  de: [
    `1. Du schreibst Francesco (WhatsApp, E-Mail oder Kontaktformular), was dein Betrieb macht und was du brauchst. Er antwortet ${REPLY_TIME.de}, sagt dir, ob und wie er helfen kann, und nennt dir den Fixpreis gleich, wenn er genug weiss. Keine Verpflichtung.`,
    "2. Du siehst das Design, bevor etwas online geht: massgeschneidert, nie eine Vorlage. Du sagst ihm, was er ändern soll.",
    "3. Er baut die Website, bringt sie online und sorgt dafür, dass sie bei Google gefunden wird. Nach der Schlusszahlung gehören dir Domain, Dateien und Zugänge. Danach bleibt er für Updates und Änderungen da, als einzige Person, der du schreibst; Care-Pakete sind freiwillig.",
    "- Verfügbarkeit: Francesco nimmt nur wenige Projekte auf einmal an und nennt dir den nächsten freien Starttermin, wenn du ihm schreibst. Starttermine sind nicht veröffentlicht.",
  ].join("\n"),
  it: [
    `1. Scrivi a Francesco (su WhatsApp, via email o con il modulo di contatto) cosa fa la tua attività e cosa ti serve. Risponde ${REPLY_TIME.it}, ti dice se e come può aiutarti e, quando sa abbastanza, ti dice subito il prezzo fisso. Nessun impegno.`,
    "2. Vedi il design prima che qualcosa vada online: su misura, mai un template. Gli dici tu cosa cambiare.",
    "3. Costruisce il sito, lo mette online e lo fa trovare su Google. Dopo il saldo, dominio, file e accessi sono tuoi. Poi resta a disposizione per aggiornamenti e modifiche: una sola persona a cui scrivere; i pacchetti Care sono facoltativi.",
    "- Disponibilità: Francesco prende pochi progetti alla volta e ti dice la prima data libera quando gli scrivi. Le date di inizio non sono pubblicate.",
  ].join("\n"),
};

// The redesign words the guarantee more narrowly than the live band (design phase only, drafts
// stay with Francesco); the assistant uses the narrower version.
const GUARANTEE: Tri = {
  en: "- Guarantee: if the first design draft doesn't convince you, Francesco makes a new one; if the second doesn't either, you stop: you get your deposit back and the drafts stay with Francesco. This applies in the design phase, before the website goes live. The fixed price is agreed up front and put in writing: that's what you pay, no surprises at the end. The site is yours, with no lock-in: if you ever want to move on, you take it with you.",
  de: "- Garantie: Überzeugt dich der erste Entwurf nicht, macht Francesco einen neuen; überzeugt auch der zweite nicht, hört ihr auf: Du bekommst die Anzahlung zurück, und die Entwürfe bleiben bei Francesco. Das gilt in der Designphase, bevor die Website online geht. Der Festpreis wird vorher festgelegt und schriftlich festgehalten: Den zahlst du, keine Überraschungen am Schluss. Die Website gehört dir, ohne Bindung: Willst du eines Tages wechseln, nimmst du sie mit.",
  it: "- Garanzia: se la prima bozza di design non ti convince, Francesco ne fa una nuova; se non ti convince nemmeno la seconda, vi fermate: ti restituisce l'acconto e le bozze restano a lui. Vale nella fase di design, prima che il sito vada online. Il prezzo fisso si decide prima e lui lo mette per iscritto: quello paghi, nessuna sorpresa alla fine. Il sito è tuo, senza vincoli: se un giorno vuoi cambiare, te lo porti via.",
};

// "Hosting & domain set up for you" (INCLUDED) next to "no subscription" reads as "no running
// costs", so the owner's own disclosure goes with it (the redesign's FAQ answer, which the FAQ
// filter drops because it quotes an amount).
const NO_SUBSCRIPTION: Tri = {
  en: "- No subscription is required: the care plans are optional. Domain and hosting cost something every year, as with any website; Francesco states the amount in the written offer.",
  de: "- Ein Abo ist nie Pflicht: Die Care-Pakete sind freiwillig. Domain und Hosting kosten wie bei jeder Website etwas pro Jahr; den Betrag nennt Francesco in der Offerte.",
  it: "- Nessun abbonamento è obbligatorio: i pacchetti Care sono facoltativi. Dominio e hosting hanno un costo annuale, come per ogni sito: Francesco lo indica nell'offerta.",
};

// Only projects that are live and shown in both homepage versions. SaporiVivi is left out: its
// domain is offline and the redesign hides it (data/projects.ts: live false, kind "own").
// No review numbers: the homepage shows a selection, the full count and average live on Google.
const PORTFOLIO: Tri = {
  en: [
    "- **BJ Studio de Belleza** (client · beauty studio · Zürich): a website with the treatments and prices, a «Termin buchen» button that opens WhatsApp directly, and local SEO so people in Zürich find the studio.",
    "- **ZüriKey** (web app · Zürich): Francesco's own project, built and run by him, not a client job. It helps flat-hunters in Zürich put together a rental dossier and a cover letter in German, ready as a PDF.",
    "- Reviews: clients' Google reviews are shown on the homepage, and all of them can be read on Google.",
  ].join("\n"),
  de: [
    "- **BJ Studio de Belleza** (Kundin · Kosmetikstudio · Zürich): Website mit den Behandlungen und Preisen, einem Knopf «Termin buchen», der direkt WhatsApp öffnet, und lokalem SEO, damit man das Studio in Zürich findet.",
    "- **ZüriKey** (Web-App · Zürich): Francescos eigenes Projekt, von ihm gebaut und betrieben, kein Kundenauftrag. Es hilft Wohnungssuchenden in Zürich, ein Mietdossier und ein Bewerbungsschreiben auf Deutsch als PDF zusammenzustellen.",
    "- Bewertungen: Google-Bewertungen von Kundinnen und Kunden stehen auf der Startseite; alle lassen sich auf Google nachlesen.",
  ].join("\n"),
  it: [
    "- **BJ Studio de Belleza** (cliente · centro estetico · Zurigo): sito con i trattamenti e i prezzi, un pulsante «Termin buchen» che apre direttamente WhatsApp e SEO locale per farsi trovare a Zurigo.",
    "- **ZüriKey** (web app · Zurigo): un progetto di Francesco, costruito e gestito da lui, non un lavoro per un cliente. Aiuta chi cerca casa a Zurigo a preparare un dossier d'affitto e una lettera in tedesco, pronti in PDF.",
    "- Recensioni: le recensioni Google dei clienti sono in homepage, e si possono leggere tutte su Google.",
  ].join("\n"),
};

const COUNTRY: Record<Region, Tri> = {
  ch: { en: "Switzerland", de: "Schweiz", it: "Svizzera" },
  it: { en: "Italy", de: "Italien", it: "Italia" },
};

function areaText(locale: Locale): string {
  const ch = SITE.address;
  const it = SITE.addressIt;
  const offices = `${COUNTRY.ch[locale]} — ${ch.street}, ${ch.postalCode} ${ch.locality}; ${COUNTRY.it[locale]} — ${it.street}, ${it.postalCode} ${it.locality} (${it.region})`;
  const lines: Tri = {
    en: [
      "- Based in Winterthur. Francesco works with clients across Switzerland (for example Winterthur, Zürich, St. Gallen or Ticino), remotely and in person when needed. Distance is no problem: most of the work happens online, with written updates.",
      `- Offices: ${offices}.`,
      "- Languages: Francesco writes German (Swiss High German), Italian and English; websites can be multilingual. This website is in English, German and Italian.",
    ].join("\n"),
    de: [
      "- Sitz in Winterthur. Francesco arbeitet für Kundinnen und Kunden in der ganzen Schweiz (etwa Winterthur, Zürich, St. Gallen oder Tessin), remote und bei Bedarf persönlich. Distanz ist kein Problem: Der grösste Teil läuft online, mit schriftlichen Updates.",
      `- Standorte: ${offices}.`,
      "- Sprachen: Francesco schreibt Deutsch (Schweizer Hochdeutsch), Italienisch und Englisch; Websites können mehrsprachig sein. Diese Website gibt es auf Deutsch, Englisch und Italienisch.",
    ].join("\n"),
    it: [
      "- Sede a Winterthur. Francesco lavora con clienti in tutta la Svizzera (per esempio Winterthur, Zurigo, San Gallo o Ticino), da remoto e di persona quando serve. La distanza non è un problema: gran parte del lavoro è online, con aggiornamenti scritti.",
      `- Sedi: ${offices}.`,
      "- Lingue: Francesco scrive in tedesco (tedesco standard svizzero), italiano e inglese; i siti possono essere multilingua. Questo sito è in italiano, tedesco e inglese.",
    ].join("\n"),
  };
  return lines[locale];
}

function contactText(locale: Locale, region: Region): string {
  const whatsapp = WHATSAPP_BY_REGION[region];
  const wa = `https://wa.me/${whatsapp.number.replace(/\D/g, "")}`;
  const mail = `[${SITE.email}](mailto:${SITE.email})`;
  const form = localizedHref(locale, "/#contatti");
  const lines: Tri = {
    en: [
      `- WhatsApp (messages): ${whatsapp.display}, [WhatsApp](${wa})`,
      `- Email: ${mail}`,
      `- Contact form on the homepage: [contact form](${form})`,
      `- Reply time: Francesco replies personally, ${REPLY_TIME.en}. Getting in touch is without obligation.`,
    ].join("\n"),
    de: [
      `- WhatsApp (Nachrichten): ${whatsapp.display}, [WhatsApp](${wa})`,
      `- E-Mail: ${mail}`,
      `- Kontaktformular auf der Startseite: [Kontaktformular](${form})`,
      `- Antwortzeit: Francesco antwortet persönlich, ${REPLY_TIME.de}. Eine Anfrage ist unverbindlich.`,
    ].join("\n"),
    it: [
      `- WhatsApp (messaggi): ${whatsapp.display}, [WhatsApp](${wa})`,
      `- Email: ${mail}`,
      `- Modulo di contatto in homepage: [modulo di contatto](${form})`,
      `- Tempi di risposta: Francesco risponde di persona, ${REPLY_TIME.it}. Il primo contatto è senza impegno.`,
    ].join("\n"),
  };
  return lines[locale];
}

// The canonical privacy facts of the chat, worded for visitors. The privacy policy
// (components/legal-page.tsx) and the quote form's acknowledgement (lib/assistant/i18n.ts) state
// the same facts: change all three together. No retention period is given for Anthropic: its
// terms set it, and they can change.
const ABOUT_THIS_CHAT: Tri = {
  en: [
    "- The assistant is an AI and can make mistakes. What counts is the fixed price Francesco puts in writing before work starts.",
    "- Chat messages are sent to Anthropic Ireland, Limited (Ireland), which generates the replies as Modolo Digital Studio's processor; Anthropic may also process the data in the United States. Under Anthropic's commercial terms, API data is not used to train its models.",
    "- Together with the messages, the chat sends the page the visitor is on (only the path, without parameters), the chat language and the price region (Switzerland or Italy).",
    "- Anthropic keeps messages and replies for a limited period under its own terms, mainly to detect and prevent misuse, and then deletes them.",
    "- The website's server does not store the conversation: it stays only in the browser's session storage until the tab is closed. The website's logs contain only technical data such as counts, timings and estimated costs.",
    "- To prevent abuse, requests are counted per IP address, per chat session and, for quote requests, per email address. Only pseudonymised values (hashes) or a random session identifier are stored, and these counters expire after about 24 hours.",
    `- Quote requests sent with the form are emailed to ${SITE.email} via Resend, like contact-form enquiries, together with the page, language and region of the chat. They are kept as long as needed for the request and any follow-up, at most 12 months unless a contract is concluded.`,
    "- Visitors should not enter sensitive personal data in the chat. Details are in the privacy policy.",
  ].join("\n"),
  de: [
    "- Der Assistent ist eine KI und kann Fehler machen. Verbindlich ist der Festpreis, den Francesco vor Arbeitsbeginn schriftlich festhält.",
    "- Die Chat-Nachrichten gehen an die Anthropic Ireland, Limited (Irland), die als Auftragsbearbeiterin von Modolo Digital Studio die Antworten erzeugt; Anthropic kann die Daten auch in den USA bearbeiten. Nach den kommerziellen Bedingungen von Anthropic werden API-Daten nicht zum Training ihrer Modelle verwendet.",
    "- Mit den Nachrichten übermittelt der Chat die Seite, auf der man sich gerade befindet (nur den Pfad, ohne Parameter), die Chat-Sprache und die Preisregion (Schweiz oder Italien).",
    "- Anthropic bewahrt Nachrichten und Antworten gemäss ihren eigenen Bedingungen für eine begrenzte Zeit auf, vor allem um Missbrauch zu erkennen und zu verhindern, und löscht sie danach.",
    "- Der Server der Website speichert das Gespräch nicht: Es bleibt nur im Sitzungsspeicher (Session Storage) des Browsers, bis der Tab geschlossen wird. Die Logs der Website enthalten nur technische Daten wie Zählwerte, Zeiten und geschätzte Kosten.",
    "- Zur Missbrauchsabwehr werden Anfragen pro IP-Adresse, pro Chat-Sitzung und bei Offertanfragen pro E-Mail-Adresse gezählt. Gespeichert werden nur pseudonymisierte Werte (Hashes) oder eine zufällige Sitzungskennung; diese Zähler verfallen nach etwa 24 Stunden.",
    `- Offertanfragen über das Formular gehen per E-Mail über Resend an ${SITE.email}, wie Anfragen über das Kontaktformular, zusammen mit Seite, Sprache und Region des Chats. Sie werden so lange aufbewahrt, wie es für die Anfrage und die Nachbetreuung nötig ist, höchstens 12 Monate, ausser es kommt ein Vertrag zustande.`,
    "- Bitte keine sensiblen Personendaten in den Chat schreiben. Details stehen in der Datenschutzerklärung.",
  ].join("\n"),
  it: [
    "- L'assistente è un'intelligenza artificiale e può sbagliare. Vale il prezzo fisso che Francesco mette per iscritto prima di iniziare.",
    "- I messaggi della chat vengono inviati ad Anthropic Ireland, Limited (Irlanda), che genera le risposte come responsabile del trattamento per Modolo Digital Studio; Anthropic può trattare i dati anche negli Stati Uniti. Secondo i termini commerciali di Anthropic, i dati inviati tramite API non vengono usati per addestrare i suoi modelli.",
    "- Insieme ai messaggi, la chat invia la pagina in cui si trova il visitatore (solo il percorso, senza parametri), la lingua della chat e la regione dei prezzi (Svizzera o Italia).",
    "- Anthropic conserva messaggi e risposte per un periodo limitato secondo i propri termini, soprattutto per individuare e prevenire abusi, e poi li cancella.",
    "- Il server del sito non salva la conversazione: resta solo nella memoria di sessione del browser finché la scheda non viene chiusa. I log del sito contengono solo dati tecnici come conteggi, tempi e costi stimati.",
    "- Per prevenire abusi, le richieste vengono contate per indirizzo IP, per sessione di chat e, per le richieste di preventivo, per indirizzo email. Si salvano solo valori pseudonimizzati (hash) o un identificativo di sessione casuale, e questi contatori scadono dopo circa 24 ore.",
    `- Le richieste di preventivo inviate con il modulo arrivano via email a ${SITE.email} tramite Resend, come le richieste del modulo di contatto, insieme alla pagina, alla lingua e alla regione della chat. Sono conservate per il tempo necessario a gestire la richiesta e l'eventuale seguito, al massimo 12 mesi, salvo che si concluda un contratto.`,
    "- Meglio non scrivere dati personali sensibili nella chat. I dettagli sono nell'informativa sulla privacy.",
  ].join("\n"),
};

const LINK_LABELS: Record<"home" | "pricing" | "portfolio" | "contact", Tri> = {
  home: { en: "Homepage", de: "Startseite", it: "Homepage" },
  pricing: { en: "Pricing", de: "Preise", it: "Prezzi" },
  portfolio: { en: "Portfolio", de: "Portfolio", it: "Portfolio" },
  contact: { en: "Contact form", de: "Kontaktformular", it: "Modulo di contatto" },
};

// After the link, not inside its label: the model copies labels into sentences, and "under
// [Portfolio (homepage)]" read badly.
const ON_HOMEPAGE: Tri = { en: " (on the homepage)", de: " (auf der Startseite)", it: " (in homepage)" };

function linksText(locale: Locale): string {
  const link = (label: string, path: string) => `- [${label}](${localizedHref(locale, path)})`;
  return [
    link(LINK_LABELS.home[locale], "/"),
    link(LINK_LABELS.pricing[locale], "/prezzi"),
    ...SERVICE_SLUGS.map((slug) => link(SERVICE_META[locale][slug].title, `/servizi/${slug}`)),
    `${link(LINK_LABELS.portfolio[locale], "/#portfolio")}${ON_HOMEPAGE[locale]}`,
    `${link(LINK_LABELS.contact[locale], "/#contatti")}${ON_HOMEPAGE[locale]}`,
    ...LOCAL_CITIES.map((city) => link(LOCAL_AREAS[city].eyebrow[locale], `/webdesign/${city}`)),
    link(LEGAL_META[locale].privacy.title, "/privacy"),
    link(LEGAL_META[locale].impressum.title, "/impressum"),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

// FAQ answers that quote an amount are left out: prices reach the model only from lib/pricing.ts,
// so a stale amount in an FAQ (the working tree already edits one) can never contradict /prezzi.
const CURRENCY_AMOUNT = /(?:CHF|EUR|€)\s?\d|\d\s?(?:CHF|EUR|€)/;

function perRegion(build: (region: Region) => Tri): Record<string, Tri> {
  return Object.fromEntries(REGIONS.map((region) => [region, build(region)]));
}

function createKnowledge(): KnowledgeBase {
  const sections: KnowledgeSection[] = [
    {
      id: "about",
      title: { en: "About Modolo Digital Studio", de: "Über Modolo Digital Studio", it: "Chi è Modolo Digital Studio" },
      content: ABOUT,
      source:
        "components/legal-page.tsx:29,61,93 (sole proprietorship, Winterthur); lib/site.ts:19; lib/local-seo.ts winterthur.intro (restaurants and shops at HEAD; beauty studios in the redesign) + portfolio (beauty studio client); components/home.tsx@HEAD:70,79 / :160,169 / :250,259 and content/home/about.ts (few projects, first message, specialists, 4+ years); lib/pricing.ts:465 (no call centre); lib/local-seo.ts:119-121 (online, written updates, in person)",
    },
    {
      id: "services",
      title: { en: "Services", de: "Leistungen", it: "Servizi" },
      content: perLocale((locale) =>
        [
          SERVICES_INTRO[locale],
          ...SERVICE_SLUGS.map((slug) => `- **${SERVICE_META[locale][slug].title}**: ${SERVICE_DETAILS[slug][locale]}`),
          FREE_CHECK[locale],
        ].join("\n"),
      ),
      source:
        "titles lib/site-data.ts SERVICE_META; includes components/service-page.tsx:87-94,105-112,123-130 (web), 143-151,162-170,181-189 (brand), 200-209,218-227,236-245 (content), 260-273,278-291,296-309 (ads), 318-325,336-343,354-361 (email); ads 'fixed price' SERVICE_META.ads and no ads item in lib/pricing.ts; free Google check components/video-review.tsx:22,31,40 (live) and content/home/offer.ts check (redesign)",
    },
    {
      id: "pricing",
      title: { en: "Packages and prices", de: "Pakete und Preise", it: "Pacchetti e prezzi" },
      content: perLocale((locale) => pricingText(locale, DEFAULT_REGION)),
      byRegion: perRegion((region) => perLocale((locale) => pricingText(locale, region))),
      source:
        "generated from lib/pricing.ts (PRICING_UI, WEBSITES, CARE, BRANDING, GOOD_TO_KNOW minus market-neutral terms, HOURLY, VAT), formatted like components/pricing-page.tsx (THOUSANDS, amount, resolve), first-person copy in the third person (THIRD_PERSON: lib/pricing.ts:147-149,168-172,196-198); 'websites start from' line from the WEBSITES `from` flags (first website package vs the fixed-price Google and booking services); regions without published prices: components/pricing-page.tsx `const region: Region = \"ch\"` (commit 91b4279); phone wording: commit c71e0bc vs lib/pricing.ts:170,172",
    },
    {
      id: "included",
      title: INCLUDED_TITLE,
      content: perLocale(includedText),
      source: "lib/pricing.ts:456-466 (:465 'You always talk to me' in the third person via THIRD_PERSON)",
    },
    {
      id: "process",
      title: { en: "How a project runs", de: "So läuft ein Projekt ab", it: "Come si svolge un progetto" },
      content: PROCESS,
      source:
        "components/home.tsx@HEAD:91-93,181-183,271-273 (method) and content/home/process.ts (redesign: write first, draft before going live, ownership after the final payment); reply time content/home/promises.ts REPLY (weekdays until confirmed); components/guarantee-band.tsx:18,28,38 (few projects, next free start date); lib/pricing.ts:458 (never a template)",
    },
    {
      id: "terms",
      title: {
        en: "Price, payment, ownership and guarantee",
        de: "Preis, Zahlung, Eigentum und Garantie",
        it: "Prezzo, pagamento, proprietà e garanzia",
      },
      content: perLocale((locale) =>
        [
          ...NEUTRAL_TERMS.map((entry) => `- ${entry.label[locale]} — ${entry.value[locale]}`),
          GUARANTEE[locale],
          NO_SUBSCRIPTION[locale],
        ].join("\n"),
      ),
      source:
        "lib/pricing.ts:411-434,443-450 (payment, quotes, revisions, ownership); components/guarantee-band.tsx:14-16,24-26,34-36 narrowed by content/home/process.ts guaranteeText (design phase, drafts stay with Francesco); components/home.tsx@HEAD:48,138,228 (no required subscription); yearly domain and hosting cost in the owner's words: lib/site-data.ts:23,37,51 (working-tree FAQ 'Do I need a subscription?', COPY §11.2)",
    },
    {
      id: "faq",
      title: { en: "Frequently asked questions", de: "Häufige Fragen", it: "Domande frequenti" },
      content: perLocale((locale) =>
        FAQS[locale]
          .filter((qa) => !CURRENCY_AMOUNT.test(qa.a))
          .map((qa) => `- **${qa.q}** ${qa.a}`)
          .join("\n"),
      ),
      source: "lib/site-data.ts FAQS (answers quoting an amount excluded); section titles components/home.tsx@HEAD:96,186,276",
    },
    {
      id: "portfolio",
      title: { en: "Portfolio and reviews", de: "Portfolio und Bewertungen", it: "Portfolio e recensioni" },
      content: PORTFOLIO,
      source:
        "components/home.tsx@HEAD:66-67,156-157,246-247 and content/home/work.ts (redesign); lib/local-seo.ts zuerich.localBody (ZüriKey is Francesco's own app; BJ Studio with WhatsApp booking); reviews components/testimonials.tsx (Google link); client domains deliberately not linked",
    },
    {
      id: "area",
      title: { en: "Service area and languages", de: "Einsatzgebiet und Sprachen", it: "Zona servita e lingue" },
      content: perLocale(areaText),
      source:
        "lib/site-data.ts:26,52,78; lib/local-seo.ts:119-127; lib/site.ts:21-38 (offices, also rendered at components/home.tsx@HEAD:748-752); lib/i18n.ts:9 (site locales)",
    },
    {
      id: "contact",
      title: { en: "Contact and reply time", de: "Kontakt und Antwortzeit", it: "Contatti e tempi di risposta" },
      content: perLocale((locale) => contactText(locale, DEFAULT_REGION)),
      byRegion: perRegion((region) => perLocale((locale) => contactText(locale, region))),
      source:
        "lib/site.ts:10-14; components/use-region.ts (Italian WhatsApp for region it); contact anchor components/home.tsx@HEAD:717; reply time components/home.tsx@HEAD:48,99,105 / 138,189,195 / 228,279,285 and lib/email.ts:19,27,35, narrowed to weekdays per content/home/promises.ts",
    },
    {
      id: "chat",
      title: { en: "About this chat", de: "Über diesen Chat", it: "Su questa chat" },
      content: ABOUT_THIS_CHAT,
      source:
        "canonical privacy facts v2 (2026-11-15, round-2 review PRIV-1/2/3), shared with components/legal-page.tsx (privacy policy, AI assistant section) and the quote form text in lib/assistant/i18n.ts; processor entity: Anthropic Commercial Terms ('Anthropic Ireland, Limited' for customers in Switzerland/EEA); what is sent: lib/assistant/server/prompt.ts dynamicPrompt; counters: lib/assistant/server/guard.ts and app/api/assistant/lead/route.ts; quote email: lib/assistant/server/leads.ts; components/guarantee-band.tsx:15,25,35 (the written fixed price is binding)",
    },
    {
      id: "links",
      title: { en: "Useful links", de: "Nützliche Links", it: "Link utili" },
      content: perLocale(linksText),
      source: "lib/i18n.ts:76-92 (localizedHref); app/sitemap.ts:12-27 (public pages); lib/site-data.ts:92-174,196-233 (titles); lib/local-seo.ts:45,80,115",
    },
  ];
  return { version: `modolo-${KNOWLEDGE_DATE}-${fnv1a(JSON.stringify(sections))}`, sections };
}

/** 32-bit FNV-1a: a short, dependency-free fingerprint of the knowledge for the version string. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

let knowledge: KnowledgeBase | null = null;

/** The Modolo knowledge base, built once per server instance (it only depends on bundled data). */
export function buildModoloKnowledge(): KnowledgeBase {
  knowledge ??= createKnowledge();
  return knowledge;
}
