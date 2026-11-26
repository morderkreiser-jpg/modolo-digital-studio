// The call summary: what a conversation produced, for the business. Server-only.
//
//   buildCallSummary()    the structured result (CallSummary) from the session state
//   renderSummaryEmail()  a plain-text email in the tenant's default language: facts only, what
//                         the caller wants first, then the facts about the call
//   deliverRequest()      a request or callback wish, sent to the business the moment the tool
//                         takes it: it must not depend on the session ending properly (the end
//                         report may never come). The caller is told it was passed on only when
//                         the email service accepted it.
//   deliverSummary()      the summary at the end, but ONLY for a live tenant with a recipient, at
//                         least one outcome and an email service configured; otherwise it does
//                         nothing and says why. Demo tenants never send email: their businesses
//                         are invented. endOfCallSummary() leaves out what deliverRequest() sent
//                         already, so no request reaches the business twice.
//   deliverLateOutcomes() the addendum of a turn that finished after the summary was made from
//                         the stored state (review finding S2-6): what that turn did, alone.
//
// The email carries what the caller gave the tools (names, numbers, addresses): it goes to the
// business's own address and nowhere else, and nothing of it is logged. The sending follows the
// chat's lead notifications (lib/assistant/server/leads.ts): Resend's REST API with the key and
// sender of the assistant's configuration (RESEND_API_KEY, CONTACT_FROM). lib/email.ts only
// builds the contact form's auto-reply, so there is no shared sender to reuse.
//
// In development without RESEND_API_KEY, VOICE_DEV_OUTBOX=true hands these emails to the
// development outbox (outbox.ts) instead: printed on the server console and counted as delivered,
// so the whole conversation can be tried on a laptop. Never in production (env.ts).
import { getAssistantEnv } from "@/lib/assistant/server/env";
import { formatClockTime, zonedParts } from "@/lib/voice/hours";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { isValidEmail } from "@/lib/voice/tools/validate";
import type { CallSummary, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import { logVoiceEvent } from "./log";
import { DEV_OUTBOX_FROM, devOutboxSwitchedOn, sendToDevOutbox } from "./outbox";
import type { VoiceSessionState } from "./state";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** How long one email may take before its outcome counts as unknown. */
export const EMAIL_TIMEOUT_MS = 8_000;
const MAX_VALUE_CHARS = 1000;

type Outcome = CallSummary["outcomes"][number];

/** The structured result of one session. `endedAt` is a Date or unix ms. */
export function buildCallSummary(state: VoiceSessionState, tenant: VoiceTenantConfig, endedAt: Date | number): CallSummary {
  const end = endedAt instanceof Date ? endedAt.getTime() : endedAt;
  const duration = Number.isFinite(end) ? Math.max(0, Math.round((end - state.startedAt) / 1000)) : 0;
  const outcomes = [...state.outcomes];
  return {
    tenant: tenant.id,
    sessionId: state.sessionId,
    channel: state.channel,
    startedAt: new Date(state.startedAt).toISOString(),
    durationSeconds: duration,
    locale: state.locale,
    outcomes,
    noOutcome: outcomes.length === 0,
  };
}

/** Outcome kinds delivered to the business the moment they happen (deliverRequest). */
const DELIVERED_AT_ONCE: ReadonlySet<Outcome["kind"]> = new Set(["lead", "callback"]);

/**
 * The summary emailed when the session ends: everything except what was already sent while the
 * call ran (requests and callback wishes). `noOutcome` still describes the whole call.
 */
export function endOfCallSummary(state: VoiceSessionState, tenant: VoiceTenantConfig, endedAt: Date | number): CallSummary {
  const summary = buildCallSummary(state, tenant, endedAt);
  return { ...summary, outcomes: summary.outcomes.filter((outcome) => !DELIVERED_AT_ONCE.has(outcome.kind)) };
}

/**
 * The addendum ("Nachtrag") of a turn that finished after the end of its session had stopped
 * waiting for it and made the summary from the stored state (handlers.ts, persistUnlessEnded):
 * what that turn did beyond the first `since` outcomes of `state` (those it loaded), less what
 * went out at once. Sent like a request: same conditions, same sender, and an idempotency key of
 * the session and `since`, so a second try of the same turn is not delivered twice. null when
 * there is nothing to add. Never throws.
 */
export async function deliverLateOutcomes(args: {
  state: VoiceSessionState;
  tenant: VoiceTenantConfig;
  since: number;
  resend?: ResendConfig | null;
  send?: SendEmail;
  now?: number;
}): Promise<SummaryDelivery | null> {
  const { state, tenant } = args;
  const outcomes = state.outcomes.slice(Math.max(0, args.since)).filter((outcome) => !DELIVERED_AT_ONCE.has(outcome.kind));
  if (outcomes.length === 0) return null;
  const summary = buildCallSummary(state, tenant, args.now ?? Date.now());
  return deliverSummary({
    summary: { ...summary, outcomes, noOutcome: false },
    tenant,
    resend: args.resend,
    send: args.send,
    late: true,
    idempotencyKey: `mva-late-${state.sessionId}-${Math.max(0, args.since)}`,
  });
}

// ---------------------------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------------------------

interface Labels {
  assistant: string;
  intro: string;
  /** Intro of a request sent while the call still runs. */
  requestIntro: string;
  /** Subject prefix and intro of what a turn did after the summary was made (deliverLateOutcomes). */
  late: string;
  lateIntro: string;
  reschedule: string;
  started: string;
  duration: (minutes: number, seconds: number) => string;
  language: string;
  channel: string;
  channels: Record<CallSummary["channel"], string>;
  session: string;
  reference: string;
  lead: string;
  booking: string;
  cancellation: string;
  callback: string;
  transfer: string;
  emergency: string;
  connected: string;
  notConnected: string;
  topic: string;
  preferredTime: string;
  contactKeys: Record<string, string>;
  bookingContact: string;
  partySize: string;
  notes: string;
  service: string;
  noOutcome: string;
  more: (count: number) => string;
  footer: string;
  languages: Record<VoiceLocale, string>;
  date: (day: string, month: string, year: string) => string;
}

const LABELS: Record<VoiceLocale, Labels> = {
  de: {
    assistant: "Sprachassistent",
    intro: "Der KI-Sprachassistent hat dieses Gespräch geführt.",
    requestIntro: "Der KI-Sprachassistent hat diese Anfrage während eines Gesprächs aufgenommen.",
    late: "Nachtrag:",
    lateIntro: "Nachtrag: Der KI-Sprachassistent hat dies ganz am Ende des Gesprächs erledigt, deshalb kommt es separat.",
    reschedule: "Termin verschoben",
    started: "Beginn",
    duration: (m, s) => `Dauer: ${m} Min. ${s} Sek.`,
    language: "Sprache",
    channel: "Kanal",
    channels: { web: "Website", phone: "Telefon" },
    session: "Sitzung",
    reference: "Referenz",
    lead: "Anfrage",
    booking: "Termin gebucht",
    cancellation: "Termin abgesagt",
    callback: "Rückruf erbeten",
    transfer: "Weiterleitung",
    emergency: "Notfallhinweis gegeben",
    connected: "verbunden",
    notConnected: "nicht angenommen",
    topic: "Anliegen",
    preferredTime: "Gewünschte Zeit",
    contactKeys: { name: "Name", phone: "Telefon", email: "E-Mail", company: "Firma" },
    bookingContact: "Kontakt",
    partySize: "Personen",
    notes: "Bemerkungen",
    service: "Leistung",
    noOutcome: "Das Gespräch endete ohne Anfrage, Termin oder Rückrufwunsch.",
    more: (count) => `und ${count} weitere`,
    footer: "Die Angaben stammen aus einem automatischen Gespräch und können Fehler enthalten. Bitte vor einer Zusage prüfen.",
    languages: { de: "Deutsch", it: "Italienisch", en: "Englisch", fr: "Französisch" },
    date: (d, m, y) => `${d}.${m}.${y}`,
  },
  it: {
    assistant: "Assistente vocale",
    intro: "L'assistente vocale AI ha condotto questa conversazione.",
    requestIntro: "L'assistente vocale AI ha raccolto questa richiesta durante una conversazione.",
    late: "Aggiunta:",
    lateIntro: "Aggiunta: l'assistente vocale AI l'ha fatto proprio alla fine della conversazione, per questo arriva a parte.",
    reschedule: "Appuntamento spostato",
    started: "Inizio",
    duration: (m, s) => `Durata: ${m} min ${s} s`,
    language: "Lingua",
    channel: "Canale",
    channels: { web: "sito web", phone: "telefono" },
    session: "Sessione",
    reference: "Riferimento",
    lead: "Richiesta",
    booking: "Appuntamento prenotato",
    cancellation: "Appuntamento annullato",
    callback: "Richiamata richiesta",
    transfer: "Trasferimento",
    emergency: "Avviso di emergenza dato",
    connected: "collegato",
    notConnected: "non risposto",
    topic: "Argomento",
    preferredTime: "Orario preferito",
    contactKeys: { name: "Nome", phone: "Telefono", email: "E-mail", company: "Azienda" },
    bookingContact: "Contatto",
    partySize: "Persone",
    notes: "Note",
    service: "Servizio",
    noOutcome: "La conversazione si è conclusa senza richiesta, appuntamento o richiamata.",
    more: (count) => `e altri ${count}`,
    footer: "I dati provengono da una conversazione automatica e possono contenere errori. Controllarli prima di confermare.",
    languages: { de: "tedesco", it: "italiano", en: "inglese", fr: "francese" },
    date: (d, m, y) => `${d}/${m}/${y}`,
  },
  en: {
    assistant: "Voice assistant",
    intro: "The AI voice assistant handled this conversation.",
    requestIntro: "The AI voice assistant took this request during a conversation.",
    late: "Addendum:",
    lateIntro: "Addendum: the AI voice assistant did this at the very end of the conversation, so it comes separately.",
    reschedule: "Appointment moved",
    started: "Started",
    duration: (m, s) => `Duration: ${m} min ${s} s`,
    language: "Language",
    channel: "Channel",
    channels: { web: "website", phone: "phone" },
    session: "Session",
    reference: "Reference",
    lead: "Request",
    booking: "Appointment booked",
    cancellation: "Appointment cancelled",
    callback: "Callback requested",
    transfer: "Transfer",
    emergency: "Emergency message given",
    connected: "connected",
    notConnected: "not answered",
    topic: "Topic",
    preferredTime: "Preferred time",
    contactKeys: { name: "Name", phone: "Phone", email: "Email", company: "Company" },
    bookingContact: "Contact",
    partySize: "People",
    notes: "Notes",
    service: "Service",
    noOutcome: "The conversation ended without a request, an appointment or a callback.",
    more: (count) => `and ${count} more`,
    footer: "These details come from an automated conversation and may contain mistakes. Please check them before you confirm anything.",
    languages: { de: "German", it: "Italian", en: "English", fr: "French" },
    date: (d, m, y) => `${y}-${m}-${d}`,
  },
  fr: {
    assistant: "Assistant vocal",
    intro: "L'assistant vocal IA a mené cette conversation.",
    requestIntro: "L'assistant vocal IA a pris cette demande pendant une conversation.",
    late: "Complément :",
    lateIntro: "Complément : l'assistant vocal IA a fait ceci tout à la fin de la conversation, c'est pourquoi il arrive à part.",
    reschedule: "Rendez-vous déplacé",
    started: "Début",
    duration: (m, s) => `Durée : ${m} min ${s} s`,
    language: "Langue",
    channel: "Canal",
    channels: { web: "site web", phone: "téléphone" },
    session: "Session",
    reference: "Référence",
    lead: "Demande",
    booking: "Rendez-vous réservé",
    cancellation: "Rendez-vous annulé",
    callback: "Rappel demandé",
    transfer: "Transfert",
    emergency: "Message d'urgence donné",
    connected: "connecté",
    notConnected: "sans réponse",
    topic: "Objet",
    preferredTime: "Moment souhaité",
    contactKeys: { name: "Nom", phone: "Téléphone", email: "E-mail", company: "Entreprise" },
    bookingContact: "Contact",
    partySize: "Personnes",
    notes: "Remarques",
    service: "Prestation",
    noOutcome: "La conversation s'est terminée sans demande, rendez-vous ni rappel.",
    more: (count) => `et ${count} autres`,
    footer: "Ces informations proviennent d'une conversation automatique et peuvent contenir des erreurs. Merci de les vérifier avant toute confirmation.",
    languages: { de: "allemand", it: "italien", en: "anglais", fr: "français" },
    date: (d, m, y) => `${d}/${m}/${y}`,
  },
};

/**
 * The summary as a plain-text email in the tenant's default language. The subject is built from
 * our own labels and references only, never from what the caller said.
 */
export function renderSummaryEmail(
  summary: CallSummary,
  tenant: VoiceTenantConfig,
  options: { request?: boolean; late?: boolean } = {},
): { subject: string; text: string } {
  const locale = tenant.defaultLocale;
  const l = LABELS[locale] ?? LABELS.de;
  const zone = tenant.hours?.timezone || "Europe/Zurich";

  const headlines = summary.outcomes.map((outcome) => headline(outcome, tenant, l));
  const first = headlines[0] ?? l.noOutcome.replace(/\.$/, "");
  const subject = `${l.assistant} ${tenant.business.name} – ${options.late ? `${l.late} ` : ""}${
    summary.noOutcome ? l.noOutcome.replace(/\.$/, "") : first
  }${headlines.length > 1 ? ` (${l.more(headlines.length - 1)})` : ""}`;

  // What the caller wants comes first, right under the intro: it is what the business reads the
  // email for, and what a mail program shows in its preview. The facts about the call follow
  // (browser check R3-B2: the example's e-mail card showed only those at first).
  const lines: string[] = [options.late ? l.lateIntro : options.request ? l.requestIntro : l.intro, ""];
  if (summary.noOutcome) {
    lines.push(l.noOutcome, "");
  } else {
    summary.outcomes.forEach((outcome, index) => {
      lines.push(`${index + 1}. ${headlines[index]}`);
      for (const [label, value] of details(outcome, tenant, l, zone)) lines.push(`   ${label}: ${value}`);
      lines.push("");
    });
  }

  const started = Date.parse(summary.startedAt);
  if (Number.isFinite(started)) lines.push(`${l.started}: ${localDateTime(new Date(started), zone, l)} (${zone})`);
  // A request goes out while the call still runs: its length is not known yet. An addendum is
  // about a few outcomes, not the call (the summary had its length).
  if (!options.request && !options.late) lines.push(l.duration(Math.floor(summary.durationSeconds / 60), summary.durationSeconds % 60));
  lines.push(`${l.language}: ${l.languages[summary.locale] ?? summary.locale}`);
  lines.push(`${l.channel}: ${l.channels[summary.channel] ?? summary.channel}`);
  lines.push(`${l.session}: ${summary.sessionId}`);
  lines.push("", l.footer);
  return { subject: oneLine(subject), text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n" };
}

function headline(outcome: Outcome, tenant: VoiceTenantConfig, l: Labels): string {
  const locale = tenant.defaultLocale;
  switch (outcome.kind) {
    case "lead": {
      const task = tenant.tasks.find((candidate) => candidate.id === outcome.taskId);
      const label = task ? pickVoiceText(task.label, locale, locale) || task.id : outcome.taskId;
      return `${l.lead}: ${label}, ${l.reference} ${outcome.ref}`;
    }
    case "booking":
      return `${l.booking}: ${serviceLabel(outcome.booking.serviceId, tenant)}, ${l.reference} ${outcome.booking.ref}`;
    case "reschedule":
      return `${l.reschedule}: ${serviceLabel(outcome.booking.serviceId, tenant)}, ${l.reference} ${outcome.booking.ref}`;
    case "cancellation":
      return `${l.cancellation}, ${l.reference} ${outcome.ref}`;
    case "callback":
      return l.callback;
    case "transfer": {
      const target = tenant.handoff.transfer.targets.find((candidate) => candidate.id === outcome.targetId);
      const label = target ? pickVoiceText(target.label, locale, locale) || target.id : outcome.targetId;
      return `${l.transfer}: ${label}, ${outcome.connected ? l.connected : l.notConnected}`;
    }
    case "emergency_notice":
      return l.emergency;
  }
}

function details(outcome: Outcome, tenant: VoiceTenantConfig, l: Labels, zone: string): Array<[string, string]> {
  const locale = tenant.defaultLocale;
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown): void => {
    const text = typeof value === "string" || typeof value === "number" ? oneLine(String(value)) : "";
    if (text !== "") rows.push([label, text]);
  };
  switch (outcome.kind) {
    case "lead": {
      const task = tenant.tasks.find((candidate) => candidate.id === outcome.taskId);
      for (const [id, value] of Object.entries(outcome.fields)) {
        const field = task?.fields.find((candidate) => candidate.id === id);
        const label = field ? pickVoiceText(field.label, locale, locale) || id : id;
        const choice = field?.type === "choice" ? field.choices?.find((candidate) => candidate.id === value) : undefined;
        add(label, choice ? pickVoiceText(choice.label, locale, locale) || value : readable(value, l));
      }
      for (const [key, value] of Object.entries(outcome.contact)) add(l.contactKeys[key] ?? key, readable(value, l));
      break;
    }
    case "booking":
    case "reschedule": {
      const booking = outcome.booking;
      const start = Date.parse(booking.start);
      if (Number.isFinite(start)) add(l.started, localDateTime(new Date(start), zone, l));
      add(l.contactKeys.name, booking.name);
      add(l.bookingContact, readable(booking.contact, l));
      if (booking.partySize !== undefined) add(l.partySize, booking.partySize);
      add(l.notes, booking.notes);
      break;
    }
    case "callback":
      add(l.contactKeys.name, outcome.name);
      add(l.contactKeys.phone, readable(outcome.phone, l));
      add(l.topic, outcome.topic);
      add(l.preferredTime, outcome.preferredTime);
      break;
    default:
      break;
  }
  return rows;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const E164 = /^\+([1-9]\d{6,14})$/;
/** Country codes of one and two digits (ITU-T E.164); every other one has three. */
const COUNTRY_CODES_1 = new Set(["1", "7"]);
const COUNTRY_CODES_2 = new Set(
  "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(" "),
);

/**
 * A value as the business reads it best (browser check R3-B3): a date the validator stored as
 * YYYY-MM-DD in the email's own date format, like a booking's start; a phone number in E.164 with
 * spaces. Anything else unchanged.
 */
function readable(value: string, l: Labels): string {
  if (typeof value !== "string") return value;
  const date = ISO_DATE.exec(value);
  if (date) return l.date(date[3], date[2], date[1]);
  return E164.test(value) ? spacedPhone(value) : value;
}

/** Swiss service numbers, written 0800 123 456: free (0800), shared cost (084x), premium (090x). */
const SWISS_SERVICE_PREFIX = /^(?:800|84\d|90\d)/;

/**
 * "+41790000060" -> "+41 79 000 00 60", the way Swiss numbers are written: an area or mobile code
 * of two digits (081 for Graubünden included), then 3-2-2. Only the service numbers have a prefix
 * of three digits: "+41 800 123 456". Another country's number gets a space after its country
 * code only: its own grouping is not known here.
 */
export function spacedPhone(e164: string): string {
  const match = E164.exec(e164);
  if (!match) return e164;
  const digits = match[1];
  if (digits.startsWith("41") && digits.length === 11) {
    const national = digits.slice(2);
    return SWISS_SERVICE_PREFIX.test(national)
      ? `+41 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
      : `+41 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7)}`;
  }
  const codeLength = COUNTRY_CODES_1.has(digits.slice(0, 1)) ? 1 : COUNTRY_CODES_2.has(digits.slice(0, 2)) ? 2 : 3;
  return `+${digits.slice(0, codeLength)} ${digits.slice(codeLength)}`;
}

function serviceLabel(serviceId: string, tenant: VoiceTenantConfig): string {
  const service = tenant.calendar?.services.find((candidate) => candidate.id === serviceId);
  return service ? pickVoiceText(service.label, tenant.defaultLocale, tenant.defaultLocale) || service.id : serviceId;
}

function localDateTime(at: Date, zone: string, l: Labels): string {
  try {
    const parts = zonedParts(at, zone);
    const [year, month, day] = parts.date.split("-");
    return `${l.date(day, month, year)} ${formatClockTime(parts.minutes)}`;
  } catch {
    return at.toISOString();
  }
}

/**
 * One line of caller-given text: no line breaks or control characters (they could fake lines),
 * capped. \p{Cc} covers the C0 and C1 controls; \s also matches the Unicode line separators.
 */
function oneLine(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VALUE_CHARS);
}

// ---------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------

/**
 * "send_unknown": the email service did not answer in time, so it may or may not have accepted
 * the message. A request in that state must not be called lost (it may have arrived), nor passed
 * on; sent again with the same idempotency key it is not delivered twice (review finding S2-8).
 */
export type SummaryDelivery =
  | { sent: true }
  | { sent: false; reason: "demo_tenant" | "no_recipient" | "no_outcome" | "email_not_configured" | "send_failed" | "send_unknown" };

export type ResendConfig = { apiKey: string; from: string };

/**
 * Sends one email: true when the service accepted it, false when it did not, "unknown" when no
 * answer came in time. `idempotencyKey`, when given, makes a repeat of the same message within a
 * day a no-op at the service. Never throws.
 */
export type SendEmail = (email: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}) => Promise<boolean | "unknown">;

/** The email service of the site's configuration, or null. */
export function summaryEmailConfig(): ResendConfig | null {
  try {
    return getAssistantEnv().resend;
  } catch {
    return null;
  }
}

/**
 * How the voice emails of live tenants leave right now: through Resend when it is configured,
 * else into the development outbox when VOICE_DEV_OUTBOX allows it (outbox.ts), else not at all.
 */
export function voiceEmailTransport(resend: ResendConfig | null = summaryEmailConfig()): "resend" | "dev_outbox" | "none" {
  if (resend !== null) return "resend";
  return devOutboxSwitchedOn() ? "dev_outbox" : "none";
}

/**
 * Whether what a caller leaves with this tenant reaches someone. A demo business is invented, so
 * its requests stay in the demo; a live one needs a recipient and an email service (or, in
 * development, the outbox). Without them the tools must not tell a caller that a request was
 * passed on.
 */
export function canDeliverSummary(tenant: VoiceTenantConfig, resend: ResendConfig | null = summaryEmailConfig()): boolean {
  if (tenant.kind === "demo") return true;
  return typeof tenant.notifyEmail === "string" && tenant.notifyEmail !== "" && voiceEmailTransport(resend) !== "none";
}

/**
 * Sends one request or callback wish to the business at once (see the header), as a one-outcome
 * summary of the running call. Same conditions as deliverSummary(); `sent` only when the email
 * service accepted it. Never throws.
 */
export async function deliverRequest(args: {
  outcome: Extract<Outcome, { kind: "lead" | "callback" }>;
  tenant: VoiceTenantConfig;
  session: { sessionId: string; channel: CallSummary["channel"]; locale: VoiceLocale; startedAt: number };
  resend?: ResendConfig | null;
  send?: SendEmail;
  /**
   * The tool call's own idempotency key (execute.ts): the same request sent again, after an
   * email service that did not answer in time, reaches the business once.
   */
  idempotencyKey?: string;
}): Promise<SummaryDelivery> {
  const { session } = args;
  const started = Number.isFinite(session.startedAt) ? session.startedAt : Date.now();
  const summary: CallSummary = {
    tenant: args.tenant.id,
    sessionId: session.sessionId,
    channel: session.channel,
    startedAt: new Date(started).toISOString(),
    durationSeconds: 0,
    locale: session.locale,
    outcomes: [args.outcome],
    noOutcome: false,
  };
  return deliverSummary({
    summary,
    tenant: args.tenant,
    resend: args.resend,
    send: args.send,
    request: true,
    ...(args.idempotencyKey ? { idempotencyKey: `mva-request-${args.idempotencyKey}` } : {}),
  });
}

/** Sends the summary when every condition holds (see the header); otherwise says why not. Never throws. */
export async function deliverSummary(args: {
  summary: CallSummary;
  tenant: VoiceTenantConfig;
  resend?: ResendConfig | null;
  send?: SendEmail;
  /** Rendered as a request taken during a running call (deliverRequest). */
  request?: boolean;
  /** Rendered as an addendum to the summary (deliverLateOutcomes). */
  late?: boolean;
  /** Passed to the email service: a repeat with the same key is not delivered twice. */
  idempotencyKey?: string;
}): Promise<SummaryDelivery> {
  const { summary, tenant } = args;
  if (tenant.kind !== "live") return { sent: false, reason: "demo_tenant" };
  if (typeof tenant.notifyEmail !== "string" || tenant.notifyEmail === "") return { sent: false, reason: "no_recipient" };
  if (summary.outcomes.length === 0) return { sent: false, reason: "no_outcome" };
  const resend = args.resend === undefined ? summaryEmailConfig() : args.resend;
  const transport = voiceEmailTransport(resend);
  if (resend === null && transport !== "dev_outbox") return { sent: false, reason: "email_not_configured" };

  try {
    const { subject, text } = renderSummaryEmail(summary, tenant, { request: args.request === true, late: args.late === true });
    const send = resend === null ? sendToDevOutbox : (args.send ?? sendWithResend(resend));
    const ok = await send({
      from: resend === null ? DEV_OUTBOX_FROM : resend.from,
      to: tenant.notifyEmail,
      replyTo: replyAddress(summary),
      subject,
      text,
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    });
    if (ok === "unknown") {
      logVoiceEvent({ warn: "summary_send_unknown", tenant: tenant.id });
      return { sent: false, reason: "send_unknown" };
    }
    if (ok !== true) {
      logVoiceEvent({ warn: "summary_not_sent", tenant: tenant.id });
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (error) {
    logVoiceEvent({ warn: "summary_not_sent", tenant: tenant.id, errorName: error instanceof Error ? error.name : typeof error });
    return { sent: false, reason: "send_failed" };
  }
}

/** The caller's own email address, when they gave one: answering the summary then reaches them. */
function replyAddress(summary: CallSummary): string | undefined {
  for (const outcome of summary.outcomes) {
    const candidate =
      outcome.kind === "lead"
        ? outcome.contact.email
        : outcome.kind === "booking" || outcome.kind === "reschedule"
          ? outcome.booking.contact
          : undefined;
    if (typeof candidate === "string" && isValidEmail(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resend's REST API. With an idempotency key, Resend answers a repeat of the same message within
 * 24 hours with the first answer instead of sending it again. Our own timeout leaves the outcome
 * open ("unknown"): Resend may have accepted the message and only answered late.
 */
export function sendWithResend(resend: ResendConfig): SendEmail {
  return async (email) => {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${resend.apiKey}`, "Content-Type": "application/json" };
      if (email.idempotencyKey) headers["Idempotency-Key"] = email.idempotencyKey;
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
          subject: email.subject,
          text: email.text,
        }),
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      });
      // The reply is never read (nor logged); cancelling it frees the connection.
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) logVoiceEvent({ warn: "summary_email_rejected", status: response.status });
      return response.ok;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : typeof error;
      logVoiceEvent({ warn: "summary_email_failed", errorName });
      // A timeout may have come after Resend accepted the message; any other failure (no
      // connection, a refused request) happened before it could.
      return errorName === "TimeoutError" ? "unknown" : false;
    }
  };
}
