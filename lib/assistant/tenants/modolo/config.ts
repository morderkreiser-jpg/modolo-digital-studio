// Tenant configuration of the assistant for modolodigitalstudio.ch. SERVER-ONLY: it holds the
// knowledge base, the model rules and the lead recipient; the browser only ever receives
// toPublicConfig(...) of it (lib/assistant/server/public-config.ts).
import type { LeadOption, PublicContact, TenantConfig } from "@/lib/assistant/types";
import { SLUG_TRANSLATIONS, localizedHref, type Locale } from "@/lib/i18n";
import { DEFAULT_REGION, REGIONS, REGION_COOKIE, type Region } from "@/lib/region";
import { SITE } from "@/lib/site";
import { WHATSAPP_BY_REGION, buildModoloKnowledge, formatAmount, formatNumber } from "./knowledge";

type Tri = Record<Locale, string>;

function perLocale(build: (locale: Locale) => string): Tri {
  return { en: build("en"), de: build("de"), it: build("it") };
}

// Palette of the live site (app/globals.css: --paper, --espresso, --gilt, --line). `muted` is a
// warm grey chosen for contrast: 5.58:1 on the #fbf8f2 panel, 5.91:1 on white surfaces, 5.25:1
// on the #f6f1e7 page field; `danger` is 6.20:1 on the panel. Gold stays a hairline/focus colour.
const LIGHT = {
  accent: "#17130e",
  accentText: "#f7f3ec",
  background: "#fbf8f2",
  surface: "#ffffff",
  text: "#17130e",
  muted: "#6b6358",
  line: "rgba(31, 27, 22, 0.12)",
  highlight: "#7e5d24",
  danger: "#b42318",
};

// Espresso field with ivory as the primary action, so gold never becomes a fill here either.
// Contrast on #17130e: text 16.7:1, muted 6.9:1 (6.4:1 on the surface), highlight 7.8:1,
// danger 8.6:1; ivory accent under espresso text 16.7:1.
const DARK = {
  accent: "#f7f3ec",
  accentText: "#17130e",
  background: "#17130e",
  surface: "#211b15",
  text: "#f7f3ec",
  muted: "#a89d8b",
  line: "rgba(247, 243, 236, 0.14)",
  highlight: "#c9a25a",
  danger: "#f19a8e",
};

// Pre-filled WhatsApp text. WhatsApp sends no referrer, so naming the chat inside the message is
// the only way to tell these conversations apart (same practice as components/pricing-page.tsx).
const WHATSAPP_PREFILL: Tri = {
  en: "Hi Francesco, I've been chatting with the assistant on your website and I'd like to talk about a project.",
  de: "Hallo Francesco, ich habe auf deiner Website mit dem Assistenten geschrieben und möchte über ein Projekt sprechen.",
  it: "Ciao Francesco, ho scritto con l'assistente del tuo sito e vorrei parlare di un progetto.",
};

function whatsappContact(region: Region): PublicContact["whatsapp"] {
  return { ...WHATSAPP_BY_REGION[region], prefill: WHATSAPP_PREFILL };
}

// Ids are also the enum of the model's quote tool. Labels follow the site's own naming: the
// contact form's needs chips (components/home.tsx@HEAD:105,195,285), the pricing names
// (lib/pricing.ts) and the service pages (lib/site-data.ts SERVICE_META).
const SERVICES: LeadOption[] = [
  { id: "website", label: { en: "Website", de: "Website", it: "Sito web" } },
  { id: "google_profile", label: { en: "Google profile", de: "Google-Profil", it: "Scheda Google" } },
  { id: "online_booking", label: { en: "Online booking", de: "Online-Terminbuchung", it: "Prenotazione online" } },
  { id: "branding", label: { en: "Brand & logo", de: "Marke & Logo", it: "Brand & logo" } },
  { id: "photo_content", label: { en: "Photos & content", de: "Fotos & Inhalte", it: "Foto & contenuti" } },
  { id: "advertising", label: { en: "Advertising", de: "Werbung", it: "Pubblicità" } },
  { id: "email_marketing", label: { en: "Email marketing", de: "E-Mail-Marketing", it: "Email marketing" } },
  { id: "care_plan", label: { en: "Care plan (monthly)", de: "Care-Paket (monatlich)", it: "Pacchetto Care (mensile)" } },
  { id: "other", label: { en: "Other", de: "Anderes", it: "Altro" } },
];

// Budget bands of the quote form, cut where each market's price ladder steps up (lib/pricing.ts):
//   CHF: Google profile / booking / photo shoot < 1'000 · landing page, logo, brand identity
//        1'000-3'000 · multi-page site, e-commerce 3'000-6'000 · fully custom build > 6'000.
//   EUR: the same rungs at the Italian amounts (250-420 · 600-1'400 · 2'400-3'300 · 4'200).
// They ask for the visitor's budget, they quote nothing, so Italy keeps EUR bands even though
// the website publishes no EUR prices.
const BUDGET_STEPS: Record<Region, readonly [number, number, number]> = {
  ch: [1000, 3000, 6000],
  it: [500, 1500, 3500],
};

