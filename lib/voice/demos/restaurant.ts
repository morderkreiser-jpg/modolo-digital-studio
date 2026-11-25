// Demo business: Restaurant Musterlinde, an INVENTED restaurant in the invented town of Musterwil.
//
// The story: during service nobody can leave the floor for the phone. The assistant answers when
// the line is busy and outside opening hours (Monday, the afternoon break, the night), books
// tables through the calendar (shared seats) and takes group requests. Speaks de, it, en, fr.
// Every phone number here is a placeholder (see shared.ts).
import type { DemoScript, VoiceTenantConfig } from "@/lib/voice/types";
import {
  ALL_LOCALES,
  DEMO_KNOWLEDGE_VERSION,
  DEMO_TOWN,
  demoNotice,
  demoPrivacy,
  demoRules,
  formalIn,
  holidays,
  range,
  sameDays,
  section,
  step,
  week,
} from "./shared";

const NAME = "Restaurant Musterlinde";
const ID = "demo-restaurant";

const GREETING = {
  de: "Grüezi, Restaurant Musterlinde. Hier spricht der digitale Assistent, ich bin eine KI. Wie kann ich Ihnen helfen?",
  it: "Buongiorno, ristorante Musterlinde. Sono l'assistente digitale, un'intelligenza artificiale. Come posso aiutarla?",
  en: "Hello, Restaurant Musterlinde. This is the digital assistant, I'm an AI. How can I help you?",
  fr: "Bonjour, restaurant Musterlinde. Ici l'assistant numérique, je suis une IA. Comment puis-je vous aider?",
};

// Lunch ends at 14:30 so that a two-hour table booked at 12:30 still fits: the calendar only
// offers starts whose whole sitting lies inside the opening hours.
const LUNCH = range("11:30", "14:30");
const DINNER = range("17:30", "23:00");

