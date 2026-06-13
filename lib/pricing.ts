// Pricing data for the /prezzi page. Two pricing regions (Swiss CHF / Italian EUR) are
// selected by geo (proxy.ts sets the MDS_REGION cookie) with a visible currency toggle.
// Text is localized in all three site locales; amounts are per region (already formatted:
// CHF uses an apostrophe thousands separator, EUR a dot).
import type { Locale } from "./i18n";
import type { Region } from "./region";

// Re-export the region primitives so consumers can import everything pricing-related here.
export { REGIONS, DEFAULT_REGION, REGION_COOKIE, isRegion, CURRENCY } from "./region";
export type { Region };

type Tri = Record<Locale, string>;
// Amounts are raw numbers, formatted per display locale at render time (Intl.NumberFormat)
// so the thousands separator is unambiguous in each language.
type Amount = Record<Region, number>;

export type PriceItem = {
  name: Tri;
  badge?: Tri;
  desc: Tri;
  meta?: Tri; // delivery / unit line
  featured?: boolean; // highlight as the recommended tier
  from: boolean; // show the "from" word before the amount
  price: Amount;
};

export type CarePlan = {
  name: string; // brand name, not translated
  featured?: boolean;
  price: Amount; // per month
  features: Tri[];
};

export type GoodToKnow = {
  label: Tri;
  value: Tri; // may contain {cur}/{amount}/{vat} tokens resolved per region
};

// ---- UI strings -------------------------------------------------------------
export const PRICING_UI: Record<
  Locale,
  {
    metaTitle: string;
    currencyLabel: string;
    metaDescription: string;
    heading1: string;
    headingAccent: string;
    subtitle: string; // contains {cur}
    from: string;
    perMonth: string;
    regionNote: string; // contains {region}
    regionCh: string;
    regionIt: string;
    goodToKnow: string;
    ctaHeading: string;
    ctaText: string;
    ctaContact: string;
    ctaWhatsapp: string;
    notSure: string;
    back: string;
  }
> = {
  en: {
    metaTitle: "Website Pricing — Switzerland/Italy",
    currencyLabel: "Currency",
    metaDescription:
      "Transparent pricing for websites, care plans and branding. Swiss (CHF) and Italian (EUR) rates — web design and development across Switzerland.",
    heading1: "Services & ",
    headingAccent: "pricing",
    subtitle: "Prices in {cur} · excl. VAT · valid 2026",
    from: "from",
    perMonth: "/month",
    regionNote: "Showing {region} prices",
    regionCh: "Switzerland · CHF",
    regionIt: "Italy · EUR",
    goodToKnow: "Good to know",
    ctaHeading: "Ready to stand out?",
    ctaText: "Let's talk about your project — we'll prepare a tailored offer.",
    ctaContact: "Talk to us",
    ctaWhatsapp: "Message us on WhatsApp",
    notSure: "Not sure which package fits? Let's talk.",
    back: "Back to home",
  },
  de: {
    metaTitle: "Website-Preise — Schweiz & Italien",
    currencyLabel: "Währung",
    metaDescription:
      "Transparente Preise für Websites, Care-Pakete und Branding. Preise für die Schweiz (CHF) und Italien (EUR) — Webdesign und Entwicklung.",
    heading1: "Leistungen & ",
    headingAccent: "Preise",
    subtitle: "Preise in {cur} · exkl. MwSt · gültig 2026",
    from: "ab",
    perMonth: "/Monat",
    regionNote: "{region}-Preise werden angezeigt",
    regionCh: "Schweiz · CHF",
    regionIt: "Italien · EUR",
    goodToKnow: "Gut zu wissen",
    ctaHeading: "Bereit, dich abzuheben?",
    ctaText: "Sprich mit uns über dein Projekt — wir erstellen ein massgeschneidertes Angebot.",
    ctaContact: "Sprich mit uns",
    ctaWhatsapp: "Schreib uns auf WhatsApp",
    notSure: "Unsicher, welches Paket passt? Sprich mit uns.",
    back: "Zurück zur Startseite",
  },
  it: {
    metaTitle: "Prezzi siti web — Svizzera e Italia",
    currencyLabel: "Valuta",
    metaDescription:
      "Prezzi trasparenti per siti web, pacchetti care e branding. Tariffe per Svizzera (CHF) e Italia (EUR) — web design e sviluppo.",
    heading1: "Servizi e ",
    headingAccent: "prezzi",
    subtitle: "Prezzi in {cur} · IVA escl. · validi 2026",
    from: "da",
    perMonth: "/mese",
    regionNote: "Stai vedendo i prezzi per {region}",
    regionCh: "Svizzera · CHF",
    regionIt: "Italia · EUR",
    goodToKnow: "Buono a sapersi",
    ctaHeading: "Pronto a farti notare?",
    ctaText: "Parliamo del tuo progetto — ti prepariamo un'offerta su misura.",
    ctaContact: "Parla con noi",
    ctaWhatsapp: "Scrivici su WhatsApp",
    notSure: "Non sai quale pacchetto scegliere? Parliamone.",
    back: "Torna alla home",
  },
};

