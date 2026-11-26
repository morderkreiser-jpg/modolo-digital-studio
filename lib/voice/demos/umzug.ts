// Demo business: Muster Umzüge, an INVENTED moving company in the invented town of Musterwil.
//
// The story: the team spends the day carrying furniture, so nobody picks up. The assistant answers
// after 20 seconds without reply, when the line is busy, after hours, on weekends and holidays, and
// takes the whole quote request; it never names a price. Speaks de, it, en, fr.
// Every phone number here is a placeholder (see shared.ts).
import type { DemoScript, TaskDefinition, VoiceTenantConfig } from "@/lib/voice/types";
import {
  ALL_LOCALES,
  DEMO_KNOWLEDGE_VERSION,
  DEMO_TOWN,
  demoNotice,
  demoPrivacy,
  demoRules,
  formalIn,
  holidays,
  section,
  step,
  tradesWeek,
} from "./shared";

const NAME = "Muster Umzüge";
const ID = "demo-umzug";

const GREETING = {
  de: "Grüezi, hier ist der digitale Assistent von Muster Umzüge. Ich bin eine KI. Wie kann ich Ihnen helfen?",
  it: "Buongiorno, sono l'assistente digitale di Muster Umzüge. Sono un'intelligenza artificiale. Come posso aiutarla?",
  en: "Hello, this is the digital assistant of Muster Umzüge. I'm an AI. How can I help you?",
  fr: "Bonjour, ici l'assistant numérique de Muster Umzüge. Je suis une IA. Comment puis-je vous aider?",
};

