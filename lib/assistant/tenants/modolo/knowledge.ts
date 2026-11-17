// Business knowledge of Modolo Digital Studio for the AI assistant. SERVER-ONLY at runtime.
//
// Where the facts come from (never from memory):
//   - packages, prices, care plans, terms and the "every website includes" list are GENERATED
//     from lib/pricing.ts, so a change on /preise reaches the assistant with the next deploy
//     (its first-person copy is put in the third person on the way: THIRD_PERSON below), and
//     every amount is printed by the site's own formatPrice (content/home/prices.ts);
//   - the reply time and the delivery time of the free Google-check video come from
//     content/home/promises.ts (REPLY_TEXT, VIDEO_TEXT), the same constants the homepage uses;
//   - FAQ, service titles and legal page titles from lib/site-data.ts, contacts and addresses
//     from lib/site.ts, the labels of the /webdesign/* links from lib/local-seo.ts, every link
//     from localizedHref (lib/i18n.ts);
//   - the rest of the site's copy is written in Francesco's first person (content/home/*,
//     components/service-page.tsx, components/legal-page.tsx), so it is transcribed here in the
//     third person; each section's `source` cites the file with a line or, for files that
//     change often (lib/pricing.ts, content/home/offer.ts), the constant (checked 2026-11-17).
//     data/reviews.ts is not read.
// The version carries a hash of every section, so a change in the imported data changes it too.
// Bump KNOWLEDGE_DATE when transcribed copy is edited.
import { formatPrice } from "@/content/home/prices";
import { REPLY_TEXT, VIDEO_TEXT } from "@/content/home/promises";
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
const KNOWLEDGE_DATE = "2026-11-17";

/** One text per site locale, built by the same function (adding a locale is a compile error here). */
function perLocale(build: (locale: Locale) => string): Tri {
  return { en: build("en"), de: build("de"), it: build("it") };
}

// ---------------------------------------------------------------------------------------------
// Regions and money
// ---------------------------------------------------------------------------------------------

/**
 * The region whose price list the website shows to EVERY visitor, visitors from Italy included:
 * components/pricing-page.tsx:35 (`const region: Region = "ch"`, since commit 91b4279, 2026-07-10)
 * and the homepage (components/home/offer.tsx:40-42 and content/home/hero.ts:8-9 build their
 * prices with buildPrices("ch", lang)). The visitor's region changes only the WhatsApp number,
 * here as on the site, and the EUR amounts of lib/pricing.ts are published nowhere, so they never
 * reach the model. If a page ever shows a region its own price list, build the pricing section
 * per region again (byRegion) in the same commit, with that region's own VAT line (the
 * GOOD_TO_KNOW VAT entry is a Swiss tax status; see also the VAT rule in config.ts).
 */
export const PRICE_LIST_REGION: Region = "ch";

/** WhatsApp number per region: Italian visitors get the Italian line, like the site (components/use-region.ts). */
export const WHATSAPP_BY_REGION: Record<Region, { number: string; display: string }> = {
  ch: { number: SITE.phone, display: SITE.phoneDisplay },
  it: { number: SITE.phoneIt, display: SITE.phoneItDisplay },
};

/**
 * An amount exactly as the site prints it, by the site's own formatter (content/home/prices.ts
 * formatPrice, also used by components/pricing-page.tsx): "CHF 1’690", with U+2019 as the
 * thousands mark and a no-break space after the currency, in every locale.
 */
export function formatAmount(value: number, region: Region, locale: Locale): string {
  return formatPrice(value, region, locale);
}

/** The same amount without its currency ("1’690"), for the upper bound of a range ("CHF 1’000–3’000"). */
export function formatNumber(value: number, region: Region, locale: Locale): string {
  return formatAmount(value, region, locale).replace(/^\D+/, "");
}

/** Resolves the {cur}/{hourly}/{vat} tokens of lib/pricing.ts like the pricing page's `resolve()`. */
function fillTokens(text: string, locale: Locale): string {
  const region = PRICE_LIST_REGION;
  return text
    .replaceAll("{cur} {hourly}", formatAmount(HOURLY[region], region, locale))
    .replaceAll("{hourly}", formatNumber(HOURLY[region], region, locale))
    .replaceAll("{cur}", CURRENCY[region])
    .replaceAll("{vat}", VAT[region]);
}

function priceText(item: { from: boolean; price: Record<Region, number> }, locale: Locale): string {
  const amount = formatAmount(item.price[PRICE_LIST_REGION], PRICE_LIST_REGION, locale);
  return item.from ? `${PRICING_UI[locale].from} ${amount}` : amount;
}