// ---- 01 · Websites ----------------------------------------------------------
export const WEBSITES = {
  title: { en: "Websites", de: "Websites", it: "Siti Web" } as Tri,
  tagline: {
    en: "design · development · launch",
    de: "Design · Entwicklung · Launch",
    it: "design · sviluppo · lancio",
  } as Tri,
  items: [
    {
      name: { en: "Essential", de: "Essential", it: "Essential" },
      badge: { en: "One page", de: "Eine Seite", it: "Pagina unica" },
      desc: {
        en: "An elegant landing page for professionals and personal brands. Fully responsive, contact form, basic SEO, one revision.",
        de: "Eine elegante Landingpage für Fachleute und Personal Brands. Voll responsive, Kontaktformular, Basis-SEO, eine Revision.",
        it: "Un'elegante landing page per professionisti e brand personali. Totalmente responsive, modulo contatti, SEO di base, una revisione.",
      },
      meta: {
        en: "Delivery ~1–2 weeks · built with Framer",
        de: "Lieferung ~1–2 Wochen · mit Framer umgesetzt",
        it: "Consegna ~1–2 settimane · realizzato con Framer",
      },
      from: true,
      price: { ch: 1900, it: 900 },
    },
    {
      name: { en: "Business", de: "Business", it: "Business" },
      badge: { en: "Multi-page", de: "Mehrseitig", it: "Multi-pagina" },
      featured: true,
      desc: {
        en: "Up to 6 pages with content management for blog/news, SEO setup, refined animations and two revisions. The standard for growing businesses.",
        de: "Bis zu 6 Seiten mit Content-Management für Blog/News, SEO-Setup, sorgfältige Animationen und zwei Revisionen. Der Standard für wachsende Unternehmen.",
        it: "Fino a 6 pagine con gestione contenuti per blog/news, impostazione SEO, animazioni curate e due revisioni. Lo standard per aziende in crescita.",
      },
      meta: {
        en: "Delivery ~3–4 weeks · built with Framer",
        de: "Lieferung ~3–4 Wochen · mit Framer umgesetzt",
        it: "Consegna ~3–4 settimane · realizzato con Framer",
      },
      from: true,
      price: { ch: 3900, it: 2200 },
    },
    {
      name: { en: "Signature", de: "Signature", it: "Signature" },
      badge: { en: "Custom", de: "Massgeschneidert", it: "Su misura" },
      desc: {
        en: "A fully bespoke experience, hand-coded (Next.js): unique design, advanced animations, custom features and multilingual.",
        de: "Ein vollständig massgeschneidertes Erlebnis, von Hand programmiert (Next.js): einzigartiges Design, fortgeschrittene Animationen, individuelle Funktionen und mehrsprachig.",
        it: "Un'esperienza interamente su misura, scritta a mano (Next.js): design unico, animazioni avanzate, funzioni personalizzate e multilingua.",
      },
      meta: {
        en: "Delivery ~6+ weeks · custom development",
        de: "Lieferung ~6+ Wochen · individuelle Entwicklung",
        it: "Consegna ~6+ settimane · sviluppo su misura",
      },
      from: true,
      price: { ch: 8500, it: 4800 },
    },
    {
      name: { en: "E-Commerce", de: "E-Commerce", it: "E-Commerce" },
      desc: {
        en: "Online store with payments, product management and order flow. Scope and platform defined together based on your catalogue.",
        de: "Online-Shop mit Zahlungen, Produktverwaltung und Bestellabwicklung. Umfang und Plattform gemeinsam anhand deines Katalogs definiert.",
        it: "Negozio online con pagamenti, gestione prodotti e flusso ordini. Ambito e piattaforma definiti insieme in base al tuo catalogo.",
      },
      meta: {
        en: "Custom quote",
        de: "Individuelles Angebot",
        it: "Preventivo su misura",
      },
      from: true,
      price: { ch: 6500, it: 3500 },
    },
  ] as PriceItem[],
};

