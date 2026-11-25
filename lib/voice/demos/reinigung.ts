// Demo business: Beispiel Reinigung, an INVENTED cleaning company in the invented town of Musterwil.
//
// The story: the cleaning teams are out all day and the office is small. The assistant answers
// after 20 seconds without reply, when the line is busy, after hours, on weekends and holidays,
// and takes cleaning requests; it never names a price or promises a date. German only.
// Every phone number here is a placeholder (see shared.ts).
import type { DemoScript, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import {
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

const NAME = "Beispiel Reinigung";
const ID = "demo-reinigung";
const LOCALES: VoiceLocale[] = ["de"];

const GREETING = {
  de: "Grüezi, hier ist der digitale Assistent von Beispiel Reinigung. Ich bin eine KI. Wie kann ich Ihnen helfen?",
};

export const REINIGUNG_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "cleaning",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundenes Reinigungsunternehmen für die Demo: Unterhaltsreinigung von Wohnungen und Büros, Umzugsreinigung mit Abgabegarantie und Fensterreinigung in Musterwil und Umgebung.",
    },
  },
  locales: [...LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: { de: "der digitale Assistent von Beispiel Reinigung" },
    formality: formalIn(LOCALES),
    style: [
      "Callers sometimes change what they want halfway through: follow the latest wish and read the new request back.",
    ],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: tradesWeek(),
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
    // No transfer: the office is not always staffed; it calls back.
    transfer: { enabled: false, targets: [], ringSeconds: 20 },
    callback: { enabled: true, promise: { de: "Wir rufen Sie am nächsten Arbeitstag zurück." } },
    written: { enabled: false },
    emergency: {
      triggers: ["someone is injured", "a medical emergency"],
      message: { de: "Wenn jemand verletzt oder in Gefahr ist, legen Sie bitte auf und rufen Sie 144 oder 112 an." },
    },
  },
  tasks: [
    {
      id: "cleaning_request",
      label: { de: "Reinigungsanfrage" },
      when: "The caller wants a cleaning: regular cleaning of a home or an office, an end-of-tenancy cleaning with handover guarantee, or windows.",
      fields: [
        {
          id: "kind",
          label: { de: "Art der Reinigung" },
          type: "choice",
          required: true,
          choices: [
            { id: "home", label: { de: "Unterhaltsreinigung Wohnung oder Haus" } },
            { id: "office", label: { de: "Büroreinigung" } },
            { id: "end_of_tenancy", label: { de: "Umzugsreinigung mit Abgabegarantie" } },
            { id: "windows", label: { de: "Fensterreinigung" } },
          ],
        },
        { id: "size", label: { de: "Grösse (Zimmer oder Fläche)" }, type: "text", required: true, maxLength: 80 },
        { id: "locality", label: { de: "Ort" }, type: "locality", required: true, maxLength: 80 },
        {
          // Optional: a regular cleaning may start "some time in January".
          id: "date",
          label: { de: "Datum (Abgabetermin oder erster Einsatz)" },
          type: "date",
          required: false,
        },
        {
          id: "frequency",
          label: { de: "Häufigkeit" },
          type: "choice",
          required: true,
          choices: [
            { id: "once", label: { de: "Einmalig" } },
            { id: "weekly", label: { de: "Wöchentlich" } },
            { id: "every_two_weeks", label: { de: "Alle zwei Wochen" } },
            { id: "monthly", label: { de: "Monatlich" } },
          ],
        },
        {
          id: "notes",
          label: { de: "Bemerkungen (z. B. Abgabezeit, Balkon, Haustiere)" },
          type: "text",
          required: false,
          maxLength: 300,
        },
      ],
      contact: { name: "required", phone: "required", email: "optional", company: "optional" },
    },
  ],
  tools: ["create_lead", "request_callback", "end_call"],
  rules: [
    "Never name a price. End-of-tenancy cleanings get a fixed price after a short viewing or photos; regular cleanings are charged by the hour, and the office gives the rate.",
    "Never confirm a date; the office confirms dates when it calls back.",
    "Describe the handover guarantee only as the knowledge states it; never promise that the landlord will accept the flat.",
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
        "services",
        { de: "Leistungen" },
        {
          de: "Unterhaltsreinigung für Wohnungen, Häuser und Büros, einmalig oder regelmässig. Umzugsreinigung mit Abgabegarantie. Fensterreinigung. Reinigungsmittel und Geräte bringen wir mit.",
        },
      ),
      section(
        "guarantee",
        { de: "Abgabegarantie" },
        {
          de: "Bei der Umzugsreinigung mit Abgabegarantie ist jemand von uns bei der Wohnungsabgabe dabei. Beanstandet die Verwaltung die Reinigung, reinigen wir kostenlos nach.",
        },
      ),
      section(
        "prices",
        { de: "Preise" },
        {
          de: "Für die Umzugsreinigung gibt es nach einer kurzen Besichtigung oder nach Fotos einen festen Preis. Unterhaltsreinigung rechnen wir nach Stunden ab; den Stundenansatz nennt das Büro.",
        },
      ),
      section("area", { de: "Einsatzgebiet" }, { de: "Musterwil und Umgebung, etwa 20 Kilometer im Umkreis." }),
      section(
        "hours",
        { de: "Bürozeiten" },
        { de: "Montag bis Freitag, 7 bis 12 Uhr und 13 bis 17 Uhr. Das Büro ruft nach einer Anfrage am nächsten Arbeitstag zurück." },
      ),
    ],
  }),
};

