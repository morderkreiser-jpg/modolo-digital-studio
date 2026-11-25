// Demo business: Hotel Beispielhof, an INVENTED small hotel in the invented town of Musterwil.
//
// The story: one person at the reception checks guests in, serves breakfast and answers the phone.
// The assistant answers every call, day and night: it answers questions about parking, breakfast
// and late arrival from the knowledge, takes room requests and arrival notices, and puts callers
// through to the reception while it is staffed. It never confirms a room and never takes payment
// data. German only. Every phone number here is a placeholder (see shared.ts).
import type { DemoScript, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import {
  DEMO_KNOWLEDGE_VERSION,
  DEMO_TOWN,
  EVERY_DAY,
  demoNotice,
  demoPrivacy,
  demoRules,
  formalIn,
  range,
  sameDays,
  section,
  step,
  week,
} from "./shared";

const NAME = "Hotel Beispielhof";
const ID = "demo-hotel";
const LOCALES: VoiceLocale[] = ["de"];

const GREETING = {
  de: "Grüezi, Hotel Beispielhof. Hier spricht der digitale Assistent, ich bin eine KI. Wie kann ich Ihnen helfen?",
};

// The reception's hours. A hotel has no closed days, so the holidays of 2027 appear as days with
// shorter reception hours instead.
const RECEPTION = [range("07:00", "22:00")];

export const HOTEL_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "hotel",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundenes Hotel garni für die Demo: 18 Zimmer in Musterwil, mit Frühstück, Rezeption von 7 bis 22 Uhr.",
    },
  },
  locales: [...LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: { de: "der digitale Assistent des Hotels Beispielhof" },
    formality: formalIn(LOCALES),
    style: ["Guests are often travelling while they call: keep answers short and practical."],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: week(sameDays(EVERY_DAY, RECEPTION)),
    holidays: [],
    exceptions: [
      { date: "2027-01-01", ranges: [range("09:00", "20:00")], label: { de: "Neujahr" } },
      { date: "2027-03-29", ranges: [range("08:00", "20:00")], label: { de: "Ostermontag" } },
    ],
  },
  // The assistant takes every call and puts it through to the reception when needed.
  answerPolicy: {
    always: true,
    afterHours: false,
    weekends: false,
    holidays: false,
    noAnswerAfterSeconds: null,
    whenBusy: false,
  },
  handoff: {
    transfer: {
      enabled: true,
      ringSeconds: 25,
      targets: [
        {
          id: "reception",
          label: { de: "die Rezeption" },
          number: "+41000000081", // placeholder: +41 00 000 00 81 rings nowhere
          available: week(sameDays(EVERY_DAY, RECEPTION)),
        },
      ],
    },
    callback: {
      enabled: true,
      promise: { de: "Die Rezeption ruft Sie so bald wie möglich zurück, zwischen 7 und 22 Uhr." },
    },
    written: { enabled: false },
    emergency: {
      triggers: ["fire or smoke", "a medical emergency", "someone in danger in the hotel"],
      message: {
        de: "Wenn jemand in Gefahr ist, legen Sie bitte auf und rufen Sie 112 an, die Feuerwehr 118 oder die Sanität 144.",
      },
    },
  },
  tasks: [
    {
      id: "room_request",
      label: { de: "Zimmeranfrage" },
      when: "The caller asks for a room for certain dates. Take it as a request: the reception confirms availability and price. Never say a room is booked.",
      fields: [
        { id: "arrival_date", label: { de: "Anreise" }, type: "date", required: true },
        { id: "departure_date", label: { de: "Abreise" }, type: "date", required: true },
        { id: "guests", label: { de: "Anzahl Gäste" }, type: "integer", required: true, min: 1, max: 8 },
        {
          id: "room_type",
          label: { de: "Zimmer" },
          type: "choice",
          required: false,
          choices: [
            { id: "single", label: { de: "Einzelzimmer" } },
            { id: "double", label: { de: "Doppelzimmer" } },
            { id: "family", label: { de: "Familienzimmer" } },
          ],
        },
        { id: "arrival_time", label: { de: "Ankunftszeit" }, type: "time", required: false },
        { id: "wishes", label: { de: "Wünsche" }, type: "text", required: false, maxLength: 300 },
      ],
      contact: { name: "required", phone: "required", email: "optional", company: "optional" },
    },
    {
      id: "arrival_notice",
      label: { de: "Ankunftszeit eines Gastes" },
      when: "A guest who already has a reservation tells us when they will arrive, usually late.",
      fields: [
        { id: "arrival_date", label: { de: "Anreise" }, type: "date", required: true },
        { id: "arrival_time", label: { de: "Ankunftszeit" }, type: "time", required: true },
        { id: "notes", label: { de: "Bemerkungen" }, type: "text", required: false, maxLength: 300 },
      ],
      contact: { name: "required", phone: "required", email: "none", company: "none" },
    },
  ],
  tools: ["create_lead", "request_callback", "transfer_call", "end_call"],
  rules: [
    "Never confirm a room or a price: a room request stays a request until the reception confirms it.",
    "Never take payment data on the phone: no card numbers, no expiry dates, no security codes, no bank details.",
    "Never give the code of the key safe; the reception sends it by text message on the day of arrival.",
    "Never promise that a parking space is kept free; the reception decides.",
    ...demoRules(),
  ],
  plan: "demo",
  privacy: demoPrivacy(),
  allowedOrigins: [],
  knowledge: () => ({
    version: DEMO_KNOWLEDGE_VERSION,
    sections: [
      demoNotice(NAME, LOCALES),
      section(
        "hotel",
        { de: "Das Hotel" },
        { de: "Kleines Hotel garni mit 18 Zimmern: Einzel-, Doppel- und Familienzimmer. Kein Restaurant, aber Frühstück." },
      ),
      section(
        "reception",
        { de: "Rezeption, Check-in und späte Ankunft" },
        {
          de: "Die Rezeption ist täglich von 7 bis 22 Uhr besetzt. Check-in ab 15 Uhr, Check-out bis 11 Uhr. Wer nach 22 Uhr ankommt, holt den Schlüssel im Schlüsselsafe neben dem Eingang; den Code schickt die Rezeption am Anreisetag per SMS.",
        },
      ),
      section(
        "breakfast",
        { de: "Frühstück" },
        { de: "Frühstücksbuffet von 7 bis 10 Uhr, am Wochenende bis 10.30 Uhr. Im Zimmerpreis inbegriffen. Glutenfreies Brot auf Anfrage." },
      ),
      section(
        "parking",
        { de: "Parkieren" },
        {
          de: "Hinter dem Haus gibt es sechs Parkplätze für Gäste, 15 Franken pro Nacht. Ob einer freigehalten werden kann, entscheidet die Rezeption. Ein öffentliches Parkhaus ist 300 Meter entfernt.",
        },
      ),
      section(
        "booking",
        { de: "Zimmer und Preise" },
        {
          de: "Die Zimmerpreise hängen vom Datum ab. Verfügbarkeit und Preis bestätigt die Rezeption. Zahlungsangaben nehmen wir am Telefon nie entgegen.",
        },
      ),
    ],
  }),
};

