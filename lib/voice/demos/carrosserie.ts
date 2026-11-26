// Demo business: Carrosserie Muster, an INVENTED body shop in the invented town of Musterwil.
//
// The story: everybody is in the workshop, with noisy tools and dirty hands. The assistant
// answers after 20 seconds without reply, when the line is busy, after hours, on weekends and
// holidays. It asks what happened and books a free damage inspection for the estimate in the
// calendar (one inspection at a time). It never estimates costs or says what insurance pays.
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

const NAME = "Carrosserie Muster";
const ID = "demo-carrosserie";
const LOCALES: VoiceLocale[] = ["de"];

const GREETING = {
  de: "Grüezi, Carrosserie Muster. Hier spricht der digitale Assistent, ich bin eine KI. Wie kann ich Ihnen helfen?",
};

const WORKSHOP_DAY = [range("07:30", "12:00"), range("13:00", "17:30")];

export const CARROSSERIE_TENANT: VoiceTenantConfig = {
  id: ID,
  kind: "demo",
  business: {
    name: NAME,
    sector: "bodyshop",
    locality: DEMO_TOWN,
    description: {
      de: "Erfundene Carrosserie für die Demo: Reparatur von Blech- und Lackschäden aller Marken in Musterwil, mit kostenloser Schadenbesichtigung für den Kostenvoranschlag.",
    },
  },
  locales: [...LOCALES],
  defaultLocale: "de",
  persona: {
    assistantName: { de: "der digitale Assistent der Carrosserie Muster" },
    formality: formalIn(LOCALES),
    style: ["A caller with a damaged car may be upset: one short sentence of sympathy, then the practical questions."],
  },
  greeting: { ...GREETING },
  hours: {
    timezone: "Europe/Zurich",
    weekly: week(sameDays(WORKDAYS, WORKSHOP_DAY)),
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
          id: "workshop",
          label: { de: "die Werkstatt" },
          number: "+41000000041", // placeholder: +41 00 000 00 41 rings nowhere
          available: week(sameDays(WORKDAYS, WORKSHOP_DAY)),
        },
      ],
    },
    callback: { enabled: true, promise: { de: "Wir rufen Sie am nächsten Arbeitstag zurück." } },
    written: { enabled: false },
    emergency: {
      triggers: ["an accident with injured people", "a car on fire or leaking fuel"],
      message: {
        de: "Wenn jemand verletzt oder in Gefahr ist, legen Sie bitte auf und rufen Sie 112 an, die Sanität 144 oder die Polizei 117.",
      },
    },
  },
  tasks: [
    {
      id: "damage_report",
      label: { de: "Schadenmeldung" },
      when: "The caller reports damage to a car. Collect the fields, then offer an inspection appointment with the calendar and put the fields into the booking notes. Use create_lead only when the caller does not want to book now.",
      fields: [
        { id: "what_happened", label: { de: "Was ist passiert" }, type: "text", required: true, maxLength: 300 },
        { id: "car", label: { de: "Marke und Modell" }, type: "text", required: true, maxLength: 80 },
        { id: "drivable", label: { de: "Fahrbereit" }, type: "boolean", required: true },
        { id: "insurance_case", label: { de: "Versicherungsfall" }, type: "boolean", required: true },
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
    services: [{ id: "estimate", label: { de: "Schadenbesichtigung für den Kostenvoranschlag" }, durationMinutes: 30 }],
    capacity: { kind: "single" },
    bookable: week(sameDays(WORKDAYS, [range("07:30", "11:30"), range("13:30", "17:00")])),
    slotStepMinutes: 30,
    minLeadMinutes: 120,
    maxDaysAhead: 30,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 240,
  },
  rules: [
    "Never estimate repair costs and never say whether an insurance will pay; the estimate comes after the inspection, and the insurer decides.",
    "Never say how long a repair takes; the workshop says it after the inspection.",
    "If the car is not drivable, offer the transfer to the workshop or a callback; do not organise towing yourself.",
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
        { de: "Reparatur von Blech- und Lackschäden aller Marken: Parkschäden, Unfallschäden, Hagelschäden, Steinschläge und Scheibenersatz." },
      ),
      section(
        "estimate",
        { de: "Kostenvoranschlag" },
        {
          de: "Für einen Kostenvoranschlag schauen wir das Auto bei uns an. Das dauert etwa 30 Minuten und ist kostenlos. Bitte den Fahrzeugausweis mitbringen und, wenn vorhanden, die Angaben der Versicherung.",
        },
      ),
      section(
        "insurance",
        { de: "Versicherung" },
        {
          de: "Mit den meisten Versicherungen rechnen wir direkt ab. Ob ein Schaden gedeckt ist, entscheidet die Versicherung. Ein Ersatzauto ist nach Verfügbarkeit möglich; das klärt die Werkstatt bei der Besichtigung.",
        },
      ),
      section(
        "not_drivable",
        { de: "Auto nicht fahrbereit" },
        { de: "Ist das Auto nicht fahrbereit, organisiert die Werkstatt den Abschleppdienst. Dafür verbindet der Assistent mit der Werkstatt oder lässt zurückrufen." },
      ),
      section("hours", { de: "Öffnungszeiten" }, { de: "Montag bis Freitag, 7.30 bis 12 Uhr und 13 bis 17.30 Uhr." }),
    ],
  }),
};