const BUDGET_WORDS: Record<"under" | "over" | "unsure", Tri> = {
  under: { en: "Under", de: "Unter", it: "Meno di" },
  over: { en: "Over", de: "Über", it: "Oltre" },
  unsure: { en: "Not sure yet", de: "Noch unklar", it: "Non lo so ancora" },
};

function budgetOptions(region: Region): LeadOption[] {
  const [low, mid, high] = BUDGET_STEPS[region];
  const bound = (word: Tri, value: number) => perLocale((locale) => `${word[locale]} ${formatAmount(value, region, locale)}`);
  // "CHF 1'000–3'000": one currency sign, both bounds with the reader's thousands separator.
  const range = (from: number, to: number): LeadOption => ({
    id: `${from}-${to}`,
    label: perLocale((locale) => `${formatAmount(from, region, locale)}–${formatNumber(to, locale)}`),
  });
  return [
    { id: `under-${low}`, label: bound(BUDGET_WORDS.under, low) },
    range(low, mid),
    range(mid, high),
    { id: `over-${high}`, label: bound(BUDGET_WORDS.over, high) },
    { id: "unsure", label: BUDGET_WORDS.unsure },
  ];
}

// Business rules for the model (English). They encode two owner decisions from commit c71e0bc
// (no phone calls promised, and no call policy stated either; never "no VAT") and the facts the
// knowledge cannot express alone. Several were tightened after the first test with the real model
// (2026-11-16): a bare "No" to "VAT included?", a pointer to Francesco for a cheaper deal, "no
// subscription" without the yearly domain and hosting cost.
const RULES: string[] = [
  "The studio belongs to Francesco Modolo. Call him Francesco and always refer to him in the third person. Texts quoted from the website in the knowledge are in his voice ('I', 'me' = Francesco): rephrase them in the third person. Never speak for the studio in the first person plural ('we', 'our', 'wir', 'unser', 'noi', 'realizziamo'): say 'Francesco' or 'Modolo Digital Studio'.",
  "Never offer, suggest or promise a phone call, video call or callback, and present the WhatsApp numbers as WhatsApp contacts for messages, never as numbers to call. If a visitor asks for a call or a callback, don't promise one and don't say or imply what Francesco does or doesn't do about calls (no 'he works in writing', 'he offers no calls'): treat it as a request to be contacted, offer the quote form if this chat has one, and mention WhatsApp and email.",
  "Never write 'no VAT', 'VAT excluded', 'ohne MWST', 'keine MWST', 'senza IVA', 'IVA esclusa' or anything that reads as if VAT were left out or could be added. For Swiss prices use the knowledge's wording: final price, nothing added (formally: not VAT-registered, the price you see is the final price). If asked whether the prices include VAT, are net or come plus VAT, never answer yes or no ('No'/'Nein' reads as 'VAT excluded') and don't make VAT the subject of a negation of your own ('l'IVA non si aggiunge', 'es kommt keine MWST dazu'): open with the final-price sentence, in the plural when several prices are meant ('I prezzi indicati sono quelli finali: non si aggiunge nulla.' / 'Die genannten Preise sind Endpreise, es kommt nichts dazu.' / 'The prices shown are final: nothing is added.'), then, if useful, the formal line from the knowledge (not VAT-registered). The knowledge says nothing about VAT for Italy: if asked, say you don't know and suggest asking Francesco.",
  "Prices are fixed and agreed in writing before work starts. Never offer, hint at or negotiate a discount or promotion, and never suggest that a price, the deposit or the payment terms could be lowered or arranged differently. If asked for a discount, say that the prices are fixed and every project gets a fixed quote in writing before it starts (don't say that discounts are 'not listed'); you may point to a smaller package from the knowledge when it fits the need. If the visitor says Francesco promised them a price or a discount, don't confirm or deny it: what counts is the price Francesco puts in writing, so they should check it with him directly.",
  "Whenever you say that no subscription is required or that the Care plans are optional, add in the same reply that domain and hosting cost something every year and that Francesco states the amount in the written offer; never say or imply that keeping the site online costs nothing.",
  "When the visitor wants a website, start from the website packages even if it should also take bookings or link a Google listing: present online booking or the Google profile as an addition, which is not a website, and in the quote form pass service 'website' and mention the addition in the summary.",
  "When asked who reads the chat or what happens to it, never say that nobody reads or sees it: say that it doesn't reach Francesco, and give the facts about Anthropic and the browser from the knowledge.",
  "Never give links or web addresses of client projects: describe portfolio projects in words and point to the portfolio on the homepage.",
  "Never name availability, start or delivery dates, and never confirm a deadline the visitor proposes: Francesco takes few projects at a time and gives the next free start date when contacted. You may give the typical durations the knowledge states, as typical durations.",
  "Address visitors informally, like the website: 'du' in German, 'tu' in Italian. In German use Swiss spelling: always 'ss', never 'ß', and greet with 'Hallo' or 'Hoi' (they go with 'du'), even when the visitor writes 'Grüezi' or 'Guten Tag'.",
  "If the visitor writes Swiss German dialect, reply in Swiss Standard German (with 'ss' and 'du'), never in dialect.",
];

