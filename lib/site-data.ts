// Server-importable, localized copy of the text needed for SEO metadata (<title>/description)
// and JSON-LD structured data, in all three locales. Single source of truth shared by
// generateMetadata (server pages), the JSON-LD builders (lib/json-ld.ts) and the homepage
// FAQ section (components/home/faq.tsx) so the visible content and structured data never drift.
// FAQS = COPY §11.2. They include the other session's price fix (one page CHF 1'690, up to 6 pages
// CHF 4'200): same values, new wording. Plain strings on purpose: they also feed the FAQPage JSON-LD.
import type { ServiceSlug } from "./site";
import type { Locale } from "./i18n";

type QA = { q: string; a: string };

export const FAQS: Record<Locale, QA[]> = {
  de: [
    { q: "Was kostet eine Website?",
      a: "Fixpreise, schriftlich vor dem Start. Google-Profil: CHF 390, oder CHF 690, wenn ich vorbeikomme und die Fotos selbst mache. Website mit einer Seite: ab CHF 1’690. Website mit bis zu 6 Seiten: ab CHF 4’200. Ich bin nicht mehrwertsteuerpflichtig, der genannte Preis ist also der Endpreis. Ein Abo ist nie Pflicht." },
    { q: "Wie lange dauert es?",
      a: "Das Google-Profil richte ich an einem Nachmittag ein, sobald ich Zugang dazu habe; bis Google alles anzeigt, können ein paar Tage vergehen. Eine Website mit einer Seite dauert etwa 1 bis 2 Wochen, eine mit bis zu 6 Seiten etwa 3 bis 4 Wochen, sobald Texte und Fotos da sind. Zu Beginn bekommst du einen Zeitplan, damit du weisst, wo wir stehen." },
    { q: "Womit baust du die Website?",
      a: "Die Website mit einer Seite und die mit bis zu 6 Seiten baue ich mit Framer, einem Programm für professionelles Webdesign. Bei der Website mit bis zu 6 Seiten trägst du News und Aktionen später selbst ein. Signature programmiere ich von Hand (Next.js)." },
    { q: "Gehört mir die Website danach?",
      a: "Ja. Nach der Schlusszahlung gehören dir Domain, Dateien und Zugänge. Willst du eines Tages mit jemand anderem weiterarbeiten, nimmst du alles mit. Bei vielen Abo-Angeboten ist die Website weg, sobald du nicht mehr zahlst, mitsamt deinen Fotos und Texten." },
    { q: "Muss ich ein Abo abschliessen?",
      a: "Nein, nicht bei mir. Betreuung kannst du dazunehmen, ab CHF 49 im Monat, Pflicht ist sie nie. Ohne Betreuung verrechne ich spätere Änderungen nach Aufwand, CHF 120 pro Stunde. Domain und Hosting kosten wie bei jeder Website etwas pro Jahr; den Betrag nenne ich dir in der Offerte." },
    { q: "In welcher Sprache läuft das?",
      a: "Auf Deutsch, Italienisch oder Englisch, wie es dir lieber ist. Das meiste machen wir schriftlich, per WhatsApp und E-Mail, so hast du alles schwarz auf weiss. Wenn ich für Fotos vorbeikomme, sprechen wir Hochdeutsch oder Italienisch." },
  ],
  it: [
    { q: "Quanto costa un sito?",
      a: "Prezzi fissi, per iscritto prima di iniziare. Profilo Google: CHF 390, oppure CHF 690 se vengo io a fare le foto. Sito di una pagina: da CHF 1’690. Sito fino a 6 pagine: da CHF 4’200. In Svizzera non sono soggetto all'IVA, quindi il prezzo in franchi è quello finale. Nessun abbonamento è obbligatorio." },
    { q: "Quanto ci vuole?",
      a: "Il profilo Google lo sistemo in un pomeriggio, da quando ho accesso alla scheda; prima che Google mostri tutto possono passare alcuni giorni. Un sito di una pagina richiede circa 1–2 settimane, un sito fino a 6 pagine circa 3–4 settimane, da quando testi e foto sono pronti. All'inizio ricevi una tabella di marcia, così sai sempre a che punto siamo." },
    { q: "Con che cosa costruisci il sito?",
      a: "Il sito di una pagina e quello fino a 6 pagine li realizzo con Framer, un programma professionale per il web design. Nel sito fino a 6 pagine novità e promozioni le aggiorni tu. Signature lo programmo a mano (Next.js)." },
    { q: "Il sito resta mio?",
      a: "Sì. Dopo il saldo dominio, file e accessi sono tuoi. Se un giorno vuoi lavorare con qualcun altro, ti porti via tutto. Con molti abbonamenti il sito sparisce il giorno in cui smetti di pagare, con dentro le tue foto e i tuoi testi." },
    { q: "Devo fare un abbonamento?",
      a: "No, con me no. L'assistenza puoi aggiungerla, da CHF 49 al mese, ma non è mai obbligatoria. Senza assistenza le modifiche successive le conto a ore, CHF 120 l'ora. Dominio e hosting hanno un costo annuale, come per ogni sito: te lo indico nell'offerta." },
    { q: "In che lingua lavoriamo?",
      a: "In italiano: è la mia lingua. Con i clienti svizzeri scrivo anche in tedesco, e in inglese se serve. Quasi tutto passa per iscritto, su WhatsApp e per e-mail, così hai tutto nero su bianco." },
  ],
  en: [
    { q: "How much does a website cost?",
      a: "Fixed prices, in writing before we start. Google profile: CHF 390, or CHF 690 if I come by and take the photos myself. One-page website: from CHF 1’690. Website of up to 6 pages: from CHF 4’200. I'm not VAT-registered, so the price you read is the final price. A subscription is never required." },
    { q: "How long does it take?",
      a: "I set up the Google profile in one afternoon once I have access to it; Google can take a few days to show everything. A one-page website takes about 1–2 weeks, a website of up to 6 pages about 3–4 weeks, once texts and photos are ready. At the start you get a schedule, so you always know where we stand." },
    { q: "What do you build the website with?",
      a: "The one-page website and the website of up to 6 pages are built with Framer, a professional web design tool. On the 6-page website you update news and offers yourself. Signature is hand-coded (Next.js)." },
    { q: "Do I own the website?",
      a: "Yes. After the final payment the domain, files and logins are yours. If you ever want to work with someone else, you take everything with you. With many subscription offers the website disappears the day you stop paying, along with your photos and texts." },
    { q: "Do I need a subscription?",
      a: "Not with me. Care is optional, from CHF 49 a month. Without it, I bill later changes at CHF 120 per hour. Domain and hosting cost something every year, as with any website; I give you the amount in the offer." },
    { q: "Which language do we work in?",
      a: "English, German or Italian, whichever you prefer. Most of it happens in writing, on WhatsApp and by e-mail, so you have everything in black and white. When I come by for photos, we speak German or Italian." },
  ],
};