export const RESTAURANT_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "restaurant",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundenes Restaurant für die Demo: Schweizer und italienische Küche in Musterwil, mittags und abends, Montag Ruhetag.",
      it: "Ristorante inventato per la demo: cucina svizzera e italiana a Musterwil, a pranzo e a cena, chiuso il lunedì.",
      en: "An invented restaurant for the demo: Swiss and Italian cooking in Musterwil, lunch and dinner, closed on Mondays.",
      fr: "Restaurant inventé pour la démo: cuisine suisse et italienne à Musterwil, midi et soir, fermé le lundi.",
    },
  },
  locales: [...ALL_LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: {
      de: "der digitale Assistent des Restaurants Musterlinde",
      it: "l'assistente digitale del ristorante Musterlinde",
      en: "the digital assistant of Restaurant Musterlinde",
      fr: "l'assistant numérique du restaurant Musterlinde",
    },
    formality: formalIn(ALL_LOCALES),
    style: [
      "Callers often ring during service and want it short: ask for the day, the time and the number of people first.",
    ],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: week({
      ...sameDays(["tue", "wed", "thu", "fri", "sat"], [LUNCH, DINNER]),
      sun: [range("11:30", "15:00")],
    }),
    holidays: holidays("newYear", "berchtold"),
    exceptions: [
      {
        date: "2026-12-24",
        ranges: [LUNCH],
        label: { de: "Heiligabend", it: "Vigilia di Natale", en: "Christmas Eve", fr: "Veille de Noël" },
      },
    ],
  },
  // A person answers while the line is free; the assistant takes over when it is busy during
  // service and whenever the restaurant is closed.
  answerPolicy: {
    always: false,
    afterHours: true,
    weekends: false,
    holidays: true,
    noAnswerAfterSeconds: null,
    whenBusy: true,
  },
  handoff: {
    // No transfer: the assistant answers exactly when the staff cannot take the phone.
    transfer: { enabled: false, targets: [], ringSeconds: 20 },
    callback: {
      enabled: true,
      promise: {
        de: "Wir rufen Sie am nächsten Tag zurück, an dem das Restaurant geöffnet ist.",
        it: "La richiamiamo il prossimo giorno di apertura del ristorante.",
        en: "We will call you back on the next day the restaurant is open.",
        fr: "Nous vous rappelons le prochain jour d'ouverture du restaurant.",
      },
    },
    written: { enabled: false },
    emergency: {
      triggers: ["a medical emergency, for example an allergic reaction after a meal"],
      message: {
        de: "Bei einem medizinischen Notfall legen Sie bitte auf und rufen Sie 144 an.",
        it: "In caso di emergenza medica riattacchi e chiami il 144.",
        en: "In a medical emergency, please hang up and call 144.",
        fr: "En cas d'urgence médicale, raccrochez et appelez le 144.",
      },
    },
  },
  tasks: [
    {
      id: "group_request",
      label: { de: "Gruppenanfrage", it: "Richiesta per gruppi", en: "Group request", fr: "Demande de groupe" },
      when: "A group of 9 or more people, or a closed party, wants a table. Never book these in the calendar: take them as a request.",
      fields: [
        { id: "date", label: { de: "Datum", it: "Data", en: "Date", fr: "Date" }, type: "date", required: true },
        { id: "time", label: { de: "Uhrzeit", it: "Ora", en: "Time", fr: "Heure" }, type: "time", required: true },
        {
          id: "party_size",
          label: { de: "Anzahl Personen", it: "Numero di persone", en: "Number of people", fr: "Nombre de personnes" },
          type: "integer",
          required: true,
          min: 9,
          max: 60,
        },
        {
          id: "wishes",
          label: {
            de: "Anlass und Wünsche (Menü, Allergien)",
            it: "Occasione e desideri (menù, allergie)",
            en: "Occasion and wishes (menu, allergies)",
            fr: "Occasion et souhaits (menu, allergies)",
          },
          type: "text",
          required: false,
          maxLength: 300,
        },
      ],
      contact: { name: "required", phone: "required", email: "optional", company: "optional" },
      // What the knowledge says about group requests; the tool hands exactly this to the model.
      followUp: {
        de: "Wir rufen Sie am nächsten Tag zurück, an dem das Restaurant geöffnet ist.",
        it: "La richiamiamo il prossimo giorno di apertura del ristorante.",
        en: "We will call you back on the next day the restaurant is open.",
        fr: "Nous vous rappelons le prochain jour d'ouverture du restaurant.",
      },
    },
  ],
  tools: [
    "check_availability",
    "book_appointment",
    "cancel_appointment",
    "reschedule_appointment",
    "create_lead",
    "request_callback",
    "end_call",
  ],
  calendar: {
    provider: "memory",
    services: [{ id: "table", label: { de: "Tisch", it: "Tavolo", en: "Table", fr: "Table" }, durationMinutes: 120 }],
    capacity: { kind: "seats", total: 40, maxPartySize: 8, turnMinutes: 120 },
    // No `bookable`: tables can be booked whenever a whole sitting fits in the opening hours.
    slotStepMinutes: 15,
    minLeadMinutes: 60,
    maxDaysAhead: 60,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 120,
  },
  rules: [
    "Book tables only with the calendar tools, for 1 to 8 people. A table is reserved only when book_appointment answered ok; then give the reference.",
    "Groups of 9 or more and closed parties: take a group_request with create_lead. Never book them and never say they are confirmed.",
    "Never say a dish is free of an allergen; the kitchen answers allergy questions. Note allergies and special wishes in the booking notes.",
    "Never promise a particular table, the terrace or a window seat.",
    ...demoRules(),
  ],
  plan: "demo",
  privacy: demoPrivacy(),
  allowedOrigins: [],
  knowledge: () => ({
    version: DEMO_KNOWLEDGE_VERSION,
    sections: [
      demoNotice(NAME, ALL_LOCALES),
      section(
        "restaurant",
        { de: "Das Restaurant", it: "Il ristorante", en: "The restaurant", fr: "Le restaurant" },
        {
          de: "Schweizer und italienische Küche. 40 Plätze innen, im Sommer zusätzlich 24 auf der Terrasse. Jeden Tag gibt es vegetarische Gerichte. Kinderstühle sind vorhanden.",
          it: "Cucina svizzera e italiana. 40 posti all'interno, d'estate altri 24 in terrazza. Ogni giorno ci sono piatti vegetariani. Abbiamo seggioloni per bambini.",
          en: "Swiss and Italian cooking. 40 seats inside, and in summer another 24 on the terrace. There are vegetarian dishes every day. High chairs are available.",
          fr: "Cuisine suisse et italienne. 40 places à l'intérieur, en été 24 de plus en terrasse. Il y a des plats végétariens tous les jours. Nous avons des chaises hautes pour les enfants.",
        },
      ),
      section(
        "hours",
        { de: "Öffnungszeiten", it: "Orari", en: "Opening hours", fr: "Horaires" },
        {
          de: "Dienstag bis Samstag 11.30 bis 14.30 Uhr und 17.30 bis 23 Uhr, die Küche schliesst abends um 21.30 Uhr. Sonntag 11.30 bis 15 Uhr. Montag Ruhetag. Am 24. Dezember 2026 nur mittags offen, am 1. und 2. Januar 2027 geschlossen.",
          it: "Dal martedì al sabato dalle 11.30 alle 14.30 e dalle 17.30 alle 23, la cucina la sera chiude alle 21.30. Domenica dalle 11.30 alle 15. Lunedì chiuso. Il 24 dicembre 2026 aperto solo a pranzo, il 1° e il 2 gennaio 2027 chiuso.",
          en: "Tuesday to Saturday 11:30 to 14:30 and 17:30 to 23:00; in the evening the kitchen closes at 21:30. Sunday 11:30 to 15:00. Closed on Mondays. On 24 December 2026 open for lunch only; closed on 1 and 2 January 2027.",
          fr: "Du mardi au samedi de 11 h 30 à 14 h 30 et de 17 h 30 à 23 h; le soir, la cuisine ferme à 21 h 30. Le dimanche de 11 h 30 à 15 h. Fermé le lundi. Le 24 décembre 2026 ouvert seulement à midi, fermé les 1er et 2 janvier 2027.",
        },
      ),
      section(
        "lunch",
        { de: "Mittagsmenü", it: "Menù del giorno", en: "Lunch menu", fr: "Menu de midi" },
        {
          de: "Dienstag bis Freitag gibt es ein Mittagsmenü mit Suppe oder Salat für 24 Franken, vegetarisch für 22 Franken. Die Karte am Abend wechselt mit der Saison.",
          it: "Dal martedì al venerdì c'è un menù di mezzogiorno con zuppa o insalata a 24 franchi, vegetariano a 22 franchi. La carta della sera cambia con la stagione.",
          en: "Tuesday to Friday there is a lunch menu with soup or salad for 24 francs, the vegetarian one for 22 francs. The evening menu changes with the season.",
          fr: "Du mardi au vendredi, il y a un menu de midi avec soupe ou salade à 24 francs, le végétarien à 22 francs. La carte du soir change avec les saisons.",
        },
      ),
      section(
        "reservations",
        { de: "Reservationen", it: "Prenotazioni", en: "Reservations", fr: "Réservations" },
        {
          de: "Tische für 1 bis 8 Personen reserviert der digitale Assistent direkt. Wir halten den Tisch 15 Minuten. Absagen kostet nichts; wir sind froh um eine frühe Absage. Gruppen ab 9 Personen und geschlossene Gesellschaften: Das Restaurant prüft die Anfrage und ruft am nächsten Öffnungstag zurück.",
          it: "I tavoli da 1 a 8 persone li prenota direttamente l'assistente digitale. Teniamo il tavolo 15 minuti. Annullare non costa nulla; ci fa piacere se avvisa presto. Gruppi da 9 persone in su ed eventi privati: il ristorante valuta la richiesta e richiama il prossimo giorno di apertura.",
          en: "The digital assistant books tables for 1 to 8 people directly. We hold a table for 15 minutes. Cancelling costs nothing; we are glad to hear early. Groups of 9 or more and private parties: the restaurant checks the request and calls back on the next day it is open.",
          fr: "L'assistant numérique réserve directement les tables de 1 à 8 personnes. Nous gardons la table 15 minutes. Annuler ne coûte rien; nous apprécions d'être prévenus tôt. Groupes à partir de 9 personnes et soirées privées: le restaurant examine la demande et rappelle le prochain jour d'ouverture.",
        },
      ),
      section(
        "practical",
        { de: "Gut zu wissen", it: "Buono a sapersi", en: "Good to know", fr: "Bon à savoir" },
        {
          de: "Bezahlen mit Bargeld, Karte oder TWINT. Eigene Parkplätze haben wir keine; ein öffentliches Parkhaus ist 200 Meter entfernt.",
          it: "Si paga in contanti, con carta o con TWINT. Non abbiamo parcheggi nostri; c'è un autosilo pubblico a 200 metri.",
          en: "You can pay in cash, by card or with TWINT. We have no parking of our own; there is a public car park 200 metres away.",
          fr: "Paiement en espèces, par carte ou avec TWINT. Nous n'avons pas de places de parc; un parking public se trouve à 200 mètres.",
        },
      ),
    ],
  }),
};