// ---- 02 · Care plans --------------------------------------------------------
export const CARE = {
  title: { en: "Care Plans", de: "Care-Pakete", it: "Pacchetti Care" } as Tri,
  tagline: {
    en: "monthly · a fast, secure, up-to-date site",
    de: "monatlich · schnelle, sichere, aktuelle Website",
    it: "mensili · sito veloce, sicuro e aggiornato",
  } as Tri,
  plans: [
    {
      name: "Care · Light",
      price: { ch: 49, it: 29 },
      features: [
        { en: "Hosting & domain management", de: "Hosting- & Domain-Verwaltung", it: "Gestione hosting & dominio" },
        { en: "Updates, backups & security", de: "Updates, Backups & Sicherheit", it: "Update, backup & sicurezza" },
        { en: "Up to 30 min edits/month", de: "Bis zu 30 Min Änderungen/Monat", it: "Fino a 30 min modifiche/mese" },
        { en: "Email support", de: "E-Mail-Support", it: "Supporto email" },
      ],
    },
    {
      name: "Care · Plus",
      featured: true,
      price: { ch: 129, it: 69 },
      features: [
        { en: "Everything in Light", de: "Alles aus Light", it: "Tutto di Light" },
        { en: "Up to 2 h edits/month", de: "Bis zu 2 Std Änderungen/Monat", it: "Fino a 2 h modifiche/mese" },
        { en: "Monthly analytics report", de: "Monatlicher Analytics-Report", it: "Report analytics mensile" },
        { en: "Priority support", de: "Prioritärer Support", it: "Supporto prioritario" },
      ],
    },
    {
      name: "Care · Pro",
      price: { ch: 249, it: 129 },
      features: [
        { en: "Everything in Plus", de: "Alles aus Plus", it: "Tutto di Plus" },
        { en: "Up to 4 h edits/month", de: "Bis zu 4 Std Änderungen/Monat", it: "Fino a 4 h modifiche/mese" },
        { en: "SEO monitoring", de: "SEO-Monitoring", it: "Monitoraggio SEO" },
        { en: "Monthly strategy call", de: "Monatlicher Strategie-Call", it: "Call strategica mensile" },
      ],
    },
  ] as CarePlan[],
};

