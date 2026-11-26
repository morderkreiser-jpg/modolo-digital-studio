// Demo business: Coiffeur Muster, an INVENTED one-chair hairdresser in the invented town of
// Musterwil, open Tuesday to Saturday.
//
// The story: the hairdresser cannot put down the scissors for every call. The assistant answers
// after 15 seconds without reply, when the line is busy, after hours and on holidays, and books,
// moves and cancels appointments in the calendar. It gives no medical, scalp or skin advice.
// German only. Every phone number here is a placeholder (see shared.ts).
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

const NAME = "Coiffeur Muster";
const ID = "demo-coiffeur";
const LOCALES: VoiceLocale[] = ["de"];

const GREETING = {
  de: "Grüezi, Coiffeur Muster. Hier spricht der digitale Assistent, ich bin eine KI. Wie kann ich Ihnen helfen?",
};

export const COIFFEUR_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "hairdresser",
    locality: DEMO_TOWN,
    description: { de: "Erfundener Coiffeursalon für die Demo: eine Coiffeuse, Damen, Herren und Kinder, in Musterwil." },
  },
  locales: [...LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: { de: "der digitale Assistent von Coiffeur Muster" },
    formality: formalIn(LOCALES),
    style: ["Ask which service first (women, men, colour, children): it decides how long the appointment is."],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: week({
      ...sameDays(["tue", "wed", "fri"], [range("08:30", "18:30")]),
      thu: [range("08:30", "20:00")],
      sat: [range("08:00", "15:00")],
    }),
    holidays: holidays("newYear", "berchtold", "goodFriday"),
  },
  answerPolicy: {
    always: false,
    afterHours: true,
    weekends: false,
    holidays: true,
    noAnswerAfterSeconds: 15,
    whenBusy: true,
  },
  handoff: {
    // No transfer: there is only one person, and she is cutting hair.
    transfer: { enabled: false, targets: [], ringSeconds: 20 },
    callback: { enabled: true, promise: { de: "Wir rufen Sie am nächsten Arbeitstag zurück." } },
    written: { enabled: false },
    emergency: {
      triggers: ["a strong reaction after a colour treatment, such as swelling or trouble breathing", "a medical emergency"],
      message: { de: "Bei einem medizinischen Notfall legen Sie bitte auf und rufen Sie 144 an." },
    },
  },
  // Appointments only: the calendar holds everything the salon needs (service, time, name, number).
  tasks: [],
  tools: ["check_availability", "book_appointment", "cancel_appointment", "reschedule_appointment", "request_callback", "end_call"],
  calendar: {
    provider: "memory",
    services: [
      { id: "women_cut", label: { de: "Damen: Waschen, Schneiden, Föhnen" }, durationMinutes: 60 },
      { id: "men_cut", label: { de: "Herren: Schneiden" }, durationMinutes: 30 },
      { id: "colour", label: { de: "Färben mit Schnitt" }, durationMinutes: 120 },
      { id: "children_cut", label: { de: "Kinder bis 12 Jahre" }, durationMinutes: 30 },
    ],
    capacity: { kind: "single" },
    // No `bookable`: an appointment can start whenever it ends before closing time.
    slotStepMinutes: 30,
    minLeadMinutes: 120,
    maxDaysAhead: 60,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 1440,
  },
  rules: [
    "Give no medical, scalp or skin advice and nothing about allergies to colour products; the hairdresser answers such questions in person. Offer to note the question in the booking.",
    "Say prices only as the knowledge states them; for women's cuts and colour the final price follows the consultation at the appointment.",
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
        { de: "Angebot und Preise" },
        {
          de: "Damen Waschen, Schneiden, Föhnen ab 85 Franken. Herren Schneiden 45 Franken. Färben mit Schnitt ab 160 Franken. Kinder bis 12 Jahre 30 Franken. Den genauen Preis für Damen und Farbe nennt die Coiffeuse nach der Beratung am Termin.",
        },
      ),
      section(
        "hours",
        { de: "Öffnungszeiten" },
        { de: "Dienstag, Mittwoch und Freitag 8.30 bis 18.30 Uhr, Donnerstag 8.30 bis 20 Uhr, Samstag 8 bis 15 Uhr. Sonntag und Montag geschlossen." },
      ),
      section(
        "appointments",
        { de: "Termine" },
        {
          de: "Termine bucht der digitale Assistent direkt. Verschieben oder absagen geht bis 24 Stunden vor dem Termin, mit der Referenz aus der Bestätigung.",
        },
      ),
      section("practical", { de: "Gut zu wissen" }, { de: "Bezahlen mit Bargeld, Karte oder TWINT. Gutscheine gibt es im Salon." }),
    ],
  }),
};

export const COIFFEUR_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.termin-verschieben`,
    tenantId: ID,
    locale: "de",
    title: "Den Termin vom Donnerstag verschieben",
    shows: "Eine Kundin kann am Donnerstag nicht; der Assistent findet einen neuen Termin und verschiebt den alten.",
    lines: [
      { role: "assistant", text: GREETING.de },
      {
        role: "caller",
        text: "Grüezi. Ich habe am Donnerstag einen Termin, Schneiden und Föhnen. Ich kann leider nicht. Kann ich ihn verschieben?",
      },
      { role: "assistant", text: "Ja, das geht. Haben Sie die Referenz aus der Bestätigung zur Hand?" },
      { role: "caller", text: "Moment ... M V, drei, F, acht, L." },
      { role: "assistant", text: "MV-3F8L. Und auf welchen Namen läuft der Termin?" },
      { role: "caller", text: "Bianchi. Laura Bianchi." },
      { role: "assistant", text: "Danke, Frau Bianchi. Wann würde es Ihnen passen?" },
      { role: "caller", text: "Am Freitag, am liebsten am Nachmittag." },
      {
        role: "assistant",
        text: "Am Freitag, 11. Dezember, ist um 14 Uhr oder um 16.30 Uhr frei.",
        tool: step.availability({ service: "women_cut", date: "2026-12-11", partOfDay: "afternoon" }),
      },
      { role: "caller", text: "Halb fünf." },
      {
        role: "assistant",
        text: "Ich verschiebe Ihren Termin von Donnerstag auf Freitag, 11. Dezember, 16.30 Uhr. Einverstanden?",
      },
      { role: "caller", text: "Ja." },
      {
        role: "assistant",
        text: "Erledigt. Ihr Termin ist jetzt am Freitag, 11. Dezember, um 16.30 Uhr.",
        tool: step.reschedule({ reference: "MV-3F8L", name: "Laura Bianchi", newStart: "2026-12-11T16:30:00+01:00" }),
      },
      { role: "caller", text: "Super, merci vielmal." },
      { role: "assistant", text: "Gern geschehen. Bis Freitag, Frau Bianchi." },
    ],
  },
];