export const REINIGUNG_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.doch-die-ganze-wohnung`,
    tenantId: ID,
    locale: "de",
    title: "Erst die Fenster, dann doch die ganze Wohnung",
    shows: "Die Anruferin unterbricht und ändert ihren Auftrag; der Assistent folgt dem neuen Wunsch, statt beim ersten zu bleiben.",
    lines: [
      { role: "assistant", text: GREETING.de },
      { role: "caller", text: "Grüezi. Ich möchte die Fenster reinigen lassen, in einer Dreizimmerwohnung." },
      { role: "assistant", text: "Gern. In welchem Ort ist die Wohnung?" },
      { role: "caller", text: "In Musterwil. Wir ziehen nämlich aus, Ende Januar ist die Abgabe." },
      { role: "assistant", text: "Gut, eine Fensterreinigung in Musterwil. Soll das vor der Abgabe ..." },
      { role: "caller", text: "Nein, warten Sie. Eigentlich brauchen wir die ganze Wohnung. Mit Abgabe." },
      {
        role: "assistant",
        text: "Verstanden, dann ist es eine Umzugsreinigung mit Abgabegarantie, nicht nur die Fenster. An welchem Datum ist die Abgabe?",
      },
      { role: "caller", text: "Am neunundzwanzigsten Januar. Um zehn Uhr, glaube ich." },
      { role: "assistant", text: "Freitag, 29. Januar 2027, voraussichtlich um 10 Uhr. Die Wohnung hat drei Zimmer?" },
      { role: "caller", text: "Dreieinhalb. Mit Balkon." },
      { role: "assistant", text: "Dreieinhalb Zimmer mit Balkon. Auf welchen Namen und welche Nummer darf ich die Anfrage aufnehmen?" },
      { role: "caller", text: "Lea Huber. Null sieben acht, null null null, null null, fünf sechs." },
      {
        role: "assistant",
        text: "Ich wiederhole: Umzugsreinigung mit Abgabegarantie, dreieinhalb Zimmer mit Balkon in Musterwil, Abgabe am 29. Januar. Lea Huber, null sieben acht, null null null, null null, fünf sechs. Stimmt das?",
      },
      { role: "caller", text: "Ja, genau." },
      {
        role: "assistant",
        text: "Ich habe die Anfrage aufgenommen. Einen festen Preis bekommen Sie nach einer kurzen Besichtigung. Wir rufen Sie am nächsten Arbeitstag zurück.",
        tool: step.lead({
          task: "cleaning_request",
          fields: {
            kind: "end_of_tenancy",
            size: "3,5 Zimmer mit Balkon",
            locality: "Musterwil",
            date: "2027-01-29",
            frequency: "once",
            notes: "Abgabe voraussichtlich um 10 Uhr.",
          },
          contact: { name: "Lea Huber", phone: "+41780000056" },
          summary:
            "Umzugsreinigung mit Abgabegarantie für eine 3,5-Zimmer-Wohnung mit Balkon in Musterwil. Abgabe am Freitag, 29. Januar 2027, voraussichtlich um 10 Uhr. Zuerst war nur eine Fensterreinigung gewünscht.",
        }),
      },
      { role: "caller", text: "Gut, danke vielmal. Uf Wiederluege." },
    ],
  },
];
