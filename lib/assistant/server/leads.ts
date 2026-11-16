// Quote requests ("leads") from the assistant's form: the notification email to the business and
// the delivery channels. Server-only: it posts to Resend with the API key.
//
// Lead data never goes through the model. The model can only suggest the form; the visitor fills
// it in and the browser posts it to /api/assistant/lead, which validates it (lead-schema.ts) and
// calls deliverLead().
//
// PRIVACY: nothing here keeps a lead in process memory. The only copies are the email to the
// business and, when Upstash is configured AND ASSISTANT_LEAD_COPY=true, a JSON copy that Redis
// deletes by itself (TTL).
// Failures are logged with a status code or an error name only, never the payload, the visitor's
// details or Resend's reply.
import type { AssistantLocale, LeadInput, LeadOption, TenantConfig } from "@/lib/assistant/types";
import type { AssistantEnv } from "@/lib/assistant/server/env";
import type { KVStore } from "@/lib/assistant/server/store";
import { isValidEmail } from "@/lib/assistant/lead-schema";
import { LOCALE_NAMES, interpolate, pickText } from "@/lib/assistant/localize";

export interface LeadRecord extends LeadInput {
  id: string;
  tenant: string;
  locale: AssistantLocale;
  region: string;
  page?: string;
  createdAt: string;
}

type LeadChannel = "email" | "store";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Resend answers in well under a second; past 10 s the visitor is better served by an error that
// shows the direct contact links than by a spinner.
const EMAIL_TIMEOUT_MS = 10_000;
const DAY_SECONDS = 86_400;
const SUBJECT_MAX = 120;
const EMPTY = "—";
// The business's local time. TenantConfig has no time-zone field yet; the only tenant works in CET.
const TIME_ZONE = "Europe/Zurich";

// Email-safe font stack: webfonts are not loaded by mail clients.
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
// The site's light palette (app/globals.css: --paper, --espresso, --gilt, --color-gold). The
// hairline is --line flattened onto the paper as solid hex, because Outlook ignores rgba().
const PAPER = "#fbf8f2";
const INK = "#17130e";
const MUTED = "#6b6257";
const LINE = "#e1ddd8";
const GOLD = "#b5893f";
const GILT = "#7e5d24";

interface EmailCopy {
  lang: AssistantLocale;
  /** BCP 47 tag for the "received" date. */
  dateLocale: string;
  subject: string;
  kicker: string;
  intro: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  service: string;
  budget: string;
  consent: string;
  consentGiven: string;
  consentMissing: string;
  description: string;
  page: string;
  language: string;
  region: string;
  id: string;
  received: string;
  /** {name} */
  reply: string;
  /** {days} */
  retention: string;
}