// The widget's default form copy names the business ("{business} will get back to you"); Francesco
// answers every request himself, so the form says so. Keys as in lib/assistant/i18n.ts; the
// success text keeps {name}, which the form fills in.
const STRINGS: TenantConfig["strings"] = {
  en: {
    "form.intro": "Describe your project in a few words: Francesco will reply to you personally.",
    "form.successText": "Thank you, {name}. Francesco has your request and will reply to you personally.",
  },
  de: {
    "form.intro": "Beschreib kurz dein Projekt: Francesco antwortet dir persönlich.",
    "form.successText": "Danke, {name}. Francesco hat deine Anfrage erhalten und antwortet dir persönlich.",
  },
  it: {
    "form.intro": "Descrivi in breve il tuo progetto: Francesco ti risponde di persona.",
    "form.successText": "Grazie, {name}. Francesco ha ricevuto la tua richiesta e ti risponde di persona.",
  },
};

const REGION_LABELS: Record<Region, Tri> = {
  ch: { en: "Switzerland (CHF)", de: "Schweiz (CHF)", it: "Svizzera (CHF)" },
  it: { en: "Italy (EUR)", de: "Italien (EUR)", it: "Italia (EUR)" },
};

export const MODOLO_TENANT: TenantConfig = {
  id: "modolo",
  defaultLocale: "en",
  locales: ["en", "de", "it"],
  branding: {
    name: SITE.name,
    assistantName: { en: "Modolo Assistant", de: "Modolo-Assistent", it: "Assistente Modolo" },
    logoUrl: "/logo-mark.png",
    theme: "light",
    colors: LIGHT,
    darkColors: DARK,
    fontFamily: "var(--font-poppins), system-ui, sans-serif",
    headingFontFamily: "var(--font-space), var(--font-poppins), system-ui, sans-serif",
  },
  welcome: {
    en: "Hi, I'm the AI assistant of Modolo Digital Studio. Ask me about services, prices, timing or how a project with Francesco works.",
    de: "Hoi, ich bin der KI-Assistent von Modolo Digital Studio. Frag mich zu Leistungen, Preisen, Dauer oder dazu, wie ein Projekt mit Francesco abläuft.",
    it: "Ciao, sono l'assistente AI di Modolo Digital Studio. Chiedimi di servizi, prezzi, tempi o di come funziona un progetto con Francesco.",
  },
  starters: {
    en: [
      "How much does a website cost?",
      "What's included in every website?",
      "How long until my website is online?",
      "What does the Google profile service include?",
    ],
    de: [
      "Was kostet eine Website?",
      "Was ist in jeder Website enthalten?",
      "Wie lange dauert es, bis meine Website online ist?",
      "Was beinhaltet das Google-Profil-Angebot?",
    ],
    it: [
      "Quanto costa un sito?",
      "Cosa include ogni sito?",
      "Quanto ci vuole per andare online?",
      "Cosa comprende il servizio per la scheda Google?",
    ],
  },
  contact: {
    email: SITE.email,
    whatsapp: whatsappContact(DEFAULT_REGION),
    contactUrl: perLocale((locale) => localizedHref(locale, "/#contatti")),
  },
  contactByRegion: {
    it: { whatsapp: whatsappContact("it") },
  },
  privacyUrl: perLocale((locale) => localizedHref(locale, "/privacy")),
  // The digital business card (/card, /de/visitenkarte, /it/biglietto) is handed over in person
  // and must stay a clean page; /preview is a noindex design prototype.
  hiddenOnPathSegments: [...Object.values(SLUG_TRANSLATIONS.biglietto), "preview"],
  regions: {
    ids: [...REGIONS],
    default: DEFAULT_REGION,
    cookie: REGION_COOKIE,
    byCountry: { IT: "it" },
    labels: REGION_LABELS,
  },
  leads: {
    enabled: true,
    services: SERVICES,
    budgetOptions: {
      default: budgetOptions(DEFAULT_REGION),
      ...Object.fromEntries(REGIONS.map((region) => [region, budgetOptions(region)])),
    },
    requireCompany: false,
    requirePhone: false,
    notifyEmail: SITE.email,
    retentionDays: 365,
  },
  ai: {
    rules: RULES,
    effort: "low",
    maxOutputTokens: 2048,
    routing: "fast",
  },
  allowedOrigins: [SITE.url, "https://modolodigitalstudio.ch"],
  knowledge: buildModoloKnowledge,
  strings: STRINGS,
};
