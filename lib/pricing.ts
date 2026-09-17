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
    subtitle: "Prices in {cur} · final price, no VAT · valid 2026",
    from: "from",
    perMonth: "/month",
    regionNote: "Showing {region} prices",
    regionCh: "Switzerland · CHF",
    regionIt: "Italy · EUR",
    goodToKnow: "Good to know",
    ctaHeading: "Ready to stand out?",
    ctaText: "Tell me about your project — I'll prepare a tailored offer.",
    ctaContact: "Write to me",
    ctaWhatsapp: "Message me on WhatsApp",
    notSure: "Not sure which package fits? Write to me.",
    back: "Back to home",
  },
  de: {
    metaTitle: "Website-Preise — Schweiz & Italien",
    currencyLabel: "Währung",
    metaDescription:
      "Transparente Preise für Websites, Care-Pakete und Branding. Preise für die Schweiz (CHF) und Italien (EUR) — Webdesign und Entwicklung.",
    heading1: "Leistungen & ",
    headingAccent: "Preise",
    subtitle: "Preise in {cur} · Endpreis, keine MWST · gültig 2026",
    from: "ab",
    perMonth: "/Monat",
    regionNote: "{region}-Preise werden angezeigt",
    regionCh: "Schweiz · CHF",
    regionIt: "Italien · EUR",
    goodToKnow: "Gut zu wissen",
    ctaHeading: "Bereit, dich abzuheben?",
    ctaText: "Erzähl mir von deinem Projekt — ich mache dir ein massgeschneidertes Angebot.",
    ctaContact: "Schreib mir",
    ctaWhatsapp: "Schreib mir auf WhatsApp",
    notSure: "Unsicher, welches Paket passt? Schreib mir.",
    back: "Zurück zur Startseite",
  },
  it: {
    metaTitle: "Prezzi siti web — Svizzera e Italia",
    currencyLabel: "Valuta",
    metaDescription:
      "Prezzi trasparenti per siti web, pacchetti care e branding. Tariffe per Svizzera (CHF) e Italia (EUR) — web design e sviluppo.",
    heading1: "Servizi e ",
    headingAccent: "prezzi",
    subtitle: "Prezzi in {cur} · prezzo finale, senza IVA · validi 2026",
    from: "da",
    perMonth: "/mese",
    regionNote: "Stai vedendo i prezzi per {region}",
    regionCh: "Svizzera · CHF",
    regionIt: "Italia · EUR",
    goodToKnow: "Buono a sapersi",
    ctaHeading: "Pronto a farti notare?",
    ctaText: "Parlami del tuo progetto — ti preparo un'offerta su misura.",
    ctaContact: "Scrivimi",
    ctaWhatsapp: "Scrivimi su WhatsApp",
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
      // Entry rung: the one price that can be named cold, at a door or on the phone.
      // Fixed (not "from"), delivered in an afternoon, and every delivery earns a review.
      name: {
        en: "Google Profile Start",
        de: "Google-Profil Start",
        it: "Google Profile Start",
      },
      badge: { en: "Entry step", de: "Einstieg", it: "Primo passo" },
      desc: {
        en: "Your Google listing, sorted: correct opening hours, a description in German and Italian, your services, and a contact button that works from a phone. You send me your photos; I do the rest.",
        de: "Dein Google-Eintrag, sauber gemacht: korrekte Öffnungszeiten, Beschreibung auf Deutsch und Italienisch, deine Leistungen und ein Kontakt-Button, der auf dem Handy funktioniert. Die Fotos schickst du mir; den Rest mache ich.",
        it: "La tua scheda Google sistemata: orari giusti, descrizione in tedesco e italiano, i tuoi servizi e un pulsante di contatto che funziona dal telefono. Le foto me le mandi tu, al resto penso io.",
      },
      meta: {
        en: "One-off setup · delivered in one afternoon · fixed price",
        de: "Lieferung an einem Nachmittag · Fixpreis",
        it: "Consegnato in un pomeriggio · prezzo fisso",
      },
      from: false,
      price: { ch: 390, it: 250 },
    },
    {
      // La visita è ciò che nessun concorrente della piazza vende sotto i 5'000: Hyperpage
      // include il servizio fotografico solo dal pacchetto ab 5'090. È il gradino che la
      // lettera SHAB propone, ed è l'unico posizionamento difendibile — chi entra nel negozio.
      name: {
        en: "Google Profile On Site",
        de: "Google-Profil vor Ort",
        it: "Google Profile in loco",
      },
      badge: { en: "I come to you", de: "Ich komme vorbei", it: "Vengo io da te" },
      desc: {
        en: "Everything in Google Profile Start, but I come to you: I shoot the 8–10 photos myself at your place, write the German and Italian text, and set the whole thing up. Your effort: ten minutes on the phone and twenty on site.",
        de: "Alles aus Google-Profil Start, aber ich komme zu dir: Ich mache die acht bis zehn Fotos selber bei dir, schreibe den deutschen und italienischen Text und richte alles ein. Dein Aufwand: zehn Minuten am Telefon und zwanzig vor Ort.",
        it: "Tutto quello di Google Profile Start, ma vengo io: faccio io le 8–10 foto da te, scrivo il testo in tedesco e italiano e imposto tutto. Il tuo impegno: dieci minuti al telefono e venti sul posto.",
      },
      meta: {
        en: "Photos and text included · fixed price",
        de: "Fotos und Text inklusive · Fixpreis",
        it: "Foto e testi inclusi · prezzo fisso",
      },
      from: false,
      price: { ch: 690, it: 420 },
    },
    {
      // L'unico servizio adiacente con una misura di DOMANDA e non solo di offerta: lo studio
      // localsearch/HSLU, misurato automaticamente su 47'079 siti svizzeri, trova che solo il 36%
      // delle PMI ha un sito e che di quelle solo il 7% ha uno strumento di prenotazione.
      // Si vende il SETUP, mai il software: il canone del tool lo paga il cliente al fornitore.
      // Costruirlo su misura sarebbe la trappola — i concorrenti gratuiti esistono (Cal.com,
      // Timify Classic), quindi il valore sta nella configurazione, non nel codice.
      name: {
        en: "Online Booking, set up",
        de: "Online-Terminbuchung, eingerichtet",
        it: "Prenotazione online, configurata",
      },
      badge: { en: "New", de: "Neu", it: "Nuovo" },
      desc: {
        en: "Your customers book themselves, day and night. I set up the booking tool with your services, durations and breaks, put it on your website and wire the Book button into your Google listing. You get a short video showing how to change anything.",
        de: "Deine Kundschaft bucht selber, Tag und Nacht. Ich richte das Buchungstool mit deinen Leistungen, Dauern und Pausen ein, baue es in deine Website und verbinde den Termin-Button mit deinem Google-Eintrag. Dazu ein kurzes Video, wie du alles selber änderst.",
        it: "I tuoi clienti prenotano da soli, giorno e notte. Configuro lo strumento con i tuoi servizi, le durate e le pause, lo metto sul sito e collego il pulsante Prenota alla tua scheda Google. In più un video breve per cambiare tutto da solo.",
      },
      meta: {
        en: "Tool subscription paid by you, direct to the provider",
        de: "Das Tool-Abo zahlst du direkt beim Anbieter",
        it: "L'abbonamento allo strumento lo paghi tu, direttamente al fornitore",
      },
      from: false,
      price: { ch: 690, it: 390 },
    },
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
      price: { ch: 1690, it: 950 },
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
      price: { ch: 4200, it: 2400 },
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
      price: { ch: 7400, it: 4200 },
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
      price: { ch: 5900, it: 3300 },
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
        { en: "Email support", de: "E-Mail-Support", it: "Supporto email" },
        { en: "Edits billed by the hour", de: "Änderungen nach Aufwand", it: "Modifiche a ore" },
      ],
    },
    {
      name: "Care · Plus",
      featured: true,
      price: { ch: 149, it: 79 },
      features: [
        { en: "Everything in Light", de: "Alles aus Light", it: "Tutto di Light" },
        { en: "Up to 1 h edits/month", de: "Bis zu 1 Std Änderungen/Monat", it: "Fino a 1 h modifiche/mese" },
        { en: "Monthly analytics report", de: "Monatlicher Analytics-Report", it: "Report analytics mensile" },
        { en: "Priority support", de: "Prioritärer Support", it: "Supporto prioritario" },
      ],
    },
    {
      name: "Care · Pro",
      price: { ch: 290, it: 149 },
      features: [
        { en: "Everything in Plus", de: "Alles aus Plus", it: "Tutto di Plus" },
        { en: "Up to 2 h edits/month", de: "Bis zu 2 Std Änderungen/Monat", it: "Fino a 2 h modifiche/mese" },
        { en: "SEO monitoring", de: "SEO-Monitoring", it: "Monitoraggio SEO" },
        { en: "Quarterly review, in writing", de: "Quartals-Review, schriftlich", it: "Punto trimestrale, per iscritto" },
      ],
    },
    {
      // Il lavoro che oggi vende una volta sola a 390/690 e poi abbandona. Il mercato svizzero e'
      // gia' educato a pagarlo a canone: heise regioconcept lo vende a 55/109/159/369 al mese con
      // durata minima 12 mesi. Regola operativa: si lavora A BLOCCHI, cinque clienti nella stessa
      // mezza giornata. Cliente per cliente, a 1.5 h l'uno, rende 86 CHF/ora e quindi ci si rimette.
      name: "Google · Care",
      price: { ch: 129, it: 69 },
      features: [
        { en: "4 posts per quarter", de: "4 Beiträge pro Quartal", it: "4 post a trimestre" },
        { en: "Photos and hours kept current", de: "Fotos und Öffnungszeiten aktuell", it: "Foto e orari sempre aggiornati" },
        { en: "Replies to reviews within 48 h", de: "Antwort auf Bewertungen in 48 Std", it: "Risposta alle recensioni in 48 h" },
        { en: "Monthly report, in writing", de: "Monatsreport, schriftlich", it: "Report mensile, per iscritto" },
        { en: "12 months minimum", de: "Mindestlaufzeit 12 Monate", it: "Durata minima 12 mesi" },
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
      price: { ch: 690, it: 350 },
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
      price: { ch: 190, it: 95 },
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
      en: "50% upfront, 50% on delivery — two design rounds; deposit back if neither convinces you",
      de: "50% bei Start, 50% bei Lieferung — zwei Design-Runden; Anzahlung zurück, wenn keine überzeugt",
      it: "50% all'avvio, 50% alla consegna — due giri di design; acconto indietro se nessuno convince",
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
      en: "not VAT-registered — the price you see is the final price",
      de: "nicht mehrwertsteuerpflichtig — der genannte Preis ist der Endpreis",
      it: "non soggetto a IVA — il prezzo indicato è quello finale",
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

// Baseline inclusions in EVERY website — the "what you always get" band. Research finding: a
// transparent, fully-scoped list of inclusions is the #1 lever that makes a Swiss SME owner feel
// good about the price (and signals a thorough professional, not a beginner).
export const INCLUDED_TITLE: Tri = { en: "Every website includes", de: "In jeder Website enthalten", it: "Ogni sito include" };
export const INCLUDED: Tri[] = [
  { en: "Tailor-made design, never a template", de: "Massgeschneidertes Design, nie eine Vorlage", it: "Design su misura, mai un template" },
  { en: "Fast and flawless on every phone", de: "Schnell und einwandfrei auf jedem Handy", it: "Veloce e perfetto su ogni telefono" },
  { en: "Optimised for Google (SEO built in)", de: "Für Google optimiert (SEO inklusive)", it: "Ottimizzato per Google (SEO inclusa)" },
  { en: "Google listing linked to the site", de: "Google-Eintrag mit der Website verknüpft", it: "Scheda Google collegata al sito" },
  { en: "Contact form + WhatsApp link", de: "Kontaktformular + WhatsApp-Anbindung", it: "Modulo contatti + WhatsApp" },
  { en: "Hosting & domain set up for you", de: "Hosting & Domain für dich eingerichtet", it: "Hosting e dominio configurati per te" },
  { en: "Revisions included in the fixed price", de: "Revisionen im Festpreis inbegriffen", it: "Revisioni incluse nel prezzo fisso" },
  { en: "You always talk to me — no call centre", de: "Du sprichst immer mit mir — kein Callcenter", it: "Parli sempre con me, mai un call center" },
];