export const HOTEL_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.spaete-ankunft`,
    tenantId: ID,
    locale: "de",
    title: "Späte Ankunft, die Rezeption nimmt nicht ab",
    shows: "Ein Gast kommt spät an und fragt nach einem Parkplatz; die Weiterleitung an die Rezeption klappt nicht, also nimmt der Assistent einen Rückruf auf.",
    lines: [
      { role: "assistant", text: GREETING.de },
      {
        role: "caller",
        text: "Grüezi. Ich habe für Freitag ein Zimmer reserviert und komme erst gegen halb zwölf in der Nacht an. Geht das?",
      },
      {
        role: "assistant",
        text: "Ja, das geht. Die Rezeption ist bis 22 Uhr besetzt. Später holen Sie den Schlüssel im Schlüsselsafe neben dem Eingang, den Code bekommen Sie am Anreisetag per SMS. Auf welchen Namen läuft die Reservation?",
      },
      { role: "caller", text: "Andreas Weber. Meine Nummer ist null sieben neun, null null null, null null, sechs null." },
      {
        role: "assistant",
        text: "Ich wiederhole: Andreas Weber, Ankunft am Freitag, 18. Dezember, gegen 23.30 Uhr, Nummer null sieben neun, null null null, null null, sechs null. Stimmt das?",
      },
      { role: "caller", text: "Ja. Und haben Sie einen Parkplatz?" },
      {
        role: "assistant",
        text: "Ich habe Ihre späte Ankunft für die Rezeption notiert. Hinter dem Haus gibt es sechs Parkplätze, 15 Franken pro Nacht. Ob einer für Sie freigehalten wird, entscheidet die Rezeption.",
        tool: step.lead({
          task: "arrival_notice",
          fields: { arrival_date: "2026-12-18", arrival_time: "23:30" },
          contact: { name: "Andreas Weber", phone: "+41790000060" },
          summary: "Gast mit Reservation kommt am Freitag, 18. Dezember 2026, erst gegen 23.30 Uhr an. Fragt nach einem Parkplatz.",
        }),
      },
      { role: "caller", text: "Dann möchte ich kurz mit der Rezeption sprechen." },
      { role: "assistant", text: "Einen Moment, ich verbinde Sie mit der Rezeption." },
      {
        role: "assistant",
        text: "Die Rezeption nimmt im Moment nicht ab. Soll sie Sie zurückrufen?",
        tool: step.transfer(
          { target: "reception", reason: "Gast möchte einen Parkplatz für seine späte Ankunft am Freitag freihalten lassen." },
          "failed",
        ),
      },
      { role: "caller", text: "Ja, bitte. Wegen dem Parkplatz." },
      {
        role: "assistant",
        text: "Ich habe den Rückruf notiert, wegen eines Parkplatzes für Freitagnacht. Die Rezeption ruft Sie so bald wie möglich zurück, zwischen 7 und 22 Uhr.",
        tool: step.callback({
          name: "Andreas Weber",
          phone: "+41790000060",
          topic: "Parkplatz für die Nacht von Freitag, 18. Dezember, freihalten? Ankunft gegen 23.30 Uhr.",
        }),
      },
      { role: "caller", text: "Gut, danke." },
      { role: "assistant", text: "Gern geschehen. Gute Reise, Herr Weber." },
    ],
  },
];
