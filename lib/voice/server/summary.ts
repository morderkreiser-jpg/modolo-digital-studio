// The call summary: what a conversation produced, for the business. Server-only.
//
//   buildCallSummary()    the structured result (CallSummary) from the session state
//   renderSummaryEmail()  a plain-text email in the tenant's default language: facts only
//   deliverSummary()      sends it, but ONLY for a live tenant with a recipient, at least one
//                         outcome and an email service configured; otherwise it does nothing and
//                         says why. Demo tenants never send email: their businesses are invented.
//
// The email carries what the caller gave the tools (names, numbers, addresses): it goes to the
// business's own address and nowhere else, and nothing of it is logged. The sending follows the
// chat's lead notifications (lib/assistant/server/leads.ts): Resend's REST API with the key and
// sender of the assistant's configuration (RESEND_API_KEY, CONTACT_FROM). lib/email.ts only
// builds the contact form's auto-reply, so there is no shared sender to reuse.
import { getAssistantEnv } from "@/lib/assistant/server/env";
import { formatClockTime, zonedParts } from "@/lib/voice/hours";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { isValidEmail } from "@/lib/voice/tools/validate";
import type { CallSummary, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import { logVoiceEvent } from "./log";
import type { VoiceSessionState } from "./state";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 8_000;
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

// ---------------------------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------------------------

interface Labels {
  assistant: string;
  intro: string;
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
export function renderSummaryEmail(summary: CallSummary, tenant: VoiceTenantConfig): { subject: string; text: string } {
  const locale = tenant.defaultLocale;
  const l = LABELS[locale] ?? LABELS.de;
  const zone = tenant.hours?.timezone || "Europe/Zurich";

  const headlines = summary.outcomes.map((outcome) => headline(outcome, tenant, l));
  const first = headlines[0] ?? l.noOutcome.replace(/\.$/, "");
  const subject = `${l.assistant} ${tenant.business.name} – ${summary.noOutcome ? l.noOutcome.replace(/\.$/, "") : first}${
    headlines.length > 1 ? ` (${l.more(headlines.length - 1)})` : ""
  }`;

  const lines: string[] = [l.intro, ""];
  const started = Date.parse(summary.startedAt);
  if (Number.isFinite(started)) lines.push(`${l.started}: ${localDateTime(new Date(started), zone, l)} (${zone})`);
  lines.push(l.duration(Math.floor(summary.durationSeconds / 60), summary.durationSeconds % 60));
  lines.push(`${l.language}: ${l.languages[summary.locale] ?? summary.locale}`);
  lines.push(`${l.channel}: ${l.channels[summary.channel] ?? summary.channel}`);
  lines.push(`${l.session}: ${summary.sessionId}`);
  lines.push("");

  if (summary.noOutcome) {
    lines.push(l.noOutcome);
  } else {
    summary.outcomes.forEach((outcome, index) => {
      lines.push(`${index + 1}. ${headlines[index]}`);
      for (const [label, value] of details(outcome, tenant, l, zone)) lines.push(`   ${label}: ${value}`);
      lines.push("");
    });
  }
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
        add(label, choice ? pickVoiceText(choice.label, locale, locale) || value : value);
      }
      for (const [key, value] of Object.entries(outcome.contact)) add(l.contactKeys[key] ?? key, value);
      break;
    }
    case "booking": {
      const booking = outcome.booking;
      const start = Date.parse(booking.start);
      if (Number.isFinite(start)) add(l.started, localDateTime(new Date(start), zone, l));
      add(l.contactKeys.name, booking.name);
      add(l.bookingContact, booking.contact);
      if (booking.partySize !== undefined) add(l.partySize, booking.partySize);
      add(l.notes, booking.notes);
      break;
    }
    case "callback":
      add(l.contactKeys.name, outcome.name);
      add(l.contactKeys.phone, outcome.phone);
      add(l.topic, outcome.topic);
      add(l.preferredTime, outcome.preferredTime);
      break;
    default:
      break;
  }
  return rows;
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

export type SummaryDelivery =
  | { sent: true }
  | { sent: false; reason: "demo_tenant" | "no_recipient" | "no_outcome" | "email_not_configured" | "send_failed" };

export type ResendConfig = { apiKey: string; from: string };

/** Sends one email; true when the service accepted it. Never throws. */
export type SendEmail = (email: { from: string; to: string; replyTo?: string; subject: string; text: string }) => Promise<boolean>;

/** The email service of the site's configuration, or null. */
export function summaryEmailConfig(): ResendConfig | null {
  try {
    return getAssistantEnv().resend;
  } catch {
    return null;
  }
}

/**
 * Whether what a caller leaves with this tenant reaches someone. A demo business is invented, so
 * its requests stay in the demo; a live one needs a recipient and an email service. Without them
 * the tools must not tell a caller that a request was passed on.
 */
export function canDeliverSummary(tenant: VoiceTenantConfig, resend: ResendConfig | null = summaryEmailConfig()): boolean {
  if (tenant.kind === "demo") return true;
  return typeof tenant.notifyEmail === "string" && tenant.notifyEmail !== "" && resend !== null;
}

/** Sends the summary when every condition holds (see the header); otherwise says why not. Never throws. */
export async function deliverSummary(args: {
  summary: CallSummary;
  tenant: VoiceTenantConfig;
  resend?: ResendConfig | null;
  send?: SendEmail;
}): Promise<SummaryDelivery> {
  const { summary, tenant } = args;
  if (tenant.kind !== "live") return { sent: false, reason: "demo_tenant" };
  if (typeof tenant.notifyEmail !== "string" || tenant.notifyEmail === "") return { sent: false, reason: "no_recipient" };
  if (summary.outcomes.length === 0) return { sent: false, reason: "no_outcome" };
  const resend = args.resend === undefined ? summaryEmailConfig() : args.resend;
  if (resend === null) return { sent: false, reason: "email_not_configured" };

  try {
    const { subject, text } = renderSummaryEmail(summary, tenant);
    const send = args.send ?? sendWithResend(resend);
    const ok = await send({ from: resend.from, to: tenant.notifyEmail, replyTo: replyAddress(summary), subject, text });
    if (!ok) {
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
      outcome.kind === "lead" ? outcome.contact.email : outcome.kind === "booking" ? outcome.booking.contact : undefined;
    if (typeof candidate === "string" && isValidEmail(candidate)) return candidate;
  }
  return undefined;
}

function sendWithResend(resend: ResendConfig): SendEmail {
  return async (email) => {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${resend.apiKey}`, "Content-Type": "application/json" },
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
      logVoiceEvent({ warn: "summary_email_failed", errorName: error instanceof Error ? error.name : typeof error });
      return false;
    }
  };
}