const MOVING_QUOTE: TaskDefinition = {
  id: "moving_quote",
  label: { de: "Offertanfrage Umzug", it: "Richiesta di offerta trasloco", en: "Moving quote request", fr: "Demande de devis déménagement" },
  when: "The caller wants a quote for a move, home or office, or asks what a move costs.",
  fields: [
    {
      id: "from_locality",
      label: { de: "Von (Ort)", it: "Da (località)", en: "From (locality)", fr: "De (localité)" },
      type: "locality",
      required: true,
      maxLength: 80,
    },
    {
      id: "to_locality",
      label: { de: "Nach (Ort)", it: "A (località)", en: "To (locality)", fr: "À (localité)" },
      type: "locality",
      required: true,
      maxLength: 80,
    },
    {
      // Text, not a date: callers often know only a period ("end of March").
      id: "move_date",
      label: { de: "Datum oder Zeitraum", it: "Data o periodo", en: "Date or period", fr: "Date ou période" },
      type: "text",
      required: true,
      maxLength: 60,
    },
    {
      id: "home_size",
      label: { de: "Grösse", it: "Dimensione", en: "Size", fr: "Taille" },
      type: "choice",
      required: true,
      choices: [
        { id: "rooms_1", label: { de: "1 bis 1,5 Zimmer", it: "1-1,5 locali", en: "1 to 1.5 rooms", fr: "1 à 1,5 pièce" } },
        { id: "rooms_2", label: { de: "2 bis 2,5 Zimmer", it: "2-2,5 locali", en: "2 to 2.5 rooms", fr: "2 à 2,5 pièces" } },
        { id: "rooms_3", label: { de: "3 bis 3,5 Zimmer", it: "3-3,5 locali", en: "3 to 3.5 rooms", fr: "3 à 3,5 pièces" } },
        { id: "rooms_4", label: { de: "4 bis 4,5 Zimmer", it: "4-4,5 locali", en: "4 to 4.5 rooms", fr: "4 à 4,5 pièces" } },
        {
          id: "rooms_5_plus",
          label: { de: "5 Zimmer oder mehr", it: "5 locali o più", en: "5 rooms or more", fr: "5 pièces ou plus" },
        },
        { id: "office", label: { de: "Büro", it: "Ufficio", en: "Office", fr: "Bureau" } },
      ],
    },
    // Floors and lifts are optional: the caller often does not know the new home yet.
    {
      id: "floor_from",
      label: {
        de: "Stockwerk am alten Ort (0 = Erdgeschoss)",
        it: "Piano attuale (0 = pianterreno)",
        en: "Floor now (0 = ground floor)",
        fr: "Étage au départ (0 = rez-de-chaussée)",
      },
      type: "integer",
      required: false,
      min: 0,
      max: 30,
    },
    {
      id: "lift_from",
      label: { de: "Lift am alten Ort", it: "Ascensore alla partenza", en: "Lift at the current home", fr: "Ascenseur au départ" },
      type: "boolean",
      required: false,
    },
    {
      id: "floor_to",
      label: {
        de: "Stockwerk am neuen Ort (0 = Erdgeschoss)",
        it: "Piano di arrivo (0 = pianterreno)",
        en: "Floor at the new home (0 = ground floor)",
        fr: "Étage à l'arrivée (0 = rez-de-chaussée)",
      },
      type: "integer",
      required: false,
      min: 0,
      max: 30,
    },
    {
      id: "lift_to",
      label: { de: "Lift am neuen Ort", it: "Ascensore all'arrivo", en: "Lift at the new home", fr: "Ascenseur à l'arrivée" },
      type: "boolean",
      required: false,
    },
    // The extras as yes/no fields, so the office sees at a glance what to price.
    {
      id: "packing",
      label: { de: "Einpacken", it: "Imballaggio", en: "Packing", fr: "Emballage" },
      type: "boolean",
      required: false,
    },
    {
      id: "furniture_assembly",
      label: {
        de: "Möbel ab- und aufbauen",
        it: "Smontaggio e montaggio mobili",
        en: "Furniture dismantling and assembly",
        fr: "Démontage et montage des meubles",
      },
      type: "boolean",
      required: false,
    },
    {
      id: "storage",
      label: { de: "Möbellager", it: "Deposito mobili", en: "Storage", fr: "Garde-meubles" },
      type: "boolean",
      required: false,
    },
    {
      id: "cleaning",
      label: {
        de: "Umzugsreinigung mit Abgabegarantie",
        it: "Pulizia finale con garanzia di consegna",
        en: "End-of-tenancy cleaning with handover guarantee",
        fr: "Nettoyage de fin de bail avec garantie de remise",
      },
      type: "boolean",
      required: false,
    },
    {
      id: "disposal",
      label: { de: "Entsorgung", it: "Smaltimento", en: "Disposal", fr: "Débarras" },
      type: "boolean",
      required: false,
    },
    {
      id: "notes",
      label: {
        de: "Besonderes (z. B. Klavier, enge Treppe)",
        it: "Particolarità (pianoforte, scale strette)",
        en: "Anything special (piano, narrow stairs)",
        fr: "Particularités (piano, escalier étroit)",
      },
      type: "text",
      required: false,
      maxLength: 300,
    },
  ],
  contact: { name: "required", phone: "required", email: "optional", company: "optional" },
};