// Labels follow the tenant's default locale, so the business reads every lead in one language
// whatever language the visitor used. A locale added to ASSISTANT_LOCALES without copy here
// falls back to English instead of failing.
const COPY: { en: EmailCopy } & Partial<Record<AssistantLocale, EmailCopy>> = {
  en: {
    lang: "en",
    dateLocale: "en-GB",
    subject: "New quote request (AI assistant)",
    kicker: "AI assistant · Quote request",
    intro: "Sent from the quote form of the AI assistant on the website. The visitor entered and confirmed these details.",
    name: "Name",
    company: "Company",
    email: "Email",
    phone: "Phone / WhatsApp",
    service: "Service",
    budget: "Budget",
    consent: "Privacy notice acknowledged",
    consentGiven: "Yes",
    consentMissing: "No",
    description: "Request",
    page: "Page",
    language: "Language",
    region: "Region",
    id: "Request ID",
    received: "Received",
    reply: "Reply to this email to answer {name} directly.",
    retention:
      "Retention: keep this request only as long as needed to handle it and follow up, at most {days} days unless a contract follows.",
  },
  de: {
    lang: "de",
    dateLocale: "de-CH",
    subject: "Neue Offertanfrage (KI-Assistent)",
    kicker: "KI-Assistent · Offertanfrage",
    intro: "Gesendet über das Offertformular des KI-Assistenten auf der Website. Die Person hat die Angaben selbst eingegeben und bestätigt.",
    name: "Name",
    company: "Firma",
    email: "E-Mail",
    phone: "Telefon / WhatsApp",
    service: "Leistung",
    budget: "Budget",
    consent: "Datenschutzerklärung zur Kenntnis genommen",
    consentGiven: "Ja",
    consentMissing: "Nein",
    description: "Anfrage",
    page: "Seite",
    language: "Sprache",
    region: "Region",
    id: "Anfrage-ID",
    received: "Eingegangen",
    reply: "Eine Antwort auf diese E-Mail geht direkt an {name}.",
    retention:
      "Aufbewahrung: Diese Anfrage nur so lange aufbewahren, wie es für Bearbeitung und Nachfassen nötig ist, höchstens {days} Tage, sofern kein Vertrag zustande kommt.",
  },
  it: {
    lang: "it",
    dateLocale: "it-CH",
    subject: "Nuova richiesta di preventivo (assistente AI)",
    kicker: "Assistente AI · Richiesta di preventivo",
    intro: "Inviata dal modulo di preventivo dell'assistente AI del sito. I dati sono stati inseriti e confermati dal visitatore.",
    name: "Nome",
    company: "Azienda",
    email: "Email",
    phone: "Telefono / WhatsApp",
    service: "Servizio",
    budget: "Budget",
    consent: "Informativa privacy letta",
    consentGiven: "Sì",
    consentMissing: "No",
    description: "Richiesta",
    page: "Pagina",
    language: "Lingua",
    region: "Regione",
    id: "ID richiesta",
    received: "Ricevuta",
    reply: "Rispondendo a questa email scrivi direttamente a {name}.",
    retention:
      "Conservazione: tieni questa richiesta solo per il tempo necessario a gestirla e a ricontattare la persona, al massimo {days} giorni, salvo che ne nasca un contratto.",
  },
};

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

// Control characters, line/paragraph separators and bidi overrides. The route has already cleaned
// the fields; this keeps the email safe for any caller: a single-line value stays one line in the
// subject and in the field rows, so it cannot fake extra rows or headers.
const BREAKERS_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g;

