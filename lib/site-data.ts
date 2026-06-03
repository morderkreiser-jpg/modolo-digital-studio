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
      a: "Every project is tailor-made, so the price depends on your needs: number of pages, features and content to create. That's why we offer a free initial consultation: you tell us about your project and we prepare a clear quote, with no surprises.",
    },
    {
      q: "How long does it take to get the website online?",
      a: "It depends on the complexity, but a showcase website usually takes 2 to 4 weeks from gathering the materials. At the start we define a roadmap together, so you always know where we stand.",
    },
    {
      q: "Do you work all over Switzerland?",
      a: "Yes. We work with clients across Switzerland, remotely and in person when needed. Distance is never an obstacle: most of the work happens online, with regular calls and updates.",
    },
    {
      q: "Do you also handle copy and photography?",
      a: "Absolutely. We can take care of content from start to finish, with professional photo shoots and copywriting. For social media we partner with Project Visibility, specialists in content and page management.",
    },
    {
      q: "Will the website be optimized for Google?",
      a: "Yes, every website we build is SEO-optimized from the start: correct structure, fast loading and Google Business setup to help you get found locally. A strong online presence starts here.",
    },
    {
      q: "What happens after the website goes live?",
      a: "We don't leave you on your own. We offer support and maintenance to keep your site secure and up to date, and we're always available for changes or new ideas. We build lasting relationships, not throwaway projects.",
    },
  ],
  de: [
    {
      q: "Was kostet eine Website?",
      a: "Jedes Projekt ist massgeschneidert, daher hängt der Preis von deinen Bedürfnissen ab: Anzahl der Seiten, Funktionen und zu erstellende Inhalte. Deshalb bieten wir eine kostenlose Erstberatung an: Du erzählst uns von deinem Projekt und wir erstellen ein klares Angebot, ohne Überraschungen.",
    },
    {
      q: "Wie lange dauert es, bis die Website online ist?",
      a: "Das hängt von der Komplexität ab, aber eine Präsentationswebsite dauert in der Regel 2 bis 4 Wochen ab dem Zusammenstellen der Materialien. Zu Beginn legen wir gemeinsam einen Fahrplan fest, damit du immer weisst, wo wir stehen.",
    },
    {
      q: "Arbeitet ihr in der ganzen Schweiz?",
      a: "Ja. Wir betreuen Kunden in der ganzen Schweiz, remote und bei Bedarf persönlich. Distanz ist nie ein Hindernis: Der grösste Teil der Arbeit findet online statt, mit regelmässigen Calls und Updates.",
    },
    {
      q: "Kümmert ihr euch auch um Texte und Fotos?",
      a: "Selbstverständlich. Wir können die Inhalte von Anfang bis Ende übernehmen, mit professionellen Fotoshootings und Texterstellung. Für Social Media arbeiten wir mit Project Visibility zusammen, Spezialisten für Content und Seitenbetreuung.",
    },
    {
      q: "Wird die Website für Google optimiert?",
      a: "Ja, jede Website, die wir erstellen, ist von Anfang an SEO-optimiert: korrekte Struktur, schnelle Ladezeiten und Google-Business-Einrichtung, damit du lokal gefunden wirst. Eine starke Online-Präsenz beginnt hier.",
    },
    {
      q: "Was passiert, nachdem die Website online ist?",
      a: "Wir lassen dich nicht allein. Wir bieten Support und Wartung, um deine Website sicher und aktuell zu halten, und stehen jederzeit für Änderungen oder neue Ideen zur Verfügung. Wir bauen langfristige Beziehungen auf, keine Wegwerfprojekte.",
    },
  ],
  it: [
    {
      q: "Quanto costa realizzare un sito web?",
      a: "Ogni progetto è su misura, quindi il prezzo dipende dalle tue esigenze: numero di pagine, funzionalità e contenuti da creare. Per questo offriamo una prima consulenza gratuita: ci racconti il tuo progetto e ti prepariamo un preventivo chiaro, senza sorprese.",
    },
    {
      q: "Quanto tempo serve per avere il sito online?",
      a: "Dipende dalla complessità, ma in genere un sito vetrina richiede dalle 2 alle 4 settimane dalla raccolta dei materiali. All'inizio definiamo insieme una tabella di marcia, così sai sempre a che punto siamo.",
    },
    {
      q: "Lavorate in tutta la Svizzera?",
      a: "Sì. Seguiamo clienti in tutta la Svizzera, da remoto e di persona quando serve. La distanza non è mai un ostacolo: gran parte del lavoro avviene online, con call e aggiornamenti costanti.",
    },
    {
      q: "Vi occupate anche di testi e fotografie?",
      a: "Assolutamente. Possiamo curare i contenuti dall'inizio alla fine, con shooting fotografici professionali e creazione dei testi. Per i social collaboriamo con Project Visibility, specialisti in contenuti e gestione delle pagine.",
    },
    {
      q: "Il sito sarà ottimizzato per Google?",
      a: "Sì, ogni sito che realizziamo nasce ottimizzato per la SEO: struttura corretta, velocità di caricamento e configurazione di Google Business per farti trovare sul territorio. Una buona presenza online parte da qui.",
    },
    {
      q: "Cosa succede dopo che il sito è online?",
      a: "Non ti lasciamo solo. Offriamo assistenza e manutenzione per tenere il sito sicuro e aggiornato, e siamo sempre disponibili per modifiche o nuove idee. Costruiamo relazioni durature, non lavori 'usa e getta'.",
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
        "Memorable visual identities: logo design, colour and typography systems, brand guidelines and branded templates.",
    },
    content: {
      title: "Content & Visual",
      description:
        "Professional photo shoots and social media management to bring your brand to life, in collaboration with Project Visibility.",
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
        "Einprägsame visuelle Identitäten: Logodesign, Farb- und Typografiesysteme, Markenrichtlinien und gebrandete Vorlagen.",
    },
    content: {
      title: "Content & Visual",
      description:
        "Professionelle Fotoshootings und Social-Media-Betreuung, die deine Marke zum Leben erwecken – in Zusammenarbeit mit Project Visibility.",
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
        "Identità visive memorabili: design del logo, sistemi di colore e tipografia, linee guida del brand e template brandizzati.",
    },
    content: {
      title: "Contenuti & Visual",
      description:
        "Shooting fotografici professionali e gestione social per dare vita al tuo brand, in collaborazione con Project Visibility.",
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
      "We are a digital studio transforming the online presence of professionals and businesses across Switzerland. Design, code, and strategy for brands that want to stand out.",
  },
  de: {
    title: "Modolo Digital Studio | Webdesign & Entwicklung in der Schweiz",
    description:
      "Wir sind ein Digital Studio, das die Online-Präsenz von Fachleuten und Unternehmen in der ganzen Schweiz transformiert. Design, Code und Strategie für Marken, die sich abheben wollen.",
  },
  it: {
    title: "Modolo Digital Studio | Web Design & Sviluppo in Svizzera",
    description:
      "Siamo uno studio digitale che trasforma la presenza online di professionisti e aziende in tutta la Svizzera. Design, codice e strategia per brand che vogliono distinguersi.",
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
