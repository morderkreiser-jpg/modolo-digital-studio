// Demo business: Beispiel Immobilien, an INVENTED letting agency in the invented town of Musterwil,
// with three invented listings.
//
// The story: a new listing brings dozens of calls a day, mostly the same questions. The assistant
// answers after 20 seconds without reply, when the line is busy, after hours, on weekends and
// holidays; it answers questions about the three listings from the knowledge and books viewings
// in the calendar (one service per listing). It never comments on the chances of an application.
// German only. Every phone number here is a placeholder (see shared.ts).
import type { DemoScript, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import {
  DEMO_KNOWLEDGE_VERSION,
  DEMO_TOWN,
  WORKDAYS,
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

const NAME = "Beispiel Immobilien";
const ID = "demo-immobilien";
const LOCALES: VoiceLocale[] = ["de"];

const GREETING = {
  de: "Grüezi, hier ist der digitale Assistent von Beispiel Immobilien. Ich bin eine KI. Wie kann ich Ihnen helfen?",
};

const OFFICE_DAY = [range("08:30", "12:00"), range("13:30", "17:00")];

// A viewing lasts 20 minutes plus 10 to walk to the door for the next one. The calendar needs the
// whole span inside a bookable range, so the last start is 18:30 on weekdays and 11:30 on Saturday.
const VIEWING = { durationMinutes: 20, bufferAfterMinutes: 10 };

export const IMMOBILIEN_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "realestate",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundene Immobilienverwaltung für die Demo: Vermietung von drei erfundenen Wohnungen und Häusern in Musterwil, mit Besichtigungsterminen.",
    },
  },
  locales: [...LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: { de: "der digitale Assistent von Beispiel Immobilien" },
    formality: formalIn(LOCALES),
    style: ["Name the listing back to the caller (number, rooms, street) so both are sure it is the right one."],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: week(sameDays(WORKDAYS, OFFICE_DAY)),
    holidays: holidays("newYear", "berchtold", "goodFriday"),
  },
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
          id: "letting",
          label: { de: "unsere Vermietung" },
          number: "+41000000051", // placeholder: +41 00 000 00 51 rings nowhere
          available: week(sameDays(WORKDAYS, OFFICE_DAY)),
        },
      ],
    },
    callback: { enabled: true, promise: { de: "Wir rufen Sie am nächsten Arbeitstag zurück." } },
    written: { enabled: false },
    emergency: {
      triggers: ["a fire, a smell of gas or water damage in a building", "a medical emergency"],
      message: {
        de: "Wenn Menschen in Gefahr sind, legen Sie bitte auf und rufen Sie 112 an, die Feuerwehr 118 oder die Sanität 144.",
      },
    },
  },
  tasks: [
    {
      id: "listing_inquiry",
      label: { de: "Anfrage zu einem Objekt" },
      when: "The caller is interested in one of the three listings but no viewing time suits them, or has a question the knowledge does not answer. When a viewing is booked, put the move-in date, the number of people and open questions into the booking notes instead.",
      fields: [
        {
          id: "listing",
          label: { de: "Objekt" },
          type: "choice",
          required: true,
          choices: [
            { id: "listing_101", label: { de: "Objekt 101: 3,5 Zimmer, Musterstrasse 12" } },
            { id: "listing_102", label: { de: "Objekt 102: 2,5 Zimmer, Beispielweg 3" } },
            { id: "listing_103", label: { de: "Objekt 103: 5,5-Zimmer-Reihenhaus, Am Musterbach 7" } },
          ],
        },
        { id: "move_in", label: { de: "Gewünschter Einzug" }, type: "text", required: true, maxLength: 60 },
        { id: "people", label: { de: "Anzahl Personen" }, type: "integer", required: true, min: 1, max: 10 },
        { id: "question", label: { de: "Frage an die Vermietung" }, type: "text", required: false, maxLength: 300 },
      ],
      contact: { name: "required", phone: "required", email: "optional", company: "none" },
    },
  ],
  tools: [
    "check_availability",
    "book_appointment",
    "cancel_appointment",
    "reschedule_appointment",
    "create_lead",
    "request_callback",
    "transfer_call",
    "end_call",
  ],
  calendar: {
    provider: "memory",
    services: [
      { id: "viewing_101", label: { de: "Besichtigung Objekt 101, Musterstrasse 12" }, ...VIEWING },
      { id: "viewing_102", label: { de: "Besichtigung Objekt 102, Beispielweg 3" }, ...VIEWING },
      { id: "viewing_103", label: { de: "Besichtigung Objekt 103, Am Musterbach 7" }, ...VIEWING },
    ],
    // One person shows all three listings, so one viewing at a time.
    capacity: { kind: "single" },
    bookable: week({
      tue: [range("17:00", "19:00")],
      thu: [range("17:00", "19:00")],
      sat: [range("10:00", "12:00")],
    }),
    slotStepMinutes: 30,
    minLeadMinutes: 240,
    maxDaysAhead: 21,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 120,
  },
  rules: [
    "Never comment on the chances or the outcome of an application, never say how many people applied, and never say who gets the flat. The landlord decides after the viewings.",
    "Answer questions about a listing only from the knowledge. Pets, renovations, parking or anything else not stated there: say you do not know and note the question.",
    "Never negotiate the rent or promise a discount, and never reserve a flat for someone.",
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
        "listings",
        { de: "Freie Objekte (erfunden)" },
        {
          de: [
            "Objekt 101: 3,5-Zimmer-Wohnung, Musterstrasse 12, Musterwil. 2. Stock mit Lift, Balkon, 82 Quadratmeter. Miete 2150 Franken pro Monat inklusive Nebenkosten. Frei ab 1. März 2027.",
            "Objekt 102: 2,5-Zimmer-Wohnung, Beispielweg 3, Musterwil. Erdgeschoss mit Sitzplatz, 58 Quadratmeter. Miete 1580 Franken pro Monat inklusive Nebenkosten. Frei ab 1. Februar 2027.",
            "Objekt 103: 5,5-Zimmer-Reihenhaus, Am Musterbach 7, Musterwil. Garten, zwei Badezimmer, 128 Quadratmeter. Miete 3200 Franken pro Monat inklusive Nebenkosten. Frei ab 1. April 2027. Ein Platz in der Einstellhalle kann für 140 Franken pro Monat dazugemietet werden.",
          ].join("\n"),
        },
      ),
      section(
        "viewings",
        { de: "Besichtigungen" },
        {
          de: "Besichtigungen gibt es dienstags und donnerstags von 17 bis 19 Uhr und samstags von 10 bis 12 Uhr, nur mit Termin. Treffpunkt ist vor dem Hauseingang. Wer nicht kommen kann, sagt bitte ab.",
        },
      ),
      section(
        "application",
        { de: "Bewerbung" },
        {
          de: "Das Anmeldeformular gibt es an der Besichtigung. Dazu gehören ein aktueller Auszug aus dem Betreibungsregister und eine Kopie des Ausweises. Über die Vergabe entscheidet die Vermieterschaft.",
        },
      ),
      section("hours", { de: "Bürozeiten" }, { de: "Montag bis Freitag, 8.30 bis 12 Uhr und 13.30 bis 17 Uhr." }),
    ],
  }),
};