function oneLine(value: string | undefined): string {
  return (value ?? "").replace(BREAKERS_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/** Keeps the visitor's line breaks and drops every other control character. */
function multiLine(value: string): string {
  return value
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
}

function capSubject(subject: string): string {
  if (subject.length <= SUBJECT_MAX) return subject;
  let cut = subject.slice(0, SUBJECT_MAX - 1);
  // Never end on half of a surrogate pair (an emoji cut in two renders as a broken glyph).
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The visitor's address when it is safe to use as Reply-To, else null. */
function replyAddress(record: LeadRecord): string | null {
  const email = oneLine(record.email);
  return isValidEmail(email) ? email : null;
}

function optionLabel(options: LeadOption[] | undefined, id: string | undefined, locale: AssistantLocale): string {
  const value = oneLine(id);
  if (!value) return "";
  const option = options?.find((candidate) => candidate.id === value);
  return (option && oneLine(pickText(option.label, locale))) || value;
}

function formatReceived(createdAt: string, dateLocale: string): string {
  const date = new Date(createdAt);
  // Intl throws on an invalid date: show the raw value instead of losing the whole email.
  if (Number.isNaN(date.getTime())) return oneLine(createdAt) || EMPTY;
  const local = new Intl.DateTimeFormat(dateLocale, {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  return `${local} (${TIME_ZONE}) · ${date.toISOString()}`;
}

type Row = [label: string, value: string];

function fieldTable(rows: Row[], valueSize: string): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td valign="top" style="width:34%;padding:8px 12px 8px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${MUTED};">${escapeHtml(label)}</td>` +
        `<td valign="top" style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:${valueSize};color:${INK};word-break:break-word;">${escapeHtml(value)}</td></tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};line-height:1.5;">\n${body}\n</table>`;
}

function composeEmail(
  record: LeadRecord,
  tenant: TenantConfig,
  retentionDays: number,
): { subject: string; text: string; html: string } {
  const copy = COPY[tenant.defaultLocale] ?? COPY.en;

  const name = oneLine(record.name);
  const company = oneLine(record.company);
  const email = oneLine(record.email);
  // The visitor's region list first; the route also accepts ids from the other regions' lists (the
  // form follows the region cookie, the server may only know the geo header), so search those too.
  const budgets = [
    ...(tenant.leads.budgetOptions[record.region] ?? tenant.leads.budgetOptions.default ?? []),
    ...Object.values(tenant.leads.budgetOptions).flat(),
  ];
  const regionName = oneLine(pickText(tenant.regions.labels[record.region], copy.lang));
  const regionId = oneLine(record.region);
  // Guards a record whose locale did not come through the route's validation.
  const localeName = LOCALE_NAMES[record.locale]?.native;

  const who = company ? `${name} (${company})` : name;
  const subject = capSubject(who ? `${copy.subject} — ${who}` : copy.subject);

  const contactRows: Row[] = [
    [copy.name, name || EMPTY],
    [copy.company, company || EMPTY],
    [copy.email, email || EMPTY],
    [copy.phone, oneLine(record.phone) || EMPTY],
    [copy.service, optionLabel(tenant.leads.services, record.service, copy.lang) || EMPTY],
    [copy.budget, optionLabel(budgets, record.budget, copy.lang) || EMPTY],
    [copy.consent, record.consent ? copy.consentGiven : copy.consentMissing],
  ];
  const contextRows: Row[] = [
    [copy.page, oneLine(record.page) || EMPTY],
    [copy.language, localeName ? `${localeName} (${record.locale})` : oneLine(record.locale) || EMPTY],
    [copy.region, regionName ? `${regionName} (${regionId})` : regionId || EMPTY],
    [copy.id, oneLine(record.id) || EMPTY],
    [copy.received, formatReceived(record.createdAt, copy.dateLocale)],
  ];
  const description = multiLine(record.description) || EMPTY;
  const reply = replyAddress(record) ? interpolate(copy.reply, { name: name || email }) : "";
  const retention = interpolate(copy.retention, { days: retentionDays });

  const line = ([label, value]: Row) => `${label}: ${value}`;
  const text = [
    copy.subject,
    copy.intro,
    "",
    ...contactRows.map(line),
    "",
    `${copy.description}:`,
    description,
    "",
    ...contextRows.map(line),
    "",
    ...(reply ? [reply] : []),
    retention,
  ].join("\n");

  const heading =
    escapeHtml(name || EMPTY) +
    (company ? ` <span style="font-weight:400;color:${MUTED};">· ${escapeHtml(company)}</span>` : "");
  const label = (value: string) =>
    `<p style="margin:0 0 8px;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:${GILT};">${escapeHtml(value)}</p>`;

  // Tables + inline styles only (what every mail client renders), no images, no remote resources,
  // no tracking: the business reads it as a plain record of the request.
  const html = `<!DOCTYPE html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};color:${INK};-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${LINE};border-top:2px solid ${GOLD};border-radius:12px;">
<tr><td style="padding:24px 28px 0;font-family:${FONT};">
${label(copy.kicker)}
<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;color:${INK};word-break:break-word;">${heading}</h1>
<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:${MUTED};">${escapeHtml(copy.intro)}</p>
</td></tr>
<tr><td style="padding:16px 28px 0;">
${fieldTable(contactRows, "15px")}
</td></tr>
<tr><td style="padding:20px 28px 0;font-family:${FONT};">
${label(copy.description)}
<div style="padding:14px 16px;background-color:${PAPER};border:1px solid ${LINE};border-radius:8px;font-size:15px;line-height:1.6;color:${INK};word-break:break-word;">${escapeHtml(description).replace(/\n/g, "<br>\n")}</div>
</td></tr>
<tr><td style="padding:20px 28px 0;">
${fieldTable(contextRows, "13px")}
</td></tr>
<tr><td style="padding:20px 28px 24px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
${reply ? `${escapeHtml(reply)}<br>\n` : ""}${escapeHtml(retention)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * The email that tells the business about a new quote request: labels in the tenant's default
 * locale, every visitor-supplied value HTML-escaped in the HTML part, service and budget shown by
 * their labels, plus page, language, region, id, timestamp and the retention rule.
 */
export function leadNotificationEmail(
  record: LeadRecord,
  tenant: TenantConfig,
): { subject: string; text: string; html: string } {
  return composeEmail(record, tenant, tenant.leads.retentionDays);
}

// Error level (a lost lead must be able to raise an alert), same JSON shape as usage.ts logEvent.
function logFailure(tenant: string, channel: LeadChannel, detail: { status?: number; error?: string }): void {
  console.error(
    JSON.stringify({ evt: "assistant", ts: new Date().toISOString(), route: "lead", tenant, channel, ...detail }),
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function sendEmail(
  record: LeadRecord,
  tenant: TenantConfig,
  resend: { apiKey: string; from: string },
  to: string,
  retentionDays: number,
): Promise<boolean> {
  try {
    const { subject, text, html } = composeEmail(record, tenant, retentionDays);
    const replyTo = replyAddress(record);
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${resend.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: resend.from,
        to: [to],
        // Only a valid address may become Reply-To. The route has validated it already; the check
        // keeps a malformed one from making Resend reject (and so lose) the whole notification.
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    // Resend's reply is never read (nor logged); cancelling it frees the connection.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) logFailure(tenant.id, "email", { status: response.status });
    return response.ok;
  } catch (error) {
    // Timeout ("TimeoutError"), DNS/network failure ("TypeError") or a bug: the name is enough.
    logFailure(tenant.id, "email", { error: errorName(error) });
    return false;
  }
}

async function storeCopy(
  record: LeadRecord,
  tenant: TenantConfig,
  store: KVStore,
  retentionDays: number,
): Promise<boolean> {
  // Without a valid expiry the copy would never be deleted: refuse rather than guess one.
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    logFailure(tenant.id, "store", { error: "invalid_retention" });
    return false;
  }
  try {
    const stored = await store.set(
      `mda:lead:${tenant.id}:${record.id}`,
      JSON.stringify(record),
      Math.floor(retentionDays) * DAY_SECONDS,
    );
    if (!stored) logFailure(tenant.id, "store", { error: "set_failed" });
    return stored;
  } catch (error) {
    // The store is specified never to throw; if one does, the email may still have gone out.
    logFailure(tenant.id, "store", { error: errorName(error) });
    return false;
  }
}

/**
 * Deliver a validated lead through every configured channel. Never throws.
 * - email: Resend REST, to `env.leadTo ?? tenant.leads.notifyEmail`, Reply-To the visitor, when
 *   RESEND_API_KEY is set. No auto-reply to the visitor: it would turn the endpoint into a relay
 *   that mails any address typed into the form.
 * - store: JSON copy under `mda:lead:<tenant>:<id>` with a TTL of the retention period, ONLY on the
 *   Upstash store and ONLY with ASSISTANT_LEAD_COPY=true (privacy by default: Upstash may be
 *   connected for the counters alone). The in-memory store is not persistence, and personal data
 *   must not sit in process memory.
 * A channel that is not configured is in neither list.
 */
export async function deliverLead(args: {
  record: LeadRecord;
  tenant: TenantConfig;
  env: AssistantEnv;
  store: KVStore;
}): Promise<{ delivered: Array<"email" | "store">; failed: Array<"email" | "store"> }> {
  const { record, tenant, env, store } = args;
  const retentionDays = env.leadRetentionDays ?? tenant.leads.retentionDays;

  // In parallel: the visitor waits for the slower channel, not for the sum of both.
  const [emailSent, copyStored] = await Promise.all([
    env.resend ? sendEmail(record, tenant, env.resend, env.leadTo ?? tenant.leads.notifyEmail, retentionDays) : null,
    store.kind === "upstash" && env.leadCopy ? storeCopy(record, tenant, store, retentionDays) : null,
  ]);

  const delivered: LeadChannel[] = [];
  const failed: LeadChannel[] = [];
  if (emailSent !== null) (emailSent ? delivered : failed).push("email");
  if (copyStored !== null) (copyStored ? delivered : failed).push("store");
  return { delivered, failed };
}
