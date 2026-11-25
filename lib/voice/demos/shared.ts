// Building blocks shared by the fictional demo businesses of Modolo Voice AI (lib/voice/demos/*).
//
// Every demo business is INVENTED, and says so: its name contains "Muster" or "Beispiel", it sits
// in the invented town of Musterwil, its knowledge opens with a notice that it is made up, and its
// rules tell the model to admit it when asked.
//
// PHONE NUMBERS ARE PLACEHOLDERS. Transfer targets use +41 00 000 00 NN (E.164 "+410000000NN"):
// after the country code a Swiss number never starts with 0, so these cannot ring any line. The
// numbers callers give in the example conversations (07x 000 00 NN, written "+417x00000NN") only
// look like mobile numbers; they were chosen to be obviously fake and belong to nobody we know of.
//
// Plain data and pure functions: no Node or Next APIs. Every helper returns fresh objects, so no
// two tenants share a mutable array or object by accident.
import type {
  DemoScriptLine,
  Formality,
  TaskField,
  TimeRange,
  VoiceKnowledgeSection,
  VoiceLocale,
  VoicePrivacy,
  VoiceText,
  WeeklySchedule,
  Weekday,
} from "@/lib/voice/types";

/** The invented town of every demo business. */
export const DEMO_TOWN = "Musterwil";

/** Knowledge version of the demo data; bump it when a demo's facts change (prompt cache key). */
export const DEMO_KNOWLEDGE_VERSION = "demo-2026-11-25";

/** Where a maintainer finds the origin of a demo fact. Never sent to the model. */
export const DEMO_SOURCE = "Invented for the Modolo Voice AI demo; not a real business.";

/** The four languages of the multilingual demos. Tenants take a copy: `[...ALL_LOCALES]`. */
export const ALL_LOCALES: readonly VoiceLocale[] = ["de", "it", "en", "fr"];

// ---------------------------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------------------------

export function range(from: string, to: string): TimeRange {
  return { from, to };
}

/**
 * A full week from the days given; every other day is closed ([]). Each day gets its own copy of
 * the ranges, so editing one day of one tenant never changes another.
 */
export function week(days: Partial<Record<Weekday, readonly TimeRange[]>>): WeeklySchedule {
  const copy = (day: Weekday): TimeRange[] => (days[day] ?? []).map((r) => ({ from: r.from, to: r.to }));
  return {
    mon: copy("mon"),
    tue: copy("tue"),
    wed: copy("wed"),
    thu: copy("thu"),
    fri: copy("fri"),
    sat: copy("sat"),
    sun: copy("sun"),
  };
}

/** The same ranges on several days. */
export function sameDays(days: readonly Weekday[], ranges: readonly TimeRange[]): Partial<Record<Weekday, TimeRange[]>> {
  const result: Partial<Record<Weekday, TimeRange[]>> = {};
  for (const day of days) result[day] = ranges.map((r) => ({ from: r.from, to: r.to }));
  return result;
}

export const WORKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
export const EVERY_DAY: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The usual day of a Swiss trade: 07:00-12:00 and 13:00-17:00. */
export function tradesDay(): TimeRange[] {
  return [range("07:00", "12:00"), range("13:00", "17:00")];
}

/** Monday to Friday, 07:00-12:00 and 13:00-17:00. */
export function tradesWeek(): WeeklySchedule {
  return week(sameDays(WORKDAYS, tradesDay()));
}

type HolidayKey = "newYear" | "berchtold" | "goodFriday" | "easterMonday" | "ascension" | "whitMonday";

// Public holidays of the canton of Zurich in 2027 (Easter Sunday 2027 is 28 March). Each demo
// lists two or three of them as examples; a real tenant would list all of its own.
const HOLIDAYS_2027: Record<HolidayKey, { date: string; label: VoiceText }> = {
  newYear: { date: "2027-01-01", label: { de: "Neujahr", it: "Capodanno", en: "New Year's Day", fr: "Nouvel An" } },
  berchtold: {
    date: "2027-01-02",
    label: { de: "Berchtoldstag", it: "San Bertoldo", en: "Berchtold's Day", fr: "Saint-Berthold" },
  },
  goodFriday: {
    date: "2027-03-26",
    label: { de: "Karfreitag", it: "Venerdì santo", en: "Good Friday", fr: "Vendredi saint" },
  },
  easterMonday: {
    date: "2027-03-29",
    label: { de: "Ostermontag", it: "Lunedì di Pasqua", en: "Easter Monday", fr: "Lundi de Pâques" },
  },
  ascension: { date: "2027-05-06", label: { de: "Auffahrt", it: "Ascensione", en: "Ascension Day", fr: "Ascension" } },
  whitMonday: {
    date: "2027-05-17",
    label: { de: "Pfingstmontag", it: "Lunedì di Pentecoste", en: "Whit Monday", fr: "Lundi de Pentecôte" },
  },
};

export function holidays(...keys: HolidayKey[]): Array<{ date: string; label: VoiceText }> {
  return keys.map((key) => ({ date: HOLIDAYS_2027[key].date, label: { ...HOLIDAYS_2027[key].label } }));
}