// ---- 03 · Branding & content ------------------------------------------------
export const BRANDING = {
  title: { en: "Branding & Content", de: "Branding & Inhalte", it: "Branding & Contenuti" } as Tri,
  tagline: {
    en: "standalone or add-on",
    de: "einzeln oder als Ergänzung",
    it: "singoli o in aggiunta",
  } as Tri,
  items: [
    {
      name: { en: "Logo & Mark", de: "Logo & Marke", it: "Logo & Marchio" },
      desc: {
        en: "A distinctive logo with primary and secondary marks, delivered in all formats.",
        de: "Ein unverwechselbares Logo mit primärer und sekundärer Bildmarke, in allen Formaten geliefert.",
        it: "Un logo distintivo con marchio primario e secondario, consegnato in tutti i formati.",
      },
      from: true,
      price: { ch: 1200, it: 600 },
    },
    {
      name: { en: "Brand Identity", de: "Markenidentität", it: "Identità di Marca" },
      desc: {
        en: "Complete visual identity: logo, colour palette, typography and a mini brand guide.",
        de: "Komplette visuelle Identität: Logo, Farbpalette, Typografie und ein Mini-Brand-Guide.",
        it: "Identità visiva completa: logo, palette colori, tipografia e una mini brand guide.",
      },
      from: true,
      price: { ch: 2500, it: 1400 },
    },
    {
      name: { en: "Photography & Content", de: "Fotografie & Inhalte", it: "Fotografia & Contenuti" },
      desc: {
        en: "On-location photo shoot for products, spaces or team — edited and web-ready.",
        de: "Fotoshooting vor Ort für Produkte, Räume oder Team — bearbeitet und web-fertig.",
        it: "Servizio fotografico sul posto per prodotti, spazi o team — editato e pronto per il web.",
      },
      meta: { en: "half day", de: "halber Tag", it: "a mezza giornata" },
      from: false,
      price: { ch: 900, it: 450 },
    },
    {
      name: { en: "Copywriting", de: "Copywriting", it: "Copywriting" },
      desc: {
        en: "Clear, on-brand copy written for the web, per page.",
        de: "Klare, markengerechte Texte fürs Web, pro Seite.",
        it: "Testi chiari e in linea con il brand, scritti per il web, a pagina.",
      },
      meta: { en: "per page", de: "pro Seite", it: "a pagina" },
      from: true,
      price: { ch: 150, it: 80 },
    },
    {
      name: { en: "Email Marketing Setup", de: "E-Mail-Marketing-Setup", it: "Setup Email Marketing" },
      desc: {
        en: "Newsletter platform, branded template and automations to capture leads.",
        de: "Newsletter-Plattform, gebrandetes Template und Automationen zur Lead-Gewinnung.",
        it: "Piattaforma newsletter, template brandizzato e automazioni per raccogliere contatti.",
      },
      from: true,
      price: { ch: 900, it: 500 },
    },
  ] as PriceItem[],
};

// ---- Good to know (some values resolved per region) -------------------------
// Region tokens: {cur} currency, {hourly} hourly rate, {vat} VAT rate.
export const HOURLY: Amount = { ch: 120, it: 60 };
export const VAT: Record<Region, string> = { ch: "8.1%", it: "22%" };

export const GOOD_TO_KNOW: GoodToKnow[] = [
  {
    label: { en: "Hourly rate", de: "Stundensatz", it: "Tariffa oraria" },
    value: {
      en: "extra work: {cur} {hourly}/h",
      de: "Zusatzarbeiten: {cur} {hourly}/h",
      it: "lavori extra: {cur} {hourly}/h",
    },
  },
  {
    label: { en: "Payment", de: "Zahlung", it: "Pagamento" },
    value: {
      en: "50% upfront, 50% on delivery",
      de: "50% bei Start, 50% bei Lieferung",
      it: "50% all'avvio, 50% alla consegna",
    },
  },
  {
    label: { en: "Quotes", de: "Angebote", it: "Preventivi" },
    value: {
      en: "every project has a fixed quote",
      de: "jedes Projekt hat einen Fixpreis",
      it: "ogni progetto ha un preventivo fisso",
    },
  },
  {
    label: { en: "Revisions", de: "Revisionen", it: "Revisioni" },
    value: {
      en: "included per package",
      de: "pro Paket inklusive",
      it: "incluse per pacchetto",
    },
  },
  {
    label: { en: "VAT", de: "MwSt", it: "IVA" },
    value: {
      en: "prices excl. VAT ({vat}) where applicable",
      de: "Preise exkl. MwSt ({vat}) wo anwendbar",
      it: "prezzi IVA escl. ({vat}) ove applicabile",
    },
  },
  {
    label: { en: "Ownership", de: "Eigentum", it: "Proprietà" },
    value: {
      en: "rights transferred on final payment",
      de: "Rechte gehen mit der Schlusszahlung über",
      it: "diritti ceduti al saldo finale",
    },
  },
];