export const UMZUG_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "moving",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundenes Umzugsunternehmen für die Demo: Privat- und Büroumzüge ab Musterwil, auf Wunsch mit Einpacken, Möbelmontage, Lager, Reinigung und Entsorgung.",
      it: "Ditta di traslochi inventata per la demo: traslochi di case e uffici da Musterwil, su richiesta con imballaggio, montaggio mobili, deposito, pulizia e smaltimento.",
      en: "An invented moving company for the demo: home and office moves from Musterwil, with packing, furniture assembly, storage, cleaning and disposal on request.",
      fr: "Entreprise de déménagement inventée pour la démo: déménagements de logements et de bureaux depuis Musterwil, sur demande avec emballage, montage des meubles, garde-meubles, nettoyage et débarras.",
    },
  },
  locales: [...ALL_LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: {
      de: "der digitale Assistent von Muster Umzüge",
      it: "l'assistente digitale di Muster Umzüge",
      en: "the digital assistant of Muster Umzüge",
      fr: "l'assistant numérique de Muster Umzüge",
    },
    formality: formalIn(ALL_LOCALES),
    style: [
      "Callers are often busy with their move: let them give several details at once and only ask for what is still missing.",
    ],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: tradesWeek(),
    holidays: holidays("newYear", "berchtold", "goodFriday"),
  },
  // The team is on site all day: the office phone rings 20 seconds, then the assistant answers.
  answerPolicy: {
    always: false,
    afterHours: true,
    weekends: true,
    holidays: true,
    noAnswerAfterSeconds: 20,
    whenBusy: true,
  },
  handoff: {
    transfer: {
      enabled: true,
      ringSeconds: 20,
      targets: [
        {
          id: "office",
          label: { de: "unser Büro", it: "il nostro ufficio", en: "our office", fr: "notre bureau" },
          number: "+41000000001", // placeholder: +41 00 000 00 01 rings nowhere
          available: tradesWeek(),
        },
      ],
    },
    callback: {
      enabled: true,
      promise: {
        de: "Wir rufen Sie am nächsten Arbeitstag zurück.",
        it: "La richiamiamo il prossimo giorno lavorativo.",
        en: "We will call you back on the next working day.",
        fr: "Nous vous rappelons le jour ouvrable suivant.",
      },
    },
    written: {
      enabled: true,
      promise: {
        de: "Die Offerte bekommen Sie nach der Besichtigung schriftlich, per E-Mail oder per Post.",
        it: "L'offerta arriva per iscritto dopo il sopralluogo, per email o per posta.",
        en: "You will get the quote in writing after the viewing, by email or by post.",
        fr: "Vous recevez le devis par écrit après la visite, par e-mail ou par la poste.",
      },
    },
    emergency: {
      triggers: ["someone is injured", "a medical emergency"],
      message: {
        de: "Wenn jemand verletzt oder in Gefahr ist, legen Sie bitte auf und rufen Sie 144 oder 112 an.",
        it: "Se qualcuno è ferito o in pericolo, riattacchi e chiami il 144 o il 112.",
        en: "If someone is hurt or in danger, please hang up and call 144 or 112.",
        fr: "Si quelqu'un est blessé ou en danger, raccrochez et appelez le 144 ou le 112.",
      },
    },
  },
  tasks: [MOVING_QUOTE],
  tools: ["create_lead", "request_callback", "transfer_call", "end_call"],
  rules: [
    "Never name a price or a price range for a move. The price comes after a free viewing (on site or by video call), in a written quote with a cost ceiling.",
    "Never confirm that a moving date is free; the office confirms dates with the quote.",
    "Do not arrange viewings yourself: the office calls back to arrange them.",
    "Moves abroad are not offered; say so if asked.",
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
        "services",
        { de: "Leistungen", it: "Servizi", en: "Services", fr: "Prestations" },
        {
          de: "Privatumzüge und Büroumzüge. Auf Wunsch: Einpacken und Auspacken, Möbel ab- und aufbauen, Möbellager in Musterwil, Umzugsreinigung mit Abgabegarantie und Entsorgung alter Möbel. Klaviere nach Absprache. Umzüge ins Ausland machen wir nicht.",
          it: "Traslochi di case e di uffici. Su richiesta: imballaggio e disimballaggio, smontaggio e montaggio mobili, deposito mobili a Musterwil, pulizia finale con garanzia di consegna e smaltimento di mobili vecchi. Pianoforti su accordo. Non facciamo traslochi all'estero.",
          en: "Home and office moves. On request: packing and unpacking, furniture dismantling and assembly, storage in Musterwil, end-of-tenancy cleaning with handover guarantee and disposal of old furniture. Pianos by arrangement. We do not do moves abroad.",
          fr: "Déménagements de logements et de bureaux. Sur demande: emballage et déballage, démontage et montage des meubles, garde-meubles à Musterwil, nettoyage de fin de bail avec garantie de remise et débarras des vieux meubles. Pianos sur accord. Nous ne faisons pas de déménagements à l'étranger.",
        },
      ),
      section(
        "area",
        { de: "Einsatzgebiet", it: "Zona servita", en: "Area", fr: "Région" },
        {
          de: "Musterwil und Umgebung, der ganze Kanton Zürich und auf Anfrage die ganze Schweiz.",
          it: "Musterwil e dintorni, tutto il Canton Zurigo e, su richiesta, tutta la Svizzera.",
          en: "Musterwil and the surrounding area, the whole canton of Zurich and, on request, all of Switzerland.",
          fr: "Musterwil et environs, tout le canton de Zurich et, sur demande, toute la Suisse.",
        },
      ),
      section(
        "quote",
        { de: "Offerte und Preis", it: "Offerta e prezzo", en: "Quote and price", fr: "Devis et prix" },
        {
          de: "Am Telefon nennen wir keinen Preis. Für die Offerte brauchen wir: von wo nach wo, Datum oder Zeitraum, Grösse der Wohnung, Stockwerk und Lift an beiden Orten und die gewünschten Zusatzleistungen. Danach ruft das Büro am nächsten Arbeitstag an und macht eine kostenlose Besichtigung ab, vor Ort oder per Videoanruf. Die Offerte kommt schriftlich, mit einem Kostendach.",
          it: "Al telefono non diamo prezzi. Per l'offerta ci servono: da dove a dove, data o periodo, dimensione dell'appartamento, piano e ascensore alla partenza e all'arrivo, servizi aggiuntivi desiderati. Poi l'ufficio chiama il prossimo giorno lavorativo e fissa un sopralluogo gratuito, sul posto o in videochiamata. L'offerta arriva per iscritto, con un tetto massimo di costo.",
          en: "We do not give prices on the phone. For a quote we need: from where to where, date or period, size of the home, floor and lift at both ends and the extras wanted. The office then calls on the next working day and arranges a free viewing, on site or by video call. The quote comes in writing, with a cost ceiling.",
          fr: "Nous ne donnons pas de prix au téléphone. Pour le devis il nous faut: d'où à où, la date ou la période, la taille du logement, l'étage et l'ascenseur au départ et à l'arrivée, et les prestations souhaitées. Le bureau rappelle le jour ouvrable suivant et fixe une visite gratuite, sur place ou par appel vidéo. Le devis arrive par écrit, avec un prix plafond.",
        },
      ),
      section(
        "hours",
        { de: "Bürozeiten", it: "Orari dell'ufficio", en: "Office hours", fr: "Heures de bureau" },
        {
          de: "Büro: Montag bis Freitag, 7 bis 12 Uhr und 13 bis 17 Uhr. Umzüge fahren wir von Montag bis Samstag. Tagsüber ist das Team meistens bei Umzügen unterwegs; dann nimmt der digitale Assistent ab.",
          it: "Ufficio: dal lunedì al venerdì, dalle 7 alle 12 e dalle 13 alle 17. I traslochi li facciamo dal lunedì al sabato. Di giorno la squadra è quasi sempre fuori per i traslochi; allora risponde l'assistente digitale.",
          en: "Office: Monday to Friday, 7 am to 12 noon and 1 to 5 pm. We do moves from Monday to Saturday. During the day the team is mostly out on moves; then the digital assistant answers.",
          fr: "Bureau: du lundi au vendredi, de 7 h à 12 h et de 13 h à 17 h. Nous déménageons du lundi au samedi. Pendant la journée l'équipe est presque toujours en déménagement; c'est alors l'assistant numérique qui répond.",
        },
      ),
      section(
        "practical",
        { de: "Gut zu wissen", it: "Buono a sapersi", en: "Good to know", fr: "Bon à savoir" },
        {
          de: "Umzugskartons können Sie mit der Offerte bestellen. Bezahlt wird nach dem Umzug per Rechnung. Das Umzugsgut ist während des Transports versichert; die Einzelheiten stehen in der Offerte.",
          it: "Gli scatoloni si possono ordinare con l'offerta. Si paga dopo il trasloco, con fattura. I beni sono assicurati durante il trasporto; i dettagli sono nell'offerta.",
          en: "Moving boxes can be ordered with the quote. Payment is by invoice after the move. Your belongings are insured during transport; the details are in the quote.",
          fr: "Les cartons de déménagement peuvent être commandés avec le devis. Le paiement se fait sur facture après le déménagement. Vos biens sont assurés pendant le transport; les détails figurent dans le devis.",
        },
      ),
    ],
  }),
};

