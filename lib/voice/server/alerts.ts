// Spend alerts. Server-only.
//
// When a tenant's month spend, or the month spend of all tenants together, crosses 50, 80 or 100
// percent of its ceiling (SPEND_ALERT_THRESHOLDS in limits.ts), one log line is written and, when
// VOICE_ALERT_EMAIL is set and Resend is configured, one plain email goes to that address. Once per
// scope, month and threshold, also across instances and concurrent requests: the first request to
// take the once-only marker in the accounting store (one atomic increment) is the only one that
// logs and sends.
//
// The 100% line has a second way in. A charge that would pass a ceiling is refused before it is
// counted (a model turn, a session's admission), so the spend may stop just under the line and
// never cross it, while every new live conversation is turned away. Such a refusal reports the
// 100% alert of the scope it found at its ceiling (reportCeilingRefusal), with the same marker: one
// email either way.
//
// The email carries no caller data: the tenant id (or "all tenants"), the threshold, the spend and
// the ceiling in CHF, the month, and how to switch voice off. It is written in Italian, for the
// owner.
//
// An alert never fails a conversation: the marker is one increment, taken only when a line was
// crossed; every error is swallowed and logged as a code. The email is not awaited when the route
// keeps the function alive after its response (deps.keepAlive, Next's after(): every voice route
// that charges spend passes one, keep-alive.ts). Without that, it is awaited, at most ALERT_WAIT_MS:
// the marker is already taken, so an email cut off with the function would be lost for the month
// (review finding alerts-no-keepalive). The development outbox (outbox.ts) never carries alerts:
// they need the real email service.
import type { KVStore } from "@/lib/assistant/server/store";
import { monthSpendChf, spendThresholdsCrossed, type SpendStep } from "./limits";
import { logVoiceEvent } from "./log";
import { EMAIL_TIMEOUT_MS, sendWithResend, summaryEmailConfig, type ResendConfig, type SendEmail } from "./summary";

/** The markers outlive the month they belong to (a month has at most 31 days). */
const MARKER_TTL_SECONDS = 40 * 86_400;
const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

/** Where the alert emails go and how they leave: the routes pass their VoiceDeps fields. */
export interface AlertDelivery {
  /** VOICE_ALERT_EMAIL; null = log lines only. */
  alertEmail: string | null;
  /** undefined = the site's configuration (RESEND_API_KEY). */
  resend?: ResendConfig | null;
  send?: SendEmail;
  /**
   * Keeps the function alive for the email that is not awaited (Next's after(), keep-alive.ts).
   * Absent, or answering false: the email is awaited instead, within ALERT_WAIT_MS.
   */
  keepAlive?: (work: Promise<unknown>) => boolean | void;
}

/**
 * The longest an alert email is waited for when nothing keeps the function alive after its
 * response: the sender's own timeout, plus a little for the response to be read.
 */
export const ALERT_WAIT_MS = EMAIL_TIMEOUT_MS + 500;

/** One threshold crossed by one scope in one month: what the email says. */
export interface SpendAlert {
  /** A tenant id, or null for all tenants together. */
  tenantId: string | null;
  month: string;
  percent: number;
  spentChf: number;
  budgetChf: number;
}

/**
 * Reports the thresholds a charge crossed: the tenant's (`spend` against `budgetChf`) and, when
 * given, everybody's (`globalSpend` against `globalBudgetChf`). Never throws.
 */
export async function reportSpend(args: {
  /** The accounting store (stores.ts): the markers are few, kept with the counters. */
  store: KVStore;
  tenantId: string;
  month: string;
  spend: SpendStep;
  budgetChf: number;
  globalSpend?: SpendStep;
  globalBudgetChf?: number;
  delivery: AlertDelivery;
}): Promise<void> {
  const scopes: Array<{ tenantId: string | null; step: SpendStep; budgetChf: number }> = [
    { tenantId: args.tenantId, step: args.spend, budgetChf: args.budgetChf },
  ];
  if (args.globalSpend && args.globalBudgetChf !== undefined) {
    scopes.push({ tenantId: null, step: args.globalSpend, budgetChf: args.globalBudgetChf });
  }
  for (const scope of scopes) {
    for (const percent of spendThresholdsCrossed(scope.step.beforeChf, scope.step.afterChf, scope.budgetChf)) {
      await raiseAlert(
        args.store,
        { tenantId: scope.tenantId, month: args.month, percent, spentChf: scope.step.afterChf, budgetChf: scope.budgetChf },
        args.delivery,
      );
    }
  }
}

/**
 * After a charge was refused for spend (a turn's worst case, a session's first turn or whole
 * call: `roomChf`), the 100% alert of each scope whose month spend plus that room passes its
 * ceiling. Two reads, on the refusal path only. Never throws.
 */
export async function reportCeilingRefusal(args: {
  store: KVStore;
  tenantId: string;
  roomChf: number;
  budgetChf: number;
  globalBudgetChf: number;
  now: number;
  delivery: AlertDelivery;
}): Promise<void> {
  try {
    const spend = await monthSpendChf(args.store, args.tenantId, args.now);
    const room = Number.isFinite(args.roomChf) && args.roomChf > 0 ? args.roomChf : 0;
    const scopes: Array<{ tenantId: string | null; spentChf: number; budgetChf: number }> = [
      { tenantId: args.tenantId, spentChf: spend.tenantChf, budgetChf: args.budgetChf },
      { tenantId: null, spentChf: spend.globalChf, budgetChf: args.globalBudgetChf },
    ];
    for (const scope of scopes) {
      // A ceiling of 0 switches live conversations off on purpose, and one smaller than a single
      // turn refuses with nothing spent: neither is a month that ran out.
      if (!(scope.budgetChf > 0) || !(scope.spentChf > 0) || scope.spentChf + room <= scope.budgetChf) continue;
      await raiseAlert(args.store, { ...scope, month: spend.month, percent: 100 }, args.delivery);
    }
  } catch (error) {
    logVoiceEvent({ warn: "voice_alert_not_sent", reason: "internal", errorName: error instanceof Error ? error.name : typeof error });
  }
}

