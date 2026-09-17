// Recensioni Google vere, raccolte sul profilo di Winterthur.
//
// UNICA FONTE per la sezione testimonianze (components/testimonials.tsx). NON alimenta i dati
// strutturati: vedi la nota qui sotto e quella in lib/json-ld.ts.
//
// ⚠️ NON INVENTARE MAI un nome, un voto o una frase. Ogni riga qui dentro deve esistere,
// verbatim, sulla scheda Google — che e' linkata sotto la sezione proprio perche' chiunque possa
// confrontare. Una testimonianza ritoccata vale meno di zero: e' l'unica cosa che, se scoperta,
// cancella la fiducia costruita da tutte le altre.
//
// PERCHE' NON FINISCONO NEI DATI STRUTTURATI (schema.org Review / AggregateRating).
// Google, "Review snippet" structured data guidelines:
//   "If the entity that's being reviewed controls the reviews about itself, their pages that use
//    LocalBusiness or any other type of Organization structured data are ineligible for star
//    review feature. For example, a review about entity A is placed on the website of entity A,
//    either directly in their structured data or through an embedded third-party widget (for
//    example, Google Business reviews or Facebook reviews widget)."
// Sono recensioni autentiche, ma ospitate sul dominio dell'azienda recensita: per Google sono
// "self-serving" a prescindere da quante siano. Mostrarle ai visitatori: si'. Dichiararle a
// Google come nostro rating: no. Le stelle nei risultati di ricerca arrivano dalla scheda Google
// Business, che e' il canale legittimo per ottenerle.

import type { Locale } from "@/lib/i18n";

/** La lingua in cui la recensione e' stata SCRITTA. "gsw" = svizzero tedesco (dialetto). */
export type ReviewLang = "gsw" | "de" | "it" | "en";

export type ReviewItem = {
  /** Nome come appare su Google. */
  author: string;
  /** Attivita' e citta', se note. Omesso quando non lo sappiamo: meglio vuoto che inventato. */
  company?: string;
  /** 1-5, come sulla scheda. */
  rating: number;
  /** Il testo ORIGINALE, verbatim, nella lingua in cui e' stato scritto. */
  body: string;
  bodyLang: ReviewLang;
  /**
   * Traduzioni per le lingue diverse dall'originale. Mostrate marcate come traduzione, mai
   * spacciate per parole testuali del cliente.
   */
  translations?: Partial<Record<Locale, string>>;
  /** Solo per l'ordinamento. Google pubblica date relative: qui e' il mese ricavato da quelle. */
  datePublished: string;
};

// Ordinate dalla piu' recente. Verificate sulla scheda il 15 settembre 2026; i voti (tutti 5/5)
// confermati dal titolare leggendoli sul pannello, perche' nel testo copiato le stelle si perdono.
export const REVIEWS: ReviewItem[] = [
  {
    author: "Andrea Gonaj",
    rating: 5,
    body:
      "Ha eseguito le raccomandazioni che io gli ho dato in una forma eccellente. Si è occupato nei migliore dei modi per costruire contenuti multimediali video/montaggio. Un grazie a Francesco.",
    bodyLang: "it",
    translations: {
      de: "Er hat meine Vorgaben ausgezeichnet umgesetzt. Um die Video-Inhalte und den Schnitt hat er sich bestens gekümmert. Danke, Francesco.",
      en: "He carried out the recommendations I gave him excellently. He took the best possible care of producing the video content and the editing. Thank you, Francesco.",
    },
    datePublished: "2026-09-15",
  },
  {
    // La piu' preziosa delle quattro, e non per il contenuto: e' scritta in SVIZZERO TEDESCO.
    // Sulla pagina tedesca va mostrata cosi' com'e'. Un'agenzia estera non riceve recensioni in
    // dialetto: e' una prova di radicamento locale che non si puo' fabbricare, e tradurla in
    // Hochdeutsch la butterebbe via. La traduzione italiana e' quella fornita da Google stesso.
    author: "Alessio Fede",
    rating: 5,
    body:
      "Ich bi mega zfriede mit em Francesco. Er het mich bi de Grafik und Werbig unterstützt und grad verstande, was ich mir vorgstellt ha. Alles isch schnell und unkompliziert gange und s Resultat isch super worde. Chan ihn uf jede Fall wiiterempfehle!",
    bodyLang: "gsw",
    translations: {
      it: "Sono estremamente soddisfatto di Francesco. Mi ha aiutato con la grafica e la pubblicità e ha capito perfettamente cosa avevo in mente. Tutto è andato in modo rapido e senza intoppi, e il risultato è fantastico. Lo consiglio vivamente!",
      en: "I'm extremely happy with Francesco. He helped me with the graphics and the advertising and understood exactly what I had in mind. Everything went quickly and smoothly, and the result is fantastic. I can definitely recommend him!",
    },
    datePublished: "2026-09-01",
  },
  {
    author: "Renald Cepele",
    rating: 5,
    body:
      "La mia situazione iniziale era un po' un disastro e non sapevo bene come muovermi. Francesco ha capito subito al volo cosa serviva e ha trasformato completamente il progetto in veramente poco tempo. Da quando abbiamo finito, il flusso di lavoro è migliorato tantissimo e la risposta dei clienti è ottima. Davvero un ottimo lavoro!",
    bodyLang: "it",
    translations: {
      de: "Meine Ausgangslage war ziemlich chaotisch und ich wusste nicht recht, wie anfangen. Francesco hat sofort verstanden, was es braucht, und das Projekt in sehr kurzer Zeit komplett verwandelt. Seit wir fertig sind, läuft der Ablauf viel besser und die Rückmeldungen der Kundschaft sind ausgezeichnet. Wirklich eine sehr gute Arbeit!",
      en: "My starting point was a bit of a disaster and I wasn't sure how to proceed. Francesco immediately grasped what was needed and completely transformed the project in very little time. Since we finished, the workflow has improved enormously and the response from customers is excellent. Really excellent work!",
    },
    datePublished: "2026-08-15",
  },
  {
    // Il testo su Google finisce con "eeccole", un residuo di battitura evidentemente involontario.
    // E' l'unico intervento fatto su queste quattro citazioni, ed e' una rimozione, non una
    // modifica: nessuna parola e' stata cambiata, aggiunta o riordinata. Il link alla scheda sta
    // sotto la sezione, quindi il confronto e' a un clic da chiunque.
    author: "Daniel Jose",
    rating: 5,
    body:
      "Modolo Studio è un vero professionista. Consiglio vivamente il loro lavoro e la loro competenza nella creazione di siti web. Sono più che soddisfatto del loro eccellente lavoro.",
    bodyLang: "it",
    translations: {
      de: "Modolo Studio ist ein echter Profi. Ich empfehle die Arbeit und das Können bei der Erstellung von Websites wärmstens. Ich bin mehr als zufrieden mit der ausgezeichneten Arbeit.",
      en: "Modolo Studio is a true professional. I warmly recommend their work and their expertise in building websites. I'm more than satisfied with their excellent work.",
    },
    datePublished: "2026-07-15",
  },
];

/**
 * Lo svizzero tedesco conta come tedesco quando si sceglie cosa mostrare: chi legge il sito in
 * tedesco a Winterthur legge il dialetto senza attrito — ed e' proprio il dialetto a dimostrare
 * che chi ha scritto e' di qui.
 */
export function readsNatively(bodyLang: ReviewLang, locale: Locale): boolean {
  if (bodyLang === "gsw") return locale === "de";
  return bodyLang === locale;
}