// ---------------------------------------------------------------------------------------------
// Persona, privacy, rules
// ---------------------------------------------------------------------------------------------

/** Formal address ("Sie", "Lei", "vous", polite English) in every language the tenant speaks. */
export function formalIn(locales: readonly VoiceLocale[]): Partial<Record<VoiceLocale, Formality>> {
  const result: Partial<Record<VoiceLocale, Formality>> = {};
  for (const locale of locales) result[locale] = "formal";
  return result;
}

// persona.style holds only what is particular to each business. The general speaking rules
// (formal address from persona.formality, one question at a time, reading details back, Swiss
// spelling, no exclamation marks, "I don't know" instead of guessing) are already in every prompt
// (lib/voice/prompt.ts); repeating them here would only make every call's prompt longer.

/**
 * Rules every demo shares. Business-specific ones come first in each tenant. The prompt also says
 * that a demo is fictional; the rule stays in the data so the promise does not depend on it.
 */
export function demoRules(): string[] {
  return [
    "This business is fictional and exists only as a demo. If the caller asks whether it is real, say plainly that it is an invented example business.",
    "Never invent staff names, addresses, prices or promises that the knowledge does not contain.",
    "Never take payment details on the phone: no card numbers, no bank details, no codes.",
  ];
}

/** The privacy settings of every demo: no audio, no transcripts, summaries for 30 days. */
export function demoPrivacy(): VoicePrivacy {
  return {
    recordAudio: false,
    transcriptRetentionDays: 0,
    summaryRetentionDays: 30,
    // The site's privacy page per language; French has no page, so it gets the English one.
    noticeUrl: { de: "/de/datenschutz", it: "/it/privacy", en: "/privacy", fr: "/privacy" },
  };
}

// ---------------------------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------------------------

/** One knowledge section of a demo. The source note is the same for all: invented. */
export function section(id: string, title: VoiceText, content: VoiceText): VoiceKnowledgeSection {
  return { id, title, content, source: DEMO_SOURCE };
}

/**
 * The first section of every demo's knowledge: the business is made up. The model reads it before
 * anything else, so "is this a real company?" always gets an honest answer.
 */
export function demoNotice(name: string, locales: readonly VoiceLocale[]): VoiceKnowledgeSection {
  const title: VoiceText = {
    de: "Hinweis: erfundener Betrieb",
    it: "Nota: attività inventata",
    en: "Note: invented business",
    fr: "Remarque: entreprise inventée",
  };
  const content: VoiceText = {
    de: `${name} ist ein erfundener Betrieb. Er dient nur als Beispiel für den digitalen Telefonassistenten. Den Ort Musterwil gibt es nicht. Termine, Reservationen und Anfragen aus diesem Gespräch sind Beispiele und erreichen keinen echten Betrieb.`,
    it: `${name} è un'attività inventata, che serve solo da esempio per l'assistente telefonico digitale. Il paese di Musterwil non esiste. Appuntamenti, prenotazioni e richieste di questa conversazione sono esempi e non arrivano a nessuna attività reale.`,
    en: `${name} is an invented business, used only as an example of the digital phone assistant. The town of Musterwil does not exist. Appointments, reservations and requests made in this conversation are examples and reach no real business.`,
    fr: `${name} est une entreprise inventée, qui sert uniquement d'exemple pour l'assistant téléphonique numérique. La localité de Musterwil n'existe pas. Les rendez-vous, réservations et demandes de cette conversation sont des exemples et n'arrivent à aucune entreprise réelle.`,
  };
  return section("demo_notice", only(title, locales), only(content, locales));
}