// SEO title + description per service, per locale (for <title>/description and Service JSON-LD).
export const SERVICE_META: Record<Locale, Record<ServiceSlug, { title: string; description: string }>> = {
  en: {
    web: {
      title: "Web & Development",
      description:
        "Fast, modern websites optimised for local SEO and Google Business. Web design and development for businesses across Switzerland.",
    },
    brand: {
      title: "Brand & Identity",
      description:
        "Memorable visual identities: logo design, colour and typography systems, brand guidelines, business cards and flyers ready for print.",
    },
    content: {
      title: "Content & Visual",
      description:
        "Photos I shoot myself, plus social media run together with Project Visibility. Content made for your business, not bought from a stock library.",
    },
    ads: {
      title: "Advertising",
      description:
        "Google Ads and Meta campaigns for local businesses: graphics, flyers, short video and a landing page built to convert. Fixed price, your budget stays on your account.",
    },
    email: {
      title: "Email Marketing",
      description:
        "Newsletters and automated email campaigns that turn contacts into customers and grow your business.",
    },
  },
  de: {
    web: {
      title: "Web & Entwicklung",
      description:
        "Schnelle, moderne Websites, optimiert für lokales SEO und Google Business. Webdesign und Entwicklung für Unternehmen in der ganzen Schweiz.",
    },
    brand: {
      title: "Marke & Identität",
      description:
        "Einprägsame visuelle Identitäten: Logodesign, Farb- und Typografiesysteme, Markenrichtlinien, Visitenkarten und Flyer druckfertig.",
    },
    content: {
      title: "Fotos & Social Media",
      description:
        "Fotos, die ich selber mache, und Social-Media-Betreuung zusammen mit Project Visibility. Inhalte für deinen Betrieb, nicht aus einer Bilddatenbank.",
    },
    ads: {
      title: "Werbung",
      description:
        "Kampagnen bei Google Ads und Meta für lokale Betriebe: Sujets, Flyer, kurzes Video und eine Landingpage, die wirkt. Fixpreis, dein Budget bleibt auf deinem Konto.",
    },
    email: {
      title: "E-Mail-Marketing",
      description:
        "Newsletter und automatisierte E-Mail-Kampagnen, die Kontakte in Kunden verwandeln und dein Geschäft wachsen lassen.",
    },
  },
  it: {
    web: {
      title: "Web & Sviluppo",
      description:
        "Siti web veloci e moderni, ottimizzati per la SEO locale e Google Business. Web design e sviluppo per aziende in tutta la Svizzera.",
    },
    brand: {
      title: "Brand & Identità",
      description:
        "Identità visive memorabili: design del logo, sistemi di colore e tipografia, linee guida del brand, biglietti da visita e flyer pronti per la stampa.",
    },
    content: {
      title: "Foto e social media",
      description:
        "Foto che faccio io e gestione social insieme a Project Visibility. Contenuti fatti per la tua attività, non comprati da una banca di immagini.",
    },
    ads: {
      title: "Pubblicità",
      description:
        "Campagne Google Ads e Meta per attività locali: grafiche, flyer, video brevi e una landing page fatta per convertire. Prezzo fisso, il budget resta sul tuo account.",
    },
    email: {
      title: "E-mail marketing",
      description:
        "Newsletter e campagne email automatizzate che trasformano i contatti in clienti e fanno crescere il tuo business.",
    },
  },
};