/** The alert email in Italian: plain words, no caller data. */
export function renderSpendAlert(alert: SpendAlert): { subject: string; text: string } {
  const who = alert.tenantId === null ? "tutti i tenant insieme" : `tenant ${alert.tenantId}`;
  const month = italianMonth(alert.month);
  const reached = alert.percent >= 100;
  const subject = reached
    ? `Assistente vocale: tetto di spesa del mese raggiunto (${who}, ${month})`
    : `Assistente vocale: spesa ${atPercent(alert.percent)} del tetto del mese (${who}, ${month})`;
  const lines = [
    reached
      ? "La spesa stimata dell'assistente vocale è arrivata al tetto del mese."
      : `La spesa stimata dell'assistente vocale ha raggiunto ${thePercent(alert.percent)} del tetto del mese.`,
    "",
    `Per: ${who}`,
    `Mese: ${month} (UTC)`,
    `Spesa stimata finora: ${chf(alert.spentChf)}`,
    `Tetto del mese: ${chf(alert.budgetChf)}`,
    "",
    reached
      ? "Fino all'inizio del mese prossimo l'assistente non accetta più conversazioni dal vivo."
      : "Al 100% l'assistente non accetta più conversazioni dal vivo fino all'inizio del mese prossimo.",
    "Per spegnere la voce subito: su Vercel imposta VOICE_ENABLED=false e rifai il deploy.",
    "",
    "Questo avviso arriva una volta sola per questa soglia e questo mese.",
  ];
  return { subject, text: `${lines.join("\n")}\n` };
}

/** Takes the alert's once-only marker; the first to take it logs and sends. Never throws. */
async function raiseAlert(store: KVStore, alert: SpendAlert, delivery: AlertDelivery): Promise<void> {
  try {
    if ((await store.incrBy(markerKey(alert), 1, MARKER_TTL_SECONDS)) !== 1) return;
  } catch {
    // Without the marker it cannot be sent once only: better none than one per request.
    return;
  }
  logVoiceEvent({
    warn: "voice_spend_threshold",
    kind: alert.tenantId === null ? "global" : "tenant",
    tenant: alert.tenantId,
    percent: alert.percent,
  });
  // The marker is taken: this is the only chance this month. Without a keepAlive that takes the
  // email, a function ended with its response could cut it off, so it is waited for here (review
  // finding alerts-no-keepalive).
  const unkept = sendSpendAlert(alert, delivery);
  if (unkept !== null) await within(unkept, ALERT_WAIT_MS);
}

/**
 * Starts one alert email (see the header). Answers the sending when nothing keeps the function
 * alive for it (the caller then waits), else null. Never throws.
 */
function sendSpendAlert(alert: SpendAlert, delivery: AlertDelivery): Promise<void> | null {
  try {
    if (delivery.alertEmail === null || delivery.alertEmail === "") return null;
    const resend = delivery.resend === undefined ? summaryEmailConfig() : delivery.resend;
    if (resend === null) {
      logVoiceEvent({ warn: "voice_alert_not_sent", reason: "email_not_configured" });
      return null;
    }
    const { subject, text } = renderSpendAlert(alert);
    const send = delivery.send ?? sendWithResend(resend);
    const email = {
      from: resend.from,
      to: delivery.alertEmail,
      subject,
      text,
      idempotencyKey: `mva-alert-${alert.tenantId ?? "all"}-${alert.month}-${alert.percent}`,
    };
    const work = Promise.resolve()
      .then(() => send(email))
      .then((ok) => {
        if (ok !== true) logVoiceEvent({ warn: "voice_alert_not_sent", reason: ok === "unknown" ? "send_unknown" : "send_failed" });
      })
      .catch((error: unknown) => {
        logVoiceEvent({ warn: "voice_alert_not_sent", reason: "send_failed", errorName: error instanceof Error ? error.name : typeof error });
      });
    const kept = delivery.keepAlive !== undefined && delivery.keepAlive(work) !== false;
    return kept ? null : work;
  } catch (error) {
    logVoiceEvent({ warn: "voice_alert_not_sent", reason: "internal", errorName: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

/** Waits for `work`, at most `ms`: a sender that never answers must not hold the request. */
async function within(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The once-only marker of one alert: per scope, month and threshold. */
export function markerKey(alert: Pick<SpendAlert, "tenantId" | "month" | "percent">): string {
  return `mva:alert:${alert.tenantId === null ? "*all*" : alert.tenantId}:${alert.month}:${alert.percent}`;
}

/** The article elides before a vowel sound (otto, undici): "il 50%" but "l'80%". */
function elides(percent: number): boolean {
  return /^(8|11)/.test(String(percent));
}

/** "al 50%", "all'80%". */
function atPercent(percent: number): string {
  return elides(percent) ? `all'${percent}%` : `al ${percent}%`;
}

/** "il 50%", "l'80%". */
function thePercent(percent: number): string {
  return elides(percent) ? `l'${percent}%` : `il ${percent}%`;
}

/** "2026-11" -> "novembre 2026". */
function italianMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const name = match ? MONTHS_IT[Number(match[2]) - 1] : undefined;
  return match && name ? `${name} ${match[1]}` : month;
}

/** "CHF 1'234.50", the Swiss way. */
function chf(value: number): string {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  const [whole, cents] = amount.toFixed(2).split(".");
  return `CHF ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${cents}`;
}
