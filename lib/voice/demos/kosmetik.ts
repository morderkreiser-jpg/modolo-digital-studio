// Demo business: Kosmetikstudio Beispiel, an INVENTED beauty studio in the invented town of
// Musterwil.
//
// The story: during a treatment the beautician cannot answer the phone. The assistant answers
// after 20 seconds without reply, when the line is busy, after hours and on holidays, and books,
// moves and cancels appointments in the calendar. It gives no medical or skin advice: such
// questions go into the booking notes for the beautician. German only.
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
  range,
  sameDays,
  section,
  step,
  week,
} from "./shared";

const NAME = "Kosmetikstudio Beispiel";
const ID = "demo-kosmetik";
const LOCALES: VoiceLocale[] = ["de"];

const GREETING = {
  de: "Grüezi, hier ist der digitale Assistent vom Kosmetikstudio Beispiel. Ich bin eine KI. Wie kann ich Ihnen helfen?",
};

export const KOSMETIK_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "beauty",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundenes Kosmetikstudio für die Demo: Gesichtsbehandlungen, Maniküre, Pediküre und Wimpern färben in Musterwil.",
    },
  },
  locales: [...LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: { de: "der digitale Assistent vom Kosmetikstudio Beispiel" },
    formality: formalIn(LOCALES),
    style: ["Ask which treatment first: it decides how long the appointment is."],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: week({
      ...sameDays(["tue", "wed", "thu", "fri"], [range("09:00", "12:00"), range("13:30", "18:30")]),
      sat: [range("09:00", "14:00")],
    }),
    holidays: holidays("newYear", "goodFriday", "easterMonday"),
  },
  answerPolicy: {
    always: false,
    afterHours: true,
    weekends: false,
    holidays: true,
    noAnswerAfterSeconds: 20,
    whenBusy: true,
  },
  handoff: {
    // No transfer: the beautician is with a client.
    transfer: { enabled: false, targets: [], ringSeconds: 20 },
    callback: { enabled: true, promise: { de: "Wir rufen Sie am nächsten Arbeitstag zurück." } },
    written: { enabled: false },
    emergency: {
      triggers: ["a strong skin reaction or swelling after a treatment", "trouble breathing", "a medical emergency"],
      message: { de: "Bei einem medizinischen Notfall legen Sie bitte auf und rufen Sie 144 an." },
    },
  },
  // Appointments only: the calendar holds everything the studio needs.
  tasks: [],
  tools: ["check_availability", "book_appointment", "cancel_appointment", "reschedule_appointment", "request_callback", "end_call"],
  calendar: {
    provider: "memory",
    services: [
      { id: "facial", label: { de: "Klassische Gesichtsbehandlung" }, durationMinutes: 60 },
      { id: "manicure", label: { de: "Maniküre" }, durationMinutes: 45, bufferAfterMinutes: 15 },
      { id: "pedicure", label: { de: "Pediküre" }, durationMinutes: 60 },
      { id: "lashes", label: { de: "Wimpern und Brauen färben" }, durationMinutes: 30 },
    ],
    capacity: { kind: "single" },
    slotStepMinutes: 30,
    minLeadMinutes: 240,
    maxDaysAhead: 60,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 1440,
  },
  rules: [
    "Give no medical or skin advice: nothing about skin conditions, allergies, medication, pregnancy or whether a treatment suits someone. The beautician answers these in person; offer to note the question in the booking.",
    "Moving or cancelling needs the booking reference and the name. Less than 24 hours before the start, offer a callback instead.",
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
        { de: "Behandlungen und Preise" },
        {
          de: "Klassische Gesichtsbehandlung, 60 Minuten, 120 Franken. Maniküre 60 Franken. Pediküre 75 Franken. Wimpern und Brauen färben 35 Franken.",
        },
      ),
      section(
        "first_visit",
        { de: "Erster Besuch" },
        {
          de: "Beim ersten Termin füllen Sie einen kurzen Fragebogen aus. Fragen zur Haut, zu Allergien oder Medikamenten bespricht die Kosmetikerin persönlich mit Ihnen.",
        },
      ),
      section(
        "cancellation",
        { de: "Verschieben und absagen" },
        { de: "Verschieben oder absagen ist bis 24 Stunden vor dem Termin kostenlos." },
      ),
      section(
        "hours",
        { de: "Öffnungszeiten" },
        { de: "Dienstag bis Freitag 9 bis 12 Uhr und 13.30 bis 18.30 Uhr, Samstag 9 bis 14 Uhr. Sonntag und Montag geschlossen." },
      ),
    ],
  }),
};

export const KOSMETIK_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.erster-termin`,
    tenantId: ID,
    locale: "de",
    title: "Die erste Gesichtsbehandlung, mit einer Frage zur Haut",
    shows: "Eine Neukundin bucht eine Gesichtsbehandlung und fragt nach ihrer empfindlichen Haut; der Assistent gibt keinen Rat und notiert die Frage für die Kosmetikerin.",
    lines: [
      { role: "assistant", text: GREETING.de },
      { role: "caller", text: "Grüezi. Ich möchte eine Gesichtsbehandlung buchen. Ich war noch nie bei Ihnen." },
      {
        role: "assistant",
        text: "Gern. Die klassische Gesichtsbehandlung dauert eine Stunde und kostet 120 Franken. Welcher Tag passt Ihnen?",
      },
      { role: "caller", text: "Nächsten Mittwoch, am Nachmittag." },
      {
        role: "assistant",
        text: "Am Mittwoch, 16. Dezember, ist um 14.30 Uhr oder um 16 Uhr frei.",
        tool: step.availability({ service: "facial", date: "2026-12-16", partOfDay: "afternoon" }),
      },
      { role: "caller", text: "Um halb drei. Ich habe aber sehr empfindliche Haut, mit Rötungen. Geht das überhaupt?" },
      {
        role: "assistant",
        text: "Das kann ich nicht beurteilen, und eine Hautberatung gebe ich nicht. Ich notiere es für die Kosmetikerin, sie bespricht es vor der Behandlung mit Ihnen.",
      },
      { role: "caller", text: "Gut, das ist mir recht." },
      { role: "assistant", text: "Auf welchen Namen darf ich den Termin eintragen?" },
      { role: "caller", text: "Petra Müller." },
      { role: "assistant", text: "Und unter welcher Nummer erreichen wir Sie?" },
      { role: "caller", text: "Null sieben sechs, null null null, null null, acht neun." },
      {
        role: "assistant",
        text: "Ich wiederhole: Mittwoch, 16. Dezember, 14.30 Uhr, Gesichtsbehandlung für Petra Müller, null sieben sechs, null null null, null null, acht neun. Stimmt das?",
      },
      { role: "caller", text: "Ja." },
      {
        role: "assistant",
        text: "Ihr Termin ist eingetragen. Ihre Referenz lautet MV-6P2D. Verschieben oder absagen können Sie bis 24 Stunden vorher kostenlos.",
        tool: step.book({
          service: "facial",
          start: "2026-12-16T14:30:00+01:00",
          name: "Petra Müller",
          contact: "+41760000089",
          notes: "Erster Besuch. Frage für die Kosmetikerin: sehr empfindliche Haut mit Rötungen.",
        }),
      },
      { role: "caller", text: "Danke. Uf Wiederluege." },
    ],
  },
];