// SEO title + description for the homepage, per locale (COPY §15). The homepage renders the title
// with `title.absolute`; og:title / og:description use the same strings. The IT title carries no
// price (COPY §15); prices are CHF for every visitor.
export const HOME_META: Record<Locale, { title: string; description: string }> = {
  de: {
    title: "Webdesign Winterthur – Websites ab CHF 1’690 | Modolo",
    description:
      "Ich bringe Google-Profile in Ordnung und baue Websites für Betriebe in Winterthur und Zürich. Fixpreise ab CHF 390, schriftlich vor dem Start.",
  },
  it: {
    title: "Web designer a Winterthur e Zurigo, in italiano | Modolo",
    description:
      "Sistemo i profili Google e creo siti per attività a Winterthur e Zurigo. Si parla italiano. Prezzo fisso, per iscritto prima di iniziare. Tratti solo con me.",
  },
  en: {
    title: "Web Design Winterthur & Zürich – from CHF 1’690 | Modolo",
    description:
      "I sort out Google profiles and build websites for businesses in Winterthur and Zürich. Fixed prices from CHF 390, in writing before we start.",
  },
};

// SEO title + description for the legal pages, per locale.
export const LEGAL_META: Record<Locale, Record<"impressum" | "privacy", { title: string; description: string }>> = {
  en: {
    impressum: {
      title: "Legal Notice",
      description:
        "Legal notice and provider identification for Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur, Switzerland.",
    },
    privacy: {
      title: "Privacy Policy",
      description:
        "Privacy policy for modolodigitalstudio.ch: what personal data we collect, how we process it, and your rights.",
    },
  },
  de: {
    impressum: {
      title: "Impressum",
      description:
        "Impressum und Anbieterkennzeichnung für Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur, Schweiz.",
    },
    privacy: {
      title: "Datenschutz",
      description:
        "Datenschutzerklärung für modolodigitalstudio.ch: welche personenbezogenen Daten wir erheben, wie wir sie verarbeiten und deine Rechte.",
    },
  },
  it: {
    impressum: {
      title: "Note legali",
      description:
        "Note legali e dati del fornitore di Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur, Svizzera.",
    },
    privacy: {
      title: "Privacy",
      description:
        "Informativa sulla privacy di modolodigitalstudio.ch: quali dati personali raccogliamo, come li trattiamo e i tuoi diritti.",
    },
  },
};
