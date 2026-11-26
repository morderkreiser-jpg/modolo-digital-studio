// The development outbox of the voice emails (VOICE_DEV_OUTBOX). Server-only.
//
// On a laptop without RESEND_API_KEY, a request taken by a live tenant's assistant could never be
// passed on, so the caller always heard that it did not work (the tools say "passed on" only when
// an email service accepted the message). With VOICE_DEV_OUTBOX=true, outside production, and
// only while no email service is configured, the requests, callback wishes and end-of-call
// summaries of live tenants come here instead: kept in memory (the last MAX_KEPT), printed in
// full on the server console under DEV_OUTBOX_PREFIX, and counted as delivered. Nothing leaves the
// machine. Spend alerts never come here: they need the real email service (alerts.ts).
//
// The console lines carry what the caller said (names, numbers, addresses): that is their purpose
// on a developer's machine, and why the switch is ignored in production (env.ts). They bypass the
// structured log guard (log.ts) on purpose and must never be routed into it.
import type { SendEmail } from "./summary";
import { getVoiceEnv } from "./env";

/** The start of every console line the outbox prints. */
export const DEV_OUTBOX_PREFIX = "[voice dev outbox]";
/** The sender shown on outbox messages: there is no real one without an email service. */
export const DEV_OUTBOX_FROM = "Modolo Voice AI (dev outbox) <dev-outbox@localhost>";
/** Messages kept for devOutboxMessages(); the oldest go first. */
const MAX_KEPT = 50;

export interface DevOutboxMessage {
  /** Unix ms when the outbox took it. */
  at: number;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}

// On globalThis like the other development state (env.ts): dev HMR re-evaluates modules.
const OUTBOX = Symbol.for("mva.voice.dev-outbox");
type OutboxHolder = { [OUTBOX]?: { messages: DevOutboxMessage[]; count: number } };

function outbox(): { messages: DevOutboxMessage[]; count: number } {
  const holder = globalThis as typeof globalThis & OutboxHolder;
  return (holder[OUTBOX] ??= { messages: [], count: 0 });
}

/**
 * True when VOICE_DEV_OUTBOX is on and this is not production. NODE_ENV is read again here, not
 * only when the configuration was cached: the outbox must never answer "delivered" in production.
 */
export function devOutboxSwitchedOn(): boolean {
  return getVoiceEnv().devOutbox && process.env.NODE_ENV !== "production";
}

/**
 * A SendEmail that keeps the message and prints it: always "accepted". A repeat with the same
 * idempotency key is accepted without a second copy, as Resend does.
 */
export const sendToDevOutbox: SendEmail = async (email) => {
  const box = outbox();
  if (email.idempotencyKey && box.messages.some((message) => message.idempotencyKey === email.idempotencyKey)) return true;
  const message: DevOutboxMessage = {
    at: Date.now(),
    from: email.from,
    to: email.to,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    subject: email.subject,
    text: email.text,
    ...(email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : {}),
  };
  box.messages.push(message);
  if (box.messages.length > MAX_KEPT) box.messages.splice(0, box.messages.length - MAX_KEPT);
  box.count += 1;
  try {
    console.log(formatForConsole(message, box.count));
  } catch {
    // Printing is best effort; the message is kept either way.
  }
  return true;
};

/** What the outbox holds, oldest first (copies). */
export function devOutboxMessages(): DevOutboxMessage[] {
  return outbox().messages.map((message) => ({ ...message }));
}

/** Empties the outbox. Tests only. */
export function clearDevOutboxForTests(): void {
  const box = outbox();
  box.messages = [];
  box.count = 0;
}

/** One block, every line prefixed, so it stands out among the JSON log lines. */
function formatForConsole(message: DevOutboxMessage, number: number): string {
  const lines = [
    `email ${number}, kept here and NOT sent`,
    `From: ${message.from}`,
    `To: ${message.to}`,
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    `Subject: ${message.subject}`,
    "",
    ...message.text.replace(/\n+$/, "").split("\n"),
    `end of email ${number}`,
  ];
  return lines.map((line) => `${DEV_OUTBOX_PREFIX} ${line}`.trimEnd()).join("\n");
}