/** `text` reduced to the given locales (a German-only demo carries German text only). */
export function only(text: VoiceText, locales: readonly VoiceLocale[]): VoiceText {
  const result: VoiceText = {};
  for (const locale of locales) {
    const value = text[locale];
    if (value !== undefined) result[locale] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Task fields used by several trades
// ---------------------------------------------------------------------------------------------

export type Urgency = "emergency" | "urgent" | "soon" | "flexible";

const URGENCY_LABELS: Record<Urgency, VoiceText> = {
  emergency: { de: "Notfall, jetzt", it: "Emergenza, adesso", en: "Emergency, now", fr: "Urgence, maintenant" },
  urgent: {
    de: "Dringend, heute oder morgen",
    it: "Urgente, oggi o domani",
    en: "Urgent, today or tomorrow",
    fr: "Urgent, aujourd'hui ou demain",
  },
  soon: {
    de: "In den nächsten Tagen oder Wochen",
    it: "Nei prossimi giorni o settimane",
    en: "In the next days or weeks",
    fr: "Dans les prochains jours ou semaines",
  },
  flexible: { de: "Nicht dringend", it: "Non urgente", en: "Not urgent", fr: "Pas urgent" },
};

/**
 * The fields a trade (plumber, electrician, painter) needs for a job request: what, where, how
 * urgent, a short description and when the caller can be reached. Contact details come from the
 * task's `contact` rule, not from fields.
 */
export function serviceRequestFields(args: {
  jobChoices: Array<{ id: string; label: VoiceText }>;
  urgencies: readonly Urgency[];
  locales: readonly VoiceLocale[];
}): TaskField[] {
  const { jobChoices, urgencies, locales } = args;
  return [
    {
      id: "job_kind",
      label: only({ de: "Art der Arbeit", it: "Tipo di lavoro", en: "Kind of job", fr: "Type de travail" }, locales),
      type: "choice",
      required: true,
      choices: jobChoices.map((choice) => ({ id: choice.id, label: only(choice.label, locales) })),
    },
    {
      id: "locality",
      label: only({ de: "Ort", it: "Località", en: "Locality", fr: "Localité" }, locales),
      type: "locality",
      required: true,
      maxLength: 80,
    },
    {
      id: "urgency",
      label: only({ de: "Dringlichkeit", it: "Urgenza", en: "Urgency", fr: "Urgence" }, locales),
      type: "choice",
      required: true,
      choices: urgencies.map((id) => ({ id, label: only(URGENCY_LABELS[id], locales) })),
    },
    {
      id: "description",
      label: only(
        { de: "Kurze Beschreibung", it: "Breve descrizione", en: "Short description", fr: "Brève description" },
        locales,
      ),
      type: "text",
      required: true,
      maxLength: 400,
    },
    {
      id: "reachable",
      label: only(
        {
          de: "Wann erreichbar",
          it: "Quando è raggiungibile",
          en: "When the caller can be reached",
          fr: "Quand joignable",
        },
        locales,
      ),
      type: "text",
      required: true,
      maxLength: 100,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Tool steps of the example conversations
// ---------------------------------------------------------------------------------------------
//
// Every tool input in a script is built here, so the scripts read as conversations and the shape
// of the inputs lives in one place, next to the schemas they must pass (lib/voice/tools/
// definitions.ts; the tests replay every step through lib/voice/tools/validate.ts). Dates are
// YYYY-MM-DD, starts are ISO 8601 with the winter offset +01:00, phones are E.164.

type Step = NonNullable<DemoScriptLine["tool"]>;
type Outcome = Step["outcome"];

function withOptional(base: Record<string, unknown>, optional: Record<string, unknown>): Record<string, unknown> {
  const input = { ...base };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) input[key] = value;
  return input;
}

/** create_lead takes every field as text: booleans as "yes"/"no", numbers as digits. */
function asFieldText(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export const step = {
  /** `partySize` only for a seats calendar (restaurant): the other schemas have no such property. */
  availability(
    args: { service: string; date: string; partySize?: number; partOfDay?: "morning" | "afternoon" | "evening" },
    outcome: Outcome = "ok",
  ): Step {
    return {
      name: "check_availability",
      input: withOptional(
        { service: args.service, date: args.date },
        { party_size: args.partySize, part_of_day: args.partOfDay },
      ),
      outcome,
    };
  },

  book(
    args: { service: string; start: string; name: string; contact: string; partySize?: number; notes?: string },
    outcome: Outcome = "ok",
  ): Step {
    return {
      name: "book_appointment",
      input: withOptional(
        { service: args.service, start: args.start, name: args.name, contact: args.contact },
        { party_size: args.partySize, notes: args.notes },
      ),
      outcome,
    };
  },

  cancel(args: { reference: string; name: string }, outcome: Outcome = "ok"): Step {
    return { name: "cancel_appointment", input: { reference: args.reference, name: args.name }, outcome };
  },

  reschedule(args: { reference: string; name: string; newStart: string }, outcome: Outcome = "ok"): Step {
    return {
      name: "reschedule_appointment",
      input: { reference: args.reference, name: args.name, new_start: args.newStart },
      outcome,
    };
  },

  /**
   * `summary` is for the team, in the tenant's default language (German for every demo), whatever
   * language the call was in.
   */
  lead(
    args: {
      task: string;
      fields: Record<string, string | number | boolean>;
      contact: { name?: string; phone?: string; email?: string; company?: string };
      summary: string;
    },
    outcome: Outcome = "ok",
  ): Step {
    const fields: Record<string, string> = {};
    for (const [id, value] of Object.entries(args.fields)) fields[id] = asFieldText(value);
    return {
      name: "create_lead",
      input: withOptional({ task: args.task, fields }, { ...args.contact, summary: args.summary }),
      outcome,
    };
  },

  callback(
    args: { name: string; phone: string; topic: string; preferredTime?: string },
    outcome: Outcome = "ok",
  ): Step {
    return {
      name: "request_callback",
      input: withOptional(
        { name: args.name, phone: args.phone, topic: args.topic },
        { preferred_time: args.preferredTime },
      ),
      outcome,
    };
  },

  transfer(args: { target: string; reason: string }, outcome: Outcome = "ok"): Step {
    return { name: "transfer_call", input: { target: args.target, reason: args.reason }, outcome };
  },
};
