// Server-importable, localized copy of the text needed for SEO metadata (<title>/description)
// and JSON-LD structured data, in all three locales. Single source of truth shared by
// generateMetadata (server pages), the JSON-LD builders (lib/json-ld.ts) and the homepage
// FAQ section (components/home.tsx) so the visible content and structured data never drift.
import type { ServiceSlug } from "./site";
import type { Locale } from "./i18n";

type QA = { q: string; a: string };

export const FAQS: Record<Locale, QA[]> = {
  en: [
    {
      q: "How much does a website cost?",
      a: "Fixed prices, agreed before we start. Google listing sorted: CHF 390, or CHF 690 if I come to you and shoot the photos myself. A 3-6 page website: CHF 1,690. A complete website: CHF 4,200. I am not VAT-registered, so the price you read is the final price, and a subscription is never required.",
    },
    {
      q: "Do I own the website?",
      a: "Yes, completely: domain, files, access. If you stop working with me one day, everything stays with you and you take it wherever you like. That is not the norm: with many subscriptions the site disappears the day you stop paying, along with your photos and your copy.",
    },
    {
      q: "How long until the website is online?",
      a: "It depends on the complexity, but a showcase website usually takes 2 to 4 weeks once we have the materials. At the start we set a roadmap together, so you always know where we stand.",
    },
    {
      q: "Do you work all over Switzerland?",
      a: "Yes. I work with clients across Switzerland, remotely and in person when needed. Distance is no problem: most of the work happens online, with regular calls and updates — and you always talk to me.",
    },
    {
      q: "Will the website be optimised for Google?",
      a: "Yes — every website I build is SEO-optimised from the start: clean structure, fast loading and a tidy Google Business profile so you get found nearby. Getting found is half the battle.",
    },
    {
      q: "What happens after the website goes live?",
      a: "I don't disappear. I offer support and maintenance to keep your site secure and up to date, and I'm here for changes or new ideas. One person to message: me.",
    },
  ],
  de: [
    {
      q: "Was kostet eine Website?",
      a: "Feste Preise, vor dem Start vereinbart. Google-Eintrag eingerichtet: CHF 390, oder CHF 690, wenn ich für die Fotos zu dir komme. Website mit 3 bis 6 Seiten: CHF 1’690. Komplette Website: CHF 4’200. Ich bin nicht mehrwertsteuerpflichtig, der genannte Preis ist also der Endpreis — und ein Abo ist nie Pflicht.",
    },
    {
      q: "Gehört die Website danach mir?",
      a: "Ja, vollständig: Domain, Dateien, Zugänge. Wenn du eines Tages nicht mehr mit mir arbeitest, bleibt alles bei dir und du nimmst es mit. Das ist nicht überall so: Bei vielen Abos ist die Website weg, sobald du aufhörst zu zahlen — mitsamt deinen Fotos und Texten.",
    },
    {
      q: "Wie lange dauert es, bis die Website online ist?",
      a: "Das hängt von der Komplexität ab, aber eine Präsentationswebsite dauert meist 2 bis 4 Wochen, sobald wir die Materialien haben. Zu Beginn legen wir zusammen einen Fahrplan fest, damit du immer weisst, wo wir stehen.",
    },
    {
      q: "Arbeitest du in der ganzen Schweiz?",
      a: "Ja. Ich betreue Kunden in der ganzen Schweiz, remote und bei Bedarf persönlich. Distanz ist kein Problem: Der grösste Teil läuft online, mit regelmässigen Calls und Updates — und du sprichst immer mit mir.",
    },
    {
      q: "Wird die Website für Google optimiert?",
      a: "Ja — jede Website, die ich baue, ist von Anfang an SEO-optimiert: saubere Struktur, schnelle Ladezeit und ein aufgeräumtes Google-Unternehmensprofil, damit du in der Umgebung gefunden wirst. Gefunden zu werden ist die halbe Miete.",
    },
    {
      q: "Was passiert, nachdem die Website online ist?",
      a: "Ich verschwinde nicht. Ich biete Support und Wartung, damit deine Website sicher und aktuell bleibt, und bin für Änderungen oder neue Ideen da. Eine einzige Ansprechperson: ich.",
    },
  ],
  it: [
    {
      q: "Quanto costa realizzare un sito web?",
      a: "Prezzi fissi, decisi prima di iniziare. Scheda Google sistemata: CHF 390, oppure CHF 690 se vengo io a fare le foto da te. Sito di 3-6 pagine: CHF 1’690. Sito completo: CHF 4’200. Non sono soggetto a IVA, quindi il prezzo che leggi è quello finale, e nessun abbonamento è mai obbligatorio.",
    },
    {
      q: "Il sito resta mio?",
      a: "Sì, tutto: dominio, file, accessi. Se un giorno smetti di lavorare con me, resta tuo e te lo porti dove vuoi. Non funziona così ovunque: con molti abbonamenti il sito sparisce il giorno che smetti di pagare, con dentro le tue foto e i tuoi testi.",
    },
    {
      q: "Quanto tempo serve per andare online?",
      a: "Dipende dalla complessità, ma in genere un sito vetrina richiede dalle 2 alle 4 settimane da quando abbiamo i materiali. All'inizio fissiamo insieme una tabella di marcia, così sai sempre a che punto siamo.",
    },
    {
      q: "Lavori in tutta la Svizzera?",
      a: "Sì. Seguo clienti in tutta la Svizzera, da remoto e di persona quando serve. La distanza non è un problema: gran parte del lavoro è online, con call e aggiornamenti costanti — e rispondo sempre io.",
    },
    {
      q: "Il sito sarà ottimizzato per Google?",
      a: "Sì — ogni sito che costruisco nasce ottimizzato per la SEO: struttura corretta, caricamento veloce e Google Business a posto per farti trovare in zona. Farti trovare è metà del lavoro.",
    },
    {
      q: "Cosa succede dopo che il sito è online?",
      a: "Non sparisco. Ti offro assistenza e manutenzione per tenere il sito sicuro e aggiornato, e resto a disposizione per modifiche o nuove idee. Una sola persona a cui scrivere: io.",
    },
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
      title: "Content & Visual",
      description:
        "Fotos, die ich selber mache, und Social-Media-Betreuung zusammen mit Project Visibility. Inhalte für deinen Betrieb, nicht aus einer Bilddatenbank.",
    },
    ads: {
      title: "Werbung",
      description:
        "Kampagnen bei Google Ads und Meta für lokale Betriebe: Sujets, Flyer, kurzes Video und eine Landingpage, die wirkt. Festpreis, dein Budget bleibt auf deinem Konto.",
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
      title: "Contenuti & Visual",
      description:
        "Foto che faccio io e gestione social insieme a Project Visibility. Contenuti fatti per la tua attività, non comprati da una banca di immagini.",
    },
    ads: {
      title: "Pubblicità",
      description:
        "Campagne Google Ads e Meta per attività locali: grafiche, flyer, video brevi e una landing page fatta per convertire. Prezzo fisso, il budget resta sul tuo account.",
    },
    email: {
      title: "Email Marketing",
      description:
        "Newsletter e campagne email automatizzate che trasformano i contatti in clienti e fanno crescere il tuo business.",
    },
  },
};

// SEO title + description for the homepage, per locale.
export const HOME_META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Modolo Digital Studio | Web Design & Development in Switzerland",
    description:
      "Independent web studio in Winterthur. Websites, brands and content built by hand for professionals and small businesses across Switzerland — one project at a time.",
  },
  de: {
    title: "Modolo Digital Studio | Webdesign & Entwicklung in der Schweiz",
    description:
      "Unabhängiges Web-Studio in Winterthur. Von Hand gebaute Websites, Marken und Inhalte für Fachleute und kleine Unternehmen in der ganzen Schweiz.",
  },
  it: {
    title: "Modolo Digital Studio | Web Design & Sviluppo in Svizzera",
    description:
      "Studio web indipendente a Winterthur. Siti, brand e contenuti costruiti a mano per professionisti e piccole attività in tutta la Svizzera — un progetto alla volta.",
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