/**
 * lib/pricing.ts speaks in Francesco's voice ("I come to you", "You always deal with me"); the
 * assistant is not Francesco, and a first-person line in its knowledge invites it to speak as him.
 * So every first-person passage of that copy is swapped for a faithful third-person version,
 * exact string for exact string, in every section built from lib/pricing.ts (price list,
 * inclusions and terms). A source edit that makes a pair stop matching fails
 * tests/assistant/tenants.test.ts (every pair must still match, and no first-person passage of
 * lib/pricing.ts may reach the rendered knowledge) until the pair is updated. Italian verbs carry
 * no pronoun ("Configuro", "restituisco"), so those passages need a pair of their own.
 */
export const THIRD_PERSON: Record<Locale, ReadonlyArray<readonly [from: string, to: string]>> = {
  en: [
    ["I come to you", "Francesco comes to you"],
    ["You send me your photos; I do the rest.", "You send Francesco your photos; he does the rest."],
    [
      "but I come to you: I shoot the 8–10 photos myself at your place, write the German and Italian text, and set the whole thing up.",
      "but Francesco comes to you: he shoots the 8–10 photos himself at your place, writes the German and Italian text, and sets the whole thing up.",
    ],
    [
      "I set up the booking tool with your services, durations and breaks, put it on your website and wire the Book button into your Google listing.",
      "Francesco sets up the booking tool with your services, durations and breaks, puts it on your website and wires the Book button into your Google listing.",
    ],
    ["You always deal with me, never a call centre", "You always deal with Francesco directly, never a call centre"],
    ["and I give you the amount in the offer", "and Francesco gives you the amount in the offer"],
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
    ["Du hast immer mit mir zu tun, nie mit einem Callcenter", "Du hast immer direkt mit Francesco zu tun, nie mit einem Callcenter"],
    ["den Betrag nenne ich dir in der Offerte", "den Betrag nennt dir Francesco in der Offerte"],
  ],
  it: [
    ["Vengo io da te", "Francesco viene da te"],
    ["Le foto me le mandi tu, al resto penso io.", "Le foto le mandi tu a Francesco, al resto pensa lui."],
    [
      // Includes the second sentence: «per accordarci» is a first person plural too.
      "ma vengo io: faccio io le 8–10 foto da te, scrivo il testo in tedesco e italiano e imposto tutto. Il tuo impegno: dieci minuti per accordarci e venti sul posto.",
      "ma viene Francesco di persona: fa lui le 8–10 foto da te, scrive il testo in tedesco e italiano e imposta tutto. Il tuo impegno: dieci minuti per accordarsi e venti sul posto.",
    ],
    [
      "Configuro lo strumento con i tuoi servizi, le durate e le pause, lo metto sul sito e collego il pulsante Prenota alla tua scheda Google.",
      "Francesco configura lo strumento con i tuoi servizi, le durate e le pause, lo mette sul sito e collega il pulsante Prenota alla tua scheda Google.",
    ],
    ["Tratti sempre con me, mai con un call center", "Tratti sempre direttamente con Francesco, mai con un call center"],
    ["ti restituisco l'acconto", "Francesco ti restituisce l'acconto"],
    ["che ti indico nell'offerta", "che Francesco ti indica nell'offerta"],
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

// GOOD_TO_KNOW entries that are project terms: they get their own section. Anything else (the
// hourly rate, the VAT line, any entry added later) stays next to the price list, since it may
// carry an amount or a Swiss-only statement.
const TERM_LABELS: ReadonlySet<string> = new Set(["Quotes", "Payment", "Revisions", "Ownership"]);
const TERMS = GOOD_TO_KNOW.filter((entry) => TERM_LABELS.has(entry.label.en));
const PRICE_LIST_NOTES = GOOD_TO_KNOW.filter((entry) => !TERM_LABELS.has(entry.label.en));

/**
 * One package line. `metaIsUnit`: branding metas are units ("half day", "per page") that belong
 * next to the price; website metas are delivery notes that close the line.
 */
function packageLine(item: PriceItem, locale: Locale, metaIsUnit: boolean): string {
  const meta = item.meta?.[locale];
  const badge = item.badge?.[locale];
  const name = `**${item.name[locale]}**${badge ? ` (${badge})` : ""}`;
  const unit = metaIsUnit && meta ? ` (${meta})` : "";
  const delivery = !metaIsUnit && meta ? ` (${meta})` : "";
  return `- ${name}: ${priceText(item, locale)}${unit}. ${item.desc[locale]}${delivery}`;
}

function careLine(plan: CarePlan, locale: Locale): string {
  const price = `${formatAmount(plan.price[PRICE_LIST_REGION], PRICE_LIST_REGION, locale)}${PRICING_UI[locale].perMonth}`;
  return `- **${plan.name}**: ${price}. ${plan.features.map((feature) => feature[locale]).join(" · ")}.`;
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
function websitesStartLine(locale: Locale): string | null {
  const firstWebsite = WEBSITES.items.find((item) => item.from);
  if (!firstWebsite) return null;
  const badge = firstWebsite.badge?.[locale];
  const copy = WEBSITES_START[locale];
  const start = copy.start
    .replace("{amount}", formatAmount(firstWebsite.price[PRICE_LIST_REGION], PRICE_LIST_REGION, locale))
    .replace("{package}", `**${firstWebsite.name[locale]}**${badge ? `, ${badge}` : ""}`);
  const entries = WEBSITES.items.filter((item) => !item.from).map((item) => `**${item.name[locale]}**`);
  if (entries.length === 0) return start;
  return `${start} ${(entries.length === 1 ? copy.one : copy.many).replace("{names}", joinList(entries, locale))}`;
}

// What every price is, said once next to the amounts (it holds for every region): a fixed price for
// the work, in writing before the start (content/home/offer.ts lead, content/home/process.ts
// guaranteeFooter). Domain and hosting as the only running costs come from lib/pricing.ts itself
// (the subtitle and the "Domain & hosting" note) and from the FAQ (NO_SUBSCRIPTION below).
const PRICE_PRINCIPLE: Tri = {
  en: "Every price is a fixed price for the work, given in writing before work starts.",
  de: "Jeder Preis ist ein Fixpreis für die Arbeit, schriftlich vor dem Start.",
  it: "Ogni prezzo è un prezzo fisso per il lavoro, per iscritto prima di iniziare.",
};

// CHF for every visitor (lib/site-data.ts:142-144, components/home/offer.tsx:40-42): the region
// of a visitor from Italy changes only the WhatsApp number (see PRICE_LIST_REGION).
const CHF_FOR_EVERYONE: Tri = {
  en: "The website shows its prices in CHF to every visitor, visitors from Italy included. For a business in Italy, Francesco confirms the fixed price in writing before work starts.",
  de: "Die Website zeigt die Preise allen in CHF, auch Besucherinnen und Besuchern aus Italien. Für einen Betrieb in Italien bestätigt Francesco den Fixpreis schriftlich vor Arbeitsbeginn.",
  it: "Il sito mostra i prezzi in CHF a tutti, anche a chi visita dall'Italia. Per un'attività in Italia Francesco conferma il prezzo fisso per iscritto prima di iniziare.",
};

/** The price list of the website, the same for every region (see PRICE_LIST_REGION). */
function pricingText(locale: Locale): string {
  const websitesStart = websitesStartLine(locale);
  const lines = [
    `${fillTokens(PRICING_UI[locale].subtitle, locale)}.`,
    PRICE_PRINCIPLE[locale],
    CHF_FOR_EVERYONE[locale],
    "",
    groupHeading(WEBSITES, locale),
    ...(websitesStart ? [websitesStart] : []),
    ...WEBSITES.items.map((item) => packageLine(item, locale, false)),
    "",
    groupHeading(CARE, locale),
    ...CARE.plans.map((plan) => careLine(plan, locale)),
    "",
    groupHeading(BRANDING, locale),
    ...BRANDING.items.map((item) => packageLine(item, locale, true)),
  ];
  if (PRICE_LIST_NOTES.length > 0) {
    lines.push(
      "",
      `${PRICING_UI[locale].goodToKnow}:`,
      ...PRICE_LIST_NOTES.map((entry) => `- ${entry.label[locale]} — ${fillTokens(entry.value[locale], locale)}`),
    );
  }
  return inThirdPerson(lines.join("\n"), locale);
}

/** The "every website includes" list of lib/pricing.ts, in the third person. */
function includedText(locale: Locale): string {
  return inThirdPerson(INCLUDED.map((item) => `- ${item[locale]}`).join("\n"), locale);
}

/** The project terms of lib/pricing.ts (GOOD_TO_KNOW), in the third person. */
function termsText(locale: Locale): string {
  return inThirdPerson(TERMS.map((entry) => `- ${entry.label[locale]} — ${entry.value[locale]}`).join("\n"), locale);
}

// ---------------------------------------------------------------------------------------------
// Transcribed copy (first-person site copy in the third person; sources cited per section)
// ---------------------------------------------------------------------------------------------

const ABOUT: Tri = {
  en: [
    "- Modolo Digital Studio is the web studio of Francesco Modolo (founder, web designer and developer), a sole proprietorship based in Winterthur, Switzerland.",
    "- He builds websites, sorts out Google profiles and makes brands and content for small local businesses and professionals, for example restaurants, shops and beauty studios.",
    "- He has been building websites for small businesses across Switzerland for over four years. Code, design and SEO he does himself, and he takes the photos himself too (for example the 8–10 photos of the on-site Google profile); when a project needs it, for bigger shoots or video, a trusted professional photographer and videomaker joins him.",
    "- He takes on only a few projects at a time and handles each one personally, from the first message to the day the site goes live. Clients always deal with him: no agency, no call centre.",
    "- Most of the work happens online, with written updates; when it makes sense he meets clients in person.",
  ].join("\n"),
  de: [
    "- Modolo Digital Studio ist das Web-Studio von Francesco Modolo (Gründer, Webdesigner und Entwickler), ein Einzelunternehmen mit Sitz in Winterthur.",
    "- Er baut Websites, bringt Google-Profile in Ordnung und gestaltet Marken und Inhalte für kleine lokale Betriebe und Fachleute, zum Beispiel Restaurants, Läden und Kosmetikstudios.",
    "- Seit über vier Jahren baut er Websites für kleine Betriebe in der ganzen Schweiz. Code, Design und SEO macht er selbst, die Fotos ebenfalls (zum Beispiel die acht bis zehn Fotos beim Google-Profil vor Ort); wenn ein Projekt es braucht, etwa für grössere Shootings oder Videos, holt er einen Fotografen und Videomaker dazu, dem er vertraut.",
    "- Er nimmt nur wenige Projekte auf einmal an und betreut jedes persönlich, von der ersten Nachricht bis zum Tag, an dem die Website online geht. Ansprechperson ist immer er: keine Agentur, kein Callcenter.",
    "- Der grösste Teil läuft online, mit schriftlichen Updates; wenn es Sinn macht, trifft er Kundinnen und Kunden persönlich.",
  ].join("\n"),
  it: [
    "- Modolo Digital Studio è lo studio web di Francesco Modolo (fondatore, web designer e sviluppatore), ditta individuale con sede a Winterthur, in Svizzera.",
    "- Costruisce siti, sistema profili Google e cura brand e contenuti per piccole attività locali e professionisti, per esempio ristoranti, negozi e centri estetici.",
    "- Da oltre quattro anni costruisce siti per piccole attività in tutta la Svizzera. Codice, design e SEO li fa lui, e anche le foto (per esempio le 8–10 foto del Profilo Google da te); quando un progetto lo richiede, per shooting più grandi o video, lo affianca un fotografo e videomaker di fiducia.",
    "- Prende pochi progetti alla volta e li segue uno per uno di persona, dal primo messaggio al giorno in cui il sito va online. Il referente è sempre lui: niente agenzia, niente call center.",
    "- Gran parte del lavoro è online, con aggiornamenti scritti; quando ha senso incontra i clienti di persona.",
  ].join("\n"),
};

const SERVICES_INTRO: Tri = {
  en: "Five service areas, each with its own page (see Useful links). Website packages, the Google profile service, online booking and the care plans are in the section Packages and prices.",
  de: "Fünf Leistungsbereiche, jeder mit eigener Seite (siehe Nützliche Links). Website-Pakete, das Google-Profil-Angebot, die Online-Terminbuchung und die Care-Pakete stehen im Abschnitt Pakete und Preise.",
  it: "Cinque aree di servizio, ognuna con la sua pagina (vedi Link utili). Pacchetti sito, servizio Profilo Google, prenotazione online e pacchetti Care sono nella sezione Pacchetti e prezzi.",
};

const SERVICE_DETAILS: Record<ServiceSlug, Tri> = {
  // No amount here: the Care plans and the Google profile service are priced in Packages and prices.
  web: {
    en: "custom web design tailored to your brand; high-performance development (fast, secure, mobile-first); local SEO optimisation to rank in your area; Google listing linked to the site; responsive layouts that look great on every device; care after launch only if you want it, as a monthly Care plan (see Packages and prices). Setting up or sorting out the Google profile itself is the separate Google profile service.",
    de: "massgeschneidertes Webdesign, abgestimmt auf deine Marke; performante Entwicklung (schnell, sicher, mobile-first); lokale SEO-Optimierung für deine Region; Google-Eintrag mit der Website verknüpft; responsive Layouts, die auf jedem Gerät überzeugen; Betreuung nach dem Launch nur, wenn du willst, als monatliches Care-Paket (siehe Pakete und Preise). Das Google-Profil selbst einrichten oder in Ordnung bringen gehört zum separaten Google-Profil-Angebot.",
    it: "web design su misura, in linea con il tuo brand; sviluppo performante (veloce, sicuro, mobile-first); ottimizzazione SEO locale per emergere nella tua zona; scheda Google collegata al sito; layout responsive, perfetti su ogni dispositivo; assistenza dopo il lancio solo se la vuoi, con un pacchetto Care mensile (vedi Pacchetti e prezzi). Configurare o sistemare il profilo Google è il servizio Profilo Google, a parte.",
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

// Two different promises, as on the homepage (content/home/promises.ts): replies come within 24
// hours every day (REPLY, confirmed by Francesco on 2026-11-16), the free Google-check video only
// Monday to Friday until he confirms weekends too (VIDEO). Flipping either flag there changes the
// sentences here with the next deploy.
const FREE_CHECK: Tri = {
  en: `- **Free Google check, on video**: send Francesco the name and town of your business on WhatsApp. He searches for it on Google the way a customer would and records his screen: what Google shows, what's missing and the three things he'd change first. You get the video on WhatsApp ${VIDEO_TEXT.en.long}. Free, no obligation: a video Francesco records himself, not an automated report; no appointment, no subscription.`,
  de: `- **Gratis Google-Check per Video**: Schick Francesco auf WhatsApp den Namen und den Ort deines Betriebs. Er sucht ihn auf Google wie ein Kunde und nimmt dabei seinen Bildschirm auf: was Google zeigt, was fehlt und die drei Dinge, die er zuerst ändern würde. Das Video bekommst du ${VIDEO_TEXT.de.long} per WhatsApp. Gratis und unverbindlich: ein Video, das Francesco selbst aufnimmt, keine automatische Analyse; kein Termin, kein Abo.`,
  it: `- **Controllo Google gratuito, in video**: manda a Francesco su WhatsApp il nome e la località della tua attività. La cerca su Google come farebbe un cliente e registra lo schermo: cosa mostra Google, cosa manca e le tre cose che sistemerebbe per prime. Il video ti arriva su WhatsApp ${VIDEO_TEXT.it.long}. Gratis e senza impegno: un video registrato da Francesco, non un'analisi automatica; nessun appuntamento, nessun abbonamento.`,
};

const PROCESS: Tri = {
  en: [
    `1. You write to Francesco (WhatsApp, email or the contact form) about your business and what you need. He replies ${REPLY_TEXT.en.long}, says whether and how he can help and, when he knows enough, gives you the fixed price straight away. No commitment.`,
    "2. You see the design before anything goes live: tailor-made, never a template. You tell him what to change.",
    "3. He builds the site and puts it online. After the final payment the domain, files and logins are yours. Care is optional: without a Care plan, later changes are billed by the hour (hourly rate under Packages and prices).",
    "- Availability: Francesco takes on only a few projects at a time and tells you the next free start date when you write to him. No start dates are published.",
  ].join("\n"),
  de: [
    `1. Du schreibst Francesco (WhatsApp, E-Mail oder Kontaktformular), was dein Betrieb macht und was du brauchst. Er antwortet ${REPLY_TEXT.de.long}, sagt dir, ob und wie er helfen kann, und nennt dir den Fixpreis gleich, wenn er genug weiss. Keine Verpflichtung.`,
    "2. Du siehst das Design, bevor etwas online geht: massgeschneidert, nie eine Vorlage. Du sagst ihm, was er ändern soll.",
    "3. Er baut die Website und bringt sie online. Nach der Schlusszahlung gehören dir Domain, Dateien und Zugänge. Betreuung (Care-Paket) kannst du dazunehmen, musst aber nicht; ohne Betreuung werden spätere Änderungen nach Aufwand verrechnet (Stundensatz unter Pakete und Preise).",
    "- Verfügbarkeit: Francesco nimmt nur wenige Projekte auf einmal an und nennt dir den nächsten freien Starttermin, wenn du ihm schreibst. Starttermine sind nicht veröffentlicht.",
  ].join("\n"),
  it: [
    `1. Scrivi a Francesco (su WhatsApp, via email o con il modulo di contatto) cosa fa la tua attività e cosa ti serve. Risponde ${REPLY_TEXT.it.long}, ti dice se e come può aiutarti e, quando sa abbastanza, ti dice subito il prezzo fisso. Nessun impegno.`,
    "2. Vedi il design prima che qualcosa vada online: su misura, mai un template. Gli dici tu cosa cambiare.",
    "3. Costruisce il sito e lo mette online. Dopo il saldo, dominio, file e accessi sono tuoi. L'assistenza (pacchetto Care) puoi aggiungerla, ma non sei obbligato; senza assistenza le modifiche successive si pagano a ore (tariffa oraria in Pacchetti e prezzi).",
    "- Disponibilità: Francesco prende pochi progetti alla volta e ti dice la prima data libera quando gli scrivi. Le date di inizio non sono pubblicate.",
  ].join("\n"),
};

// The guarantee as the homepage states it (content/home/process.ts guaranteeText: design phase
// only, drafts stay with Francesco), with its footer (guaranteeFooter: fixed price, in writing
// before the start).
const GUARANTEE: Tri = {
  en: "- Guarantee: if the first design draft doesn't convince you, Francesco makes a new one; if the second doesn't either, you stop: you get your deposit back and the drafts stay with Francesco. This applies in the design phase, before the website goes live. The fixed price for the work is agreed up front and put in writing: that's what you pay for it, no surprises at the end. The site is yours, with no lock-in: if you ever want to move on, you take it with you.",
  de: "- Garantie: Überzeugt dich der erste Entwurf nicht, macht Francesco einen neuen; überzeugt auch der zweite nicht, hört ihr auf: Du bekommst die Anzahlung zurück, und die Entwürfe bleiben bei Francesco. Das gilt in der Designphase, bevor die Website online geht. Der Fixpreis für die Arbeit wird vorher festgelegt und schriftlich festgehalten: Den zahlst du dafür, keine Überraschungen am Schluss. Die Website gehört dir, ohne Bindung: Willst du eines Tages wechseln, nimmst du sie mit.",
  it: "- Garanzia: se la prima bozza di design non ti convince, Francesco ne fa una nuova; se non ti convince nemmeno la seconda, vi fermate: ti restituisce l'acconto e le bozze restano a lui. Vale nella fase di design, prima che il sito vada online. Il prezzo fisso per il lavoro si decide prima e lui lo mette per iscritto: quello paghi, nessuna sorpresa alla fine. Il sito è tuo, senza vincoli: se un giorno vuoi cambiare, te lo porti via.",
};

// "Hosting & domain set up for you" (INCLUDED) next to "no subscription" reads as "no running
// costs", so the owner's own disclosure goes with it: the FAQ answer "Do I need a subscription?"
// (lib/site-data.ts:23,37,51), which the FAQ filter drops because it quotes amounts (Care · Light
// and the hourly rate, which reach the model from lib/pricing.ts).
const NO_SUBSCRIPTION: Tri = {
  en: "- No subscription is required: the Care plans are optional; without one, later changes are billed by the hour (hourly rate under Packages and prices). Domain and hosting cost something every year, as with any website; Francesco states the amount in the written offer.",
  de: "- Ein Abo ist nie Pflicht: Die Care-Pakete sind freiwillig; ohne Betreuung werden spätere Änderungen nach Aufwand verrechnet (Stundensatz unter Pakete und Preise). Domain und Hosting kosten wie bei jeder Website etwas pro Jahr; den Betrag nennt Francesco in der Offerte.",
  it: "- Nessun abbonamento è obbligatorio: i pacchetti Care sono facoltativi; senza, le modifiche successive si pagano a ore (tariffa oraria in Pacchetti e prezzi). Dominio e hosting hanno un costo annuale, come per ogni sito: Francesco lo indica nell'offerta.",
};

// Only the projects the published homepage shows (content/home/work.ts with the flags in
// data/projects.ts) and the sites its film shows (lib/film-media.ts FILM.projects): a project the
// site hides is never named here. No review numbers: the homepage shows a selection, the full
// count and average live on Google.
const PORTFOLIO: Tri = {
  en: [
    "- **BJ Studio de Belleza** (client · beauty studio · Zürich): a website with the treatments and prices, a «Termin buchen» button that opens WhatsApp directly, and local SEO so people in Zürich find the studio.",
    "- **ZüriKey** (web app · Zürich): Francesco's own project, built and run by him, not a client job. It helps flat-hunters in Zürich put together a rental dossier and a cover letter in German, ready as a PDF.",
    `- The film at the top of the homepage shows the real websites of BJ Studio de Belleza (client) and ZüriKey (Francesco's own project). The hands and rooms in it come from licensed stock footage (Pexels); the people filmed have no connection with Modolo Digital Studio (credits in the ${LEGAL_META.en.impressum.title}).`,
    "- Reviews: clients' Google reviews are shown on the homepage, and all of them can be read on Google.",
  ].join("\n"),
  de: [
    "- **BJ Studio de Belleza** (Kundin · Kosmetikstudio · Zürich): Website mit den Behandlungen und Preisen, einem Knopf «Termin buchen», der direkt WhatsApp öffnet, und lokalem SEO, damit man das Studio in Zürich findet.",
    "- **ZüriKey** (Web-App · Zürich): Francescos eigenes Projekt, von ihm gebaut und betrieben, kein Kundenauftrag. Es hilft Wohnungssuchenden in Zürich, ein Mietdossier und ein Bewerbungsschreiben auf Deutsch als PDF zusammenzustellen.",
    `- Der Film oben auf der Startseite zeigt die echten Websites von BJ Studio de Belleza (Kundin) und ZüriKey (Francescos eigenes Projekt). Die Hände und Räume im Film stammen aus lizenzierten Stockaufnahmen (Pexels); die gefilmten Personen haben keine Verbindung zu Modolo Digital Studio (Angaben im ${LEGAL_META.de.impressum.title}).`,
    "- Bewertungen: Google-Bewertungen von Kundinnen und Kunden stehen auf der Startseite; alle lassen sich auf Google nachlesen.",
  ].join("\n"),
  it: [
    "- **BJ Studio de Belleza** (cliente · centro estetico · Zurigo): sito con i trattamenti e i prezzi, un pulsante «Termin buchen» che apre direttamente WhatsApp e SEO locale per farsi trovare a Zurigo.",
    "- **ZüriKey** (web app · Zurigo): un progetto di Francesco, costruito e gestito da lui, non un lavoro per un cliente. Aiuta chi cerca casa a Zurigo a preparare un dossier d'affitto e una lettera in tedesco, pronti in PDF.",
    `- Il video in cima alla homepage mostra i siti veri di BJ Studio de Belleza (cliente) e ZüriKey (progetto di Francesco). Le mani e gli ambienti del video vengono da riprese stock con licenza (Pexels); le persone riprese non hanno alcun legame con Modolo Digital Studio (dettagli nelle ${LEGAL_META.it.impressum.title}).`,
    "- Recensioni: le recensioni Google dei clienti sono in homepage, e si possono leggere tutte su Google.",
  ].join("\n"),
};

/** Country names per region; also the region labels of the tenant (config.ts). */
export const COUNTRY: Record<Region, Tri> = {
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
      `- Reply time: Francesco replies personally, ${REPLY_TEXT.en.long}. Getting in touch is without obligation.`,
    ].join("\n"),
    de: [
      `- WhatsApp (Nachrichten): ${whatsapp.display}, [WhatsApp](${wa})`,
      `- E-Mail: ${mail}`,
      `- Kontaktformular auf der Startseite: [Kontaktformular](${form})`,
      `- Antwortzeit: Francesco antwortet persönlich, ${REPLY_TEXT.de.long}. Eine Anfrage ist unverbindlich.`,
    ].join("\n"),
    it: [
      `- WhatsApp (messaggi): ${whatsapp.display}, [WhatsApp](${wa})`,
      `- Email: ${mail}`,
      `- Modulo di contatto in homepage: [modulo di contatto](${form})`,
      `- Tempi di risposta: Francesco risponde di persona, ${REPLY_TEXT.it.long}. Il primo contatto è senza impegno.`,
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
    "- Der Assistent ist eine KI und kann Fehler machen. Verbindlich ist der Fixpreis, den Francesco vor Arbeitsbeginn schriftlich festhält.",
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
// so a stale amount in an FAQ can never contradict /preise.
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
        "components/legal-page.tsx:75,108,141 (sole proprietorship, Winterthur); lib/site.ts:19; lib/local-seo.ts:48-52 winterthur.intro (restaurants, shops, beauty studios); content/home/about.ts:29,44,59 (few projects, first message to go-live, one contact, specialists when a job needs them) and :36,51,66 (4+ years; code, design and SEO himself); photos taken by him: lib/pricing.ts WEBSITES (Google Profile On Site), components/service-page.tsx:201,219,237, lib/local-seo.ts:55-57, content/home/offer.ts rungs (rung 1 `second`); photographer and videomaker for bigger shoots and video: content/home/about.ts:29,36,44,51,59,66; lib/pricing.ts INCLUDED (no call centre); lib/local-seo.ts:119-121 (online, written updates, in person)",
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
        "titles lib/site-data.ts SERVICE_META; includes components/service-page.tsx:87-94,105-112,123-130 (web: Google listing linked to the site, care after launch only if wanted), 143-151,162-170,181-189 (brand), 200-209,218-227,236-245 (content), 260-273,278-291,296-309 (ads), 318-325,336-343,354-361 (email); ads 'fixed price' SERVICE_META.ads and no ads item in lib/pricing.ts; free Google check content/home/offer.ts OFFER[locale].check, with the video time from content/home/promises.ts VIDEO_TEXT",
    },
    {
      id: "pricing",
      title: { en: "Packages and prices", de: "Pakete und Preise", it: "Pacchetti e prezzi" },
      content: perLocale(pricingText),
      source:
        "generated from lib/pricing.ts (PRICING_UI, WEBSITES, CARE, BRANDING, GOOD_TO_KNOW minus the terms, HOURLY, VAT) for region ch, the list the site shows to every visitor (components/pricing-page.tsx:35, components/home/offer.tsx:40-42); amounts by content/home/prices.ts formatPrice; first-person copy in the third person (THIRD_PERSON: WEBSITES descriptions and badge, GOOD_TO_KNOW 'Domain & hosting'); 'websites start from' line from the WEBSITES `from` flags (first website package vs the fixed-price Google and booking services); fixed price for the work: content/home/offer.ts OFFER[locale].lead and content/home/process.ts:29,43,57; domain and hosting yearly: PRICING_UI subtitle, GOOD_TO_KNOW and lib/site-data.ts:23,37,51; CHF for every visitor: lib/site-data.ts:142-144",
    },
    {
      id: "included",
      title: INCLUDED_TITLE,
      content: perLocale(includedText),
      source: "lib/pricing.ts INCLUDED_TITLE and INCLUDED (the last entry, 'You always deal with me', in the third person via THIRD_PERSON)",
    },
    {
      id: "process",
      title: { en: "How a project runs", de: "So läuft ein Projekt ab", it: "Come si svolge un progetto" },
      content: PROCESS,
      source:
        "content/home/process.ts:22-26,36-40,50-54 (write first, draft before going live, ownership after the final payment, care optional); reply time content/home/promises.ts REPLY_TEXT; later changes by the hour without care: lib/site-data.ts:23,37,51; few projects at a time: content/home/about.ts:29,44,59; next free start date on request: owner rule (config.ts RULES, dates); lib/pricing.ts INCLUDED (never a template)",
    },
    {
      id: "terms",
      title: {
        en: "Price, payment, ownership and guarantee",
        de: "Preis, Zahlung, Eigentum und Garantie",
        it: "Prezzo, pagamento, proprietà e garanzia",
      },
      content: perLocale((locale) => [termsText(locale), GUARANTEE[locale], NO_SUBSCRIPTION[locale]].join("\n")),
      source:
        "lib/pricing.ts GOOD_TO_KNOW Payment, Quotes, Revisions, Ownership (the Italian Payment line in the third person via THIRD_PERSON); guarantee content/home/process.ts:28,42,56 (guaranteeText: design phase only, drafts stay with Francesco) and :29,43,57 (guaranteeFooter: fixed price in writing before the start, no required subscription); yearly domain and hosting cost and later changes by the hour, in the owner's words: lib/site-data.ts:23,37,51",
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
      source: "lib/site-data.ts FAQS (answers quoting an amount excluded); section titles content/home/faq-section.ts",
    },
    {
      id: "portfolio",
      title: { en: "Portfolio and reviews", de: "Portfolio und Bewertungen", it: "Portfolio e recensioni" },
      content: PORTFOLIO,
      source:
        "content/home/work.ts (BJ Studio client, WhatsApp booking, local SEO; ZüriKey own web app, not a client job); lib/local-seo.ts:90-92 zuerich.localBody; film: lib/film-media.ts:97-100 FILM.projects and components/legal-page.tsx:25-51 (Impressum credit: Pexels footage, people unrelated to the studio, real sites on the screens); reviews components/home/reviews.tsx (verbatim Google reviews, link to the Google profile); client domains deliberately not linked",
    },
    {
      id: "area",
      title: { en: "Service area and languages", de: "Einsatzgebiet und Sprachen", it: "Zona servita e lingue" },
      content: perLocale(areaText),
      source: "lib/site-data.ts:25,39,53 (FAQ language answers); lib/local-seo.ts:119-127; lib/site.ts:21-39 (offices); lib/i18n.ts:9 (site locales)",
    },
    {
      id: "contact",
      title: { en: "Contact and reply time", de: "Kontakt und Antwortzeit", it: "Contatti e tempi di risposta" },
      content: perLocale((locale) => contactText(locale, DEFAULT_REGION)),
      byRegion: perRegion((region) => perLocale((locale) => contactText(locale, region))),
      source:
        "lib/site.ts:10-14; components/use-region.ts and components/home/contact.tsx:66 (Italian WhatsApp for region it); contact anchor components/home/contact.tsx:32; reply time content/home/promises.ts REPLY_TEXT (every day) and lib/email.ts:19,27,35",
    },
    {
      id: "chat",
      title: { en: "About this chat", de: "Über diesen Chat", it: "Su questa chat" },
      content: ABOUT_THIS_CHAT,
      source:
        "canonical privacy facts v2 (2026-11-15, round-2 review PRIV-1/2/3), shared with components/legal-page.tsx (privacy policy, AI assistant section) and the quote form text in lib/assistant/i18n.ts; processor entity: Anthropic Commercial Terms ('Anthropic Ireland, Limited' for customers in Switzerland/EEA); what is sent: lib/assistant/server/prompt.ts dynamicPrompt; counters: lib/assistant/server/guard.ts and app/api/assistant/lead/route.ts; quote email: lib/assistant/server/leads.ts; the written fixed price is binding: content/home/process.ts:29,43,57",
    },
    {
      id: "links",
      title: { en: "Useful links", de: "Nützliche Links", it: "Link utili" },
      content: perLocale(linksText),
      source: "lib/i18n.ts:76-92 (localizedHref); app/sitemap.ts:12-27 (public pages); lib/site-data.ts:58-140,164-201 (titles); lib/local-seo.ts:45,80,115",
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