export const IMMOBILIEN_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.besichtigung-mit-katze`,
    tenantId: ID,
    locale: "de",
    title: "Besichtigung, und eine Frage zur Katze",
    shows: "Ein Interessent bucht eine Besichtigung; ob eine Katze erlaubt ist, weiss der Assistent nicht, und zu den Chancen der Bewerbung sagt er nichts.",
    lines: [
      { role: "assistant", text: GREETING.de },
      { role: "caller", text: "Grüezi. Ich rufe wegen der Wohnung an der Musterstrasse an. Die mit dreieinhalb Zimmern." },
      {
        role: "assistant",
        text: "Das ist Objekt 101, die 3,5-Zimmer-Wohnung an der Musterstrasse 12, frei ab 1. März 2027. Möchten Sie sie besichtigen?",
      },
      { role: "caller", text: "Ja. Ist eine Katze erlaubt?" },
      {
        role: "assistant",
        text: "Das weiss ich leider nicht. Ich notiere die Frage, und die Vermietung beantwortet sie Ihnen an der Besichtigung.",
      },
      { role: "caller", text: "Gut. Wann kann man sie anschauen?" },
      {
        role: "assistant",
        text: "Die nächste Besichtigung ist am Donnerstag, 3. Dezember. Frei sind noch 17 Uhr und 18 Uhr.",
        tool: step.availability({ service: "viewing_101", date: "2026-12-03" }),
      },
      { role: "caller", text: "Um sechs passt." },
      { role: "assistant", text: "Ab wann möchten Sie einziehen, und wie viele Personen wären Sie?" },
      { role: "caller", text: "Ab März, wir sind zu zweit. Habe ich gute Chancen, wenn ich gleich komme?" },
      {
        role: "assistant",
        text: "Dazu kann ich nichts sagen. Über die Vergabe entscheidet die Vermieterschaft nach den Besichtigungen. Auf welchen Namen und welche Nummer darf ich den Termin eintragen?",
      },
      { role: "caller", text: "Jonas Steiner. Null sieben acht, null null null, null null, sechs sieben." },
      {
        role: "assistant",
        text: "Ich wiederhole: Donnerstag, 3. Dezember, 18 Uhr, Objekt 101, für Jonas Steiner, null sieben acht, null null null, null null, sechs sieben. Stimmt das?",
      },
      { role: "caller", text: "Ja, genau." },
      {
        role: "assistant",
        text: "Die Besichtigung ist eingetragen. Ihre Referenz lautet MV-2R8T. Treffpunkt ist vor dem Hauseingang an der Musterstrasse 12.",
        tool: step.book({
          service: "viewing_101",
          start: "2026-12-03T18:00:00+01:00",
          name: "Jonas Steiner",
          contact: "+41780000067",
          notes: "Einzug ab März 2027, 2 Personen. Offene Frage: Ist eine Katze erlaubt?",
        }),
      },
      { role: "caller", text: "Danke. Adieu." },
    ],
  },
];