export const RESTAURANT_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.samstag-ausgebucht`,
    tenantId: ID,
    locale: "de",
    title: "Samstag um 19 Uhr ist alles besetzt",
    shows: "Um 19 Uhr ist kein Tisch mehr frei; der Assistent bietet 18.15 Uhr oder 20.45 Uhr an und reserviert.",
    lines: [
      { role: "assistant", text: GREETING.de },
      { role: "caller", text: "Grüezi. Ich möchte einen Tisch reservieren, für Samstag um sieben. Vier Personen." },
      {
        role: "assistant",
        text: "Am Samstag, 12. Dezember, ist um 19 Uhr leider alles besetzt. Frei sind 18.15 Uhr oder 20.45 Uhr.",
        tool: step.availability({ service: "table", date: "2026-12-12", partySize: 4, partOfDay: "evening" }),
      },
      { role: "caller", text: "Hm. Viertel nach sechs ist zu früh. Dann lieber 20.45 Uhr." },
      {
        role: "assistant",
        text: "20.45 Uhr für vier Personen. Haben Sie besondere Wünsche, zum Beispiel einen Kinderstuhl?",
      },
      { role: "caller", text: "Einer von uns isst vegetarisch. Geht das?" },
      {
        role: "assistant",
        text: "Ja, auf der Karte hat es jeden Abend vegetarische Gerichte. Auf welchen Namen darf ich reservieren?",
      },
      { role: "caller", text: "Baumann. Daniel Baumann." },
      { role: "assistant", text: "Und unter welcher Nummer erreichen wir Sie, falls etwas ist?" },
      { role: "caller", text: "Null sieben neun, null null null, null null, zwei drei." },
      {
        role: "assistant",
        text: "Ich wiederhole: Samstag, 12. Dezember, 20.45 Uhr, vier Personen, auf den Namen Daniel Baumann, null sieben neun, null null null, null null, zwei drei. Stimmt das?",
      },
      { role: "caller", text: "Stimmt." },
      {
        role: "assistant",
        text: "Ihr Tisch ist reserviert. Ihre Referenz lautet MV-5T9B. Wir halten den Tisch bis 21 Uhr für Sie.",
        tool: step.book({
          service: "table",
          start: "2026-12-12T20:45:00+01:00",
          name: "Daniel Baumann",
          contact: "+41790000023",
          partySize: 4,
          notes: "Eine Person isst vegetarisch.",
        }),
      },
      { role: "caller", text: "Perfekt. Merci, uf Wiederluege." },
      { role: "assistant", text: "Auf Wiederhören, Herr Baumann, und einen schönen Abend." },
    ],
  },
  {
    id: `${ID}.de.wechsel-ins-italienische`,
    tenantId: ID,
    locale: "de",
    title: "Der Gast wechselt ins Italienische",
    shows: "Ein Gast beginnt auf Deutsch, fragt nach Italienisch, und der Assistent reserviert auf Italienisch weiter.",
    lines: [
      { role: "assistant", text: GREETING.de },
      { role: "caller", text: "Grüezi, ich ... möchte reservieren. Für Sonntag." },
      { role: "assistant", text: "Gern. Für wie viele Personen?" },
      { role: "caller", text: "Scusi, parla italiano? Il tedesco non è il mio forte." },
      { role: "assistant", text: "Sì, certo, parliamo in italiano. Per quante persone è la prenotazione?" },
      { role: "caller", text: "Siamo in sei. Domenica a pranzo, verso mezzogiorno e mezza." },
      {
        role: "assistant",
        text: "Domenica 13 dicembre alle 12.30 c'è posto per sei persone. A che nome prenoto?",
        tool: step.availability({ service: "table", date: "2026-12-13", partySize: 6 }),
      },
      { role: "caller", text: "Esposito. Giuseppe Esposito." },
      { role: "assistant", text: "Grazie. E un numero di telefono, nel caso dovessimo contattarla?" },
      { role: "caller", text: "Zero sette nove, zero zero zero, zero zero, cinque uno." },
      { role: "assistant", text: "Desidera qualcosa di particolare, per esempio un seggiolone?" },
      { role: "caller", text: "Sì, un seggiolone per il piccolo." },
      {
        role: "assistant",
        text: "Ripeto: domenica 13 dicembre alle 12.30, sei persone con un seggiolone, a nome di Giuseppe Esposito, zero sette nove, zero zero zero, zero zero, cinque uno. Va bene?",
      },
      { role: "caller", text: "Sì, va bene." },
      {
        role: "assistant",
        text: "Il tavolo è prenotato. Il codice della prenotazione è MV-8C4W. A domenica.",
        tool: step.book({
          service: "table",
          start: "2026-12-13T12:30:00+01:00",
          name: "Giuseppe Esposito",
          contact: "+41790000051",
          partySize: 6,
          notes: "Ein Kinderstuhl. Gast spricht Italienisch.",
        }),
      },
      { role: "caller", text: "Grazie mille. Arrivederci." },
    ],
  },
  {
    id: `${ID}.it.disdire-stasera`,
    tenantId: ID,
    locale: "it",
    title: "Disdire la prenotazione di stasera",
    shows: "Un cliente deve disdire all'ultimo; l'assistente annulla la prenotazione con il codice e il nome, senza costi.",
    lines: [
      { role: "assistant", text: GREETING.it },
      { role: "caller", text: "Buongiorno. Avevo prenotato per stasera, ma purtroppo dobbiamo disdire." },
      { role: "assistant", text: "Mi dispiace. Ha il codice della prenotazione?" },
      { role: "caller", text: "Sì, aspetti... emme vu, tre, kappa, nove, erre." },
      { role: "assistant", text: "MV-3K9R. A che nome è la prenotazione?" },
      { role: "caller", text: "Colombo. Paolo Colombo." },
      {
        role: "assistant",
        text: "Allora annullo la prenotazione MV-3K9R a nome di Paolo Colombo, per stasera. Conferma?",
      },
      { role: "caller", text: "Sì, confermo." },
      {
        role: "assistant",
        text: "La prenotazione è annullata. Grazie di averci avvisato.",
        tool: step.cancel({ reference: "MV-3K9R", name: "Paolo Colombo" }),
      },
      { role: "caller", text: "Devo pagare qualcosa?" },
      { role: "assistant", text: "No, annullare non costa nulla." },
      { role: "caller", text: "Meno male. Grazie, arrivederci." },
      { role: "assistant", text: "Arrivederci, signor Colombo, e buona serata." },
    ],
  },
  {
    id: `${ID}.en.closed-on-mondays`,
    tenantId: ID,
    locale: "en",
    title: "Closed on Mondays",
    shows: "A caller wants lunch on a Monday, when the restaurant is closed; the assistant says so and books Tuesday instead.",
    lines: [
      { role: "assistant", text: GREETING.en },
      { role: "caller", text: "Hi. Could I book a table for two for lunch on Monday?" },
      {
        role: "assistant",
        text: "I'm sorry, we're closed on Mondays. We're open for lunch and dinner from Tuesday to Saturday, and for lunch on Sundays.",
      },
      { role: "caller", text: "Oh, okay. Tuesday then, around half past twelve? And how much is the lunch menu?" },
      {
        role: "assistant",
        text: "On Tuesday the 15th of December, 12:30 is free for two. The lunch menu with soup or salad is 24 francs, the vegetarian one 22.",
        tool: step.availability({ service: "table", date: "2026-12-15", partySize: 2 }),
      },
      { role: "caller", text: "Great. Let's do 12:30." },
      { role: "assistant", text: "What name should I put the table under?" },
      { role: "caller", text: "Sarah Collins." },
      { role: "assistant", text: "And a phone number, in case we need to reach you?" },
      { role: "caller", text: "Zero seven eight, zero zero zero, zero zero, four four." },
      {
        role: "assistant",
        text: "Let me read that back: Tuesday the 15th of December, 12:30, a table for two, Sarah Collins, zero seven eight, zero zero zero, zero zero, four four. Is that right?",
      },
      { role: "caller", text: "Yes, that's right." },
      {
        role: "assistant",
        text: "Your table is booked. Your reference is MV-7D2H. We'll hold the table for you for 15 minutes.",
        tool: step.book({
          service: "table",
          start: "2026-12-15T12:30:00+01:00",
          name: "Sarah Collins",
          contact: "+41780000044",
          partySize: 2,
        }),
      },
      { role: "caller", text: "Perfect, thanks. Bye." },
    ],
  },
  {
    id: `${ID}.fr.repas-de-groupe`,
    tenantId: ID,
    locale: "fr",
    title: "Un repas de groupe pour douze",
    shows: "Un client veut réserver pour douze personnes; l'assistant ne réserve pas lui-même, il enregistre une demande de groupe sans rien confirmer.",
    lines: [
      { role: "assistant", text: GREETING.fr },
      {
        role: "caller",
        text: "Bonjour. Je voudrais réserver pour un repas d'entreprise. Nous serons douze, le vendredi 18 décembre au soir.",
      },
      {
        role: "assistant",
        text: "Pour plus de huit personnes, je ne peux pas réserver moi-même. Je prends votre demande, et le restaurant vous rappelle. À quelle heure souhaitez-vous venir?",
      },
      { role: "caller", text: "Vers dix-neuf heures. Et si possible un seul menu pour tout le monde." },
      {
        role: "assistant",
        text: "Je note: vendredi 18 décembre, 19 heures, douze personnes, un menu unique pour le groupe. Y a-t-il des régimes ou des allergies à signaler?",
      },
      { role: "caller", text: "Deux végétariens, je crois. Je vous le confirmerai." },
      { role: "assistant", text: "Deux végétariens, c'est noté. À quel nom est la demande?" },
      { role: "caller", text: "Marc Laurent." },
      { role: "assistant", text: "Et votre numéro de téléphone, Monsieur Laurent?" },
      { role: "caller", text: "Zéro sept neuf, zéro zéro zéro, zéro zéro, neuf neuf." },
      {
        role: "assistant",
        text: "Je répète: Marc Laurent, zéro sept neuf, zéro zéro zéro, zéro zéro, neuf neuf. C'est juste?",
      },
      { role: "caller", text: "Oui. Donc c'est réservé?" },
      {
        role: "assistant",
        text: "J'ai enregistré votre demande, mais ce n'est pas encore une réservation. Le restaurant vérifie la place et le menu. Nous vous rappelons le prochain jour d'ouverture du restaurant.",
        tool: step.lead({
          task: "group_request",
          fields: {
            date: "2026-12-18",
            time: "19:00",
            party_size: 12,
            wishes: "Repas d'entreprise, un menu unique pour tout le groupe, probablement deux végétariens.",
          },
          contact: { name: "Marc Laurent", phone: "+41790000099" },
          summary:
            "Firmenessen für 12 Personen am Freitag, 18. Dezember 2026, um 19 Uhr. Gewünscht ist ein gemeinsames Menü, voraussichtlich zwei Vegetarier. Der Gast spricht Französisch.",
        }),
      },
      { role: "caller", text: "D'accord. Merci, au revoir." },
      { role: "assistant", text: "Merci à vous. Au revoir, Monsieur Laurent." },
    ],
  },
];