export const CARROSSERIE_SCRIPTS: DemoScript[] = [
  {
    id: `${ID}.de.parkschaden`,
    tenantId: ID,
    locale: "de",
    title: "Parkschaden, Termin für die Besichtigung",
    shows: "Eine Kundin hat eine Delle vom Parkieren; der Assistent fragt das Nötige und bucht eine Schadenbesichtigung für den Kostenvoranschlag.",
    lines: [
      { role: "assistant", text: GREETING.de },
      { role: "caller", text: "Grüezi. Mir ist jemand ins Auto gefahren, beim Parkieren. Eine Delle hinten links." },
      { role: "assistant", text: "Das ist ärgerlich. Welches Auto ist es, Marke und Modell?" },
      { role: "caller", text: "Ein VW Golf. Ein grauer." },
      { role: "assistant", text: "Ist der Golf noch fahrbereit?" },
      { role: "caller", text: "Ja, ja. Man sieht nur die Delle und ein paar Kratzer." },
      { role: "assistant", text: "Läuft der Schaden über eine Versicherung?" },
      { role: "caller", text: "Ja, über die vom anderen. Er hat mir einen Zettel mit seinen Angaben hinterlassen." },
      {
        role: "assistant",
        text: "Gut. Für den Kostenvoranschlag schauen wir das Auto bei uns an, das dauert etwa eine halbe Stunde und ist kostenlos. Wann passt es Ihnen?",
      },
      { role: "caller", text: "Nächste Woche, am Dienstag, möglichst früh." },
      {
        role: "assistant",
        text: "Am Dienstag, 8. Dezember, ist um 8.30 Uhr oder um 9 Uhr frei.",
        tool: step.availability({ service: "estimate", date: "2026-12-08", partOfDay: "morning" }),
      },
      { role: "caller", text: "Halb neun ist gut. Graf, Nicole Graf. Null sieben neun, null null null, null null, vier fünf." },
      {
        role: "assistant",
        text: "Ich wiederhole: Dienstag, 8. Dezember, 8.30 Uhr, Schadenbesichtigung für Nicole Graf, null sieben neun, null null null, null null, vier fünf. Stimmt das?",
      },
      { role: "caller", text: "Ja." },
      {
        role: "assistant",
        text: "Der Termin ist eingetragen. Ihre Referenz lautet MV-7M3K. Bringen Sie bitte den Fahrzeugausweis mit und den Zettel mit den Angaben des anderen.",
        tool: step.book({
          service: "estimate",
          start: "2026-12-08T08:30:00+01:00",
          name: "Nicole Graf",
          contact: "+41790000045",
          notes:
            "VW Golf, grau. Parkschaden: Delle und Kratzer hinten links. Fahrbereit: ja. Versicherungsfall: ja, über die Versicherung des Verursachers.",
        }),
      },
      { role: "caller", text: "Mache ich. Danke, uf Wiederluege." },
      { role: "assistant", text: "Auf Wiederhören, Frau Graf." },
    ],
  },
];