export const UMZUG_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.offerte-waehrend-umzug`,
    tenantId: ID,
    locale: "de",
    title: "Offertanfrage, während das Team zügelt",
    shows: "Das Team trägt gerade Möbel durchs Treppenhaus und kann nicht abnehmen; der Assistent nimmt die ganze Offertanfrage auf.",
    lines: [
      { role: "assistant", text: GREETING.de },
      {
        role: "caller",
        text: "Grüezi. Ich habe schon zweimal angerufen, es nimmt niemand ab. Ich bräuchte eine Offerte, wir zügeln im März.",
      },
      {
        role: "assistant",
        text: "Tagsüber ist unser Team meistens bei Umzügen unterwegs. Ich nehme Ihre Anfrage gern auf. Von wo nach wo ziehen Sie?",
      },
      { role: "caller", text: "Von Musterwil nach Winterthur." },
      { role: "assistant", text: "Von Musterwil nach Winterthur. Wissen Sie schon das Datum?" },
      { role: "caller", text: "Ende März. Die letzte Woche, genau weiss ich es noch nicht." },
      { role: "assistant", text: "Ich notiere die letzte Märzwoche 2027. Wie gross ist die Wohnung?" },
      {
        role: "caller",
        text: "Dreieinhalb Zimmer. Wir sind im dritten Stock, ohne Lift. Die neue Wohnung ist im ersten, mit Lift.",
      },
      {
        role: "assistant",
        text: "Dreieinhalb Zimmer, vom dritten Stock ohne Lift in den ersten Stock mit Lift. Brauchen Sie etwas dazu, zum Beispiel Einpacken, Möbelmontage oder die Umzugsreinigung?",
      },
      { role: "caller", text: "Die Reinigung, ja. Und das Bett müsste man ab- und wieder aufbauen." },
      {
        role: "assistant",
        text: "Umzugsreinigung mit Abgabegarantie und Möbelmontage, notiert. Wie ist Ihr Name, und unter welcher Nummer erreichen wir Sie?",
      },
      { role: "caller", text: "Sandra Keller. Null sieben neun, null null null, null null, eins zwei." },
      {
        role: "assistant",
        text: "Ich wiederhole: Sandra Keller, null sieben neun, null null null, null null, eins zwei. Stimmt das?",
      },
      { role: "caller", text: "Ja. Was kostet das ungefähr?" },
      {
        role: "assistant",
        text: "Ich habe Ihre Anfrage gespeichert. Einen Preis kann ich Ihnen am Telefon nicht nennen. Wir rufen Sie am nächsten Arbeitstag zurück und machen eine kostenlose Besichtigung ab. Die Offerte bekommen Sie danach schriftlich, mit einem Kostendach.",
        tool: step.lead({
          task: "moving_quote",
          fields: {
            from_locality: "Musterwil",
            to_locality: "Winterthur",
            move_date: "letzte Märzwoche 2027",
            home_size: "rooms_3",
            floor_from: 3,
            lift_from: false,
            floor_to: 1,
            lift_to: true,
            furniture_assembly: true,
            cleaning: true,
          },
          contact: { name: "Sandra Keller", phone: "+41790000012" },
          summary:
            "Umzug einer 3,5-Zimmer-Wohnung von Musterwil (3. Stock ohne Lift) nach Winterthur (1. Stock mit Lift) in der letzten Märzwoche 2027. Gewünscht: Umzugsreinigung mit Abgabegarantie und Bett ab- und aufbauen. Fragt nach dem Preis.",
        }),
      },
      { role: "caller", text: "Gut. Danke, uf Wiederluege." },
      { role: "assistant", text: "Auf Wiederhören, Frau Keller." },
    ],
  },
  {
    id: `${ID}.it.trasloco-con-deposito`,
    tenantId: ID,
    locale: "it",
    title: "Trasloco con deposito dei mobili",
    shows: "Una cliente chiede il prezzo al telefono; l'assistente spiega che arriva dopo un sopralluogo e registra la richiesta completa.",
    lines: [
      { role: "assistant", text: GREETING.it },
      { role: "caller", text: "Buongiorno. Vorrei sapere quanto costa un trasloco per un bilocale." },
      {
        role: "assistant",
        text: "Al telefono non posso darle un prezzo. Lo diamo dopo un sopralluogo gratuito, anche in videochiamata, con un'offerta scritta e un tetto massimo di costo. Intanto posso prendere i dati per l'offerta?",
      },
      { role: "caller", text: "Sì, va bene. Da Musterwil a Lugano, verso fine febbraio." },
      { role: "assistant", text: "Da Musterwil a Lugano, fine febbraio 2027. A che piano abita adesso? C'è l'ascensore?" },
      {
        role: "caller",
        text: "Al quarto, con ascensore. A Lugano non so ancora dove andiamo: per qualche mese i mobili devono stare in deposito.",
      },
      {
        role: "assistant",
        text: "Capito: quarto piano con ascensore, e i mobili per qualche mese in deposito. L'imballaggio lo fate voi, o le serve una mano?",
      },
      { role: "caller", text: "Lo facciamo noi." },
      { role: "assistant", text: "Bene. Come si chiama, e a che numero la possiamo chiamare?" },
      { role: "caller", text: "Chiara Ferrari. Zero sette otto, zero zero zero, zero zero, uno uno." },
      {
        role: "assistant",
        text: "Ripeto: Chiara Ferrari, zero sette otto, zero zero zero, zero zero, uno uno. È giusto?",
      },
      { role: "caller", text: "Sì. L'offerta me la mandate per email?" },
      { role: "assistant", text: "Sì, se mi lascia un indirizzo email." },
      { role: "caller", text: "Chiara punto Ferrari, chiocciola, example punto com." },
      { role: "assistant", text: "Chiara punto Ferrari, chiocciola, example punto com. Ho capito bene?" },
      { role: "caller", text: "Sì, esatto." },
      {
        role: "assistant",
        text: "Ho registrato la richiesta. La richiamiamo il prossimo giorno lavorativo per fissare il sopralluogo. L'offerta poi arriva per iscritto, per email.",
        tool: step.lead({
          task: "moving_quote",
          fields: {
            from_locality: "Musterwil",
            to_locality: "Lugano",
            move_date: "fine febbraio 2027",
            home_size: "rooms_2",
            floor_from: 4,
            lift_from: true,
            packing: false,
            storage: true,
          },
          contact: { name: "Chiara Ferrari", phone: "+41780000011", email: "chiara.ferrari@example.com" },
          summary:
            "Umzug einer 2,5-Zimmer-Wohnung von Musterwil (4. Stock mit Lift) nach Lugano, Ende Februar 2027. Die Möbel sollen einige Monate eingelagert werden; Einpacken macht die Kundin selbst. Offerte per E-Mail gewünscht.",
        }),
      },
      { role: "caller", text: "Perfetto, grazie. Buona giornata." },
    ],
  },
  {
    id: `${ID}.en.put-me-through`,
    tenantId: ID,
    locale: "en",
    title: "A caller who wants a person",
    shows: "A caller with an office move would rather speak to someone; the assistant admits what it does not know and puts the call through to the office.",
    lines: [
      { role: "assistant", text: GREETING.en },
      { role: "caller", text: "Hi. We're moving our office, and to be honest I'd rather talk to a person." },
      {
        role: "assistant",
        text: "Of course. I can take the details for a quote myself, or put you through to our office. Which would you prefer?",
      },
      { role: "caller", text: "Put me through, please. It's a bit complicated. We have servers and a lot of IT equipment." },
      { role: "assistant", text: "Understood. In case the line drops, may I have your name and a number to call you back?" },
      { role: "caller", text: "Tom Harris. Zero seven nine, zero zero zero, zero zero, seven seven." },
      {
        role: "assistant",
        text: "Tom Harris, zero seven nine, zero zero zero, zero zero, seven seven. Is that right?",
      },
      { role: "caller", text: "That's right. Do you actually move servers?" },
      { role: "assistant", text: "I don't know that, and I'd rather not guess. Our office can tell you." },
      { role: "caller", text: "Fine. Put me through, then." },
      {
        role: "assistant",
        text: "I'm putting you through to our office now. One moment, please.",
        tool: step.transfer({
          target: "office",
          reason: "Office move with servers and IT equipment; the caller wants to talk to a person.",
        }),
      },
    ],
  },
  {
    id: `${ID}.fr.deplacer-la-date`,
    tenantId: ID,
    locale: "fr",
    title: "Déplacer un déménagement prévu",
    shows: "Une cliente veut déplacer son déménagement; l'assistant ne peut pas modifier le planning et organise un rappel du bureau.",
    lines: [
      { role: "assistant", text: GREETING.fr },
      {
        role: "caller",
        text: "Bonjour. Nous avons un déménagement prévu avec vous le 15 janvier. Je dois le repousser d'une semaine.",
      },
      {
        role: "assistant",
        text: "Je ne peux pas modifier le planning moi-même, mais je transmets votre demande au bureau. À quel nom est le déménagement?",
      },
      { role: "caller", text: "Dubois. Claire Dubois." },
      { role: "assistant", text: "Merci, Madame Dubois. À quelle date voulez-vous le déplacer?" },
      { role: "caller", text: "Au vendredi 22 janvier, si c'est possible." },
      {
        role: "assistant",
        text: "Du vendredi 15 au vendredi 22 janvier 2027. À quel numéro pouvons-nous vous rappeler?",
      },
      { role: "caller", text: "Zéro sept neuf, zéro zéro zéro, zéro zéro, huit huit." },
      { role: "assistant", text: "Je répète: zéro sept neuf, zéro zéro zéro, zéro zéro, huit huit. C'est juste?" },
      { role: "caller", text: "Oui. Vous pouvez me dire tout de suite si c'est possible?" },
      {
        role: "assistant",
        text: "Non, je ne le sais pas. C'est le bureau qui vérifie les équipes et les camions. Quand êtes-vous joignable?",
      },
      { role: "caller", text: "Plutôt le matin." },
      {
        role: "assistant",
        text: "C'est noté. Nous vous rappelons le jour ouvrable suivant. J'ai noté que le matin vous convient mieux.",
        tool: step.callback({
          name: "Claire Dubois",
          phone: "+41790000088",
          topic: "Umzug vom Freitag, 15. Januar 2027, auf Freitag, 22. Januar 2027, verschieben.",
          preferredTime: "am Morgen",
        }),
      },
      { role: "caller", text: "Très bien, merci. Au revoir." },
      { role: "assistant", text: "Au revoir, Madame Dubois." },
    ],
  },
];
