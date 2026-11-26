// The e-mails a written example would leave in the business's inbox (review finding N2), built with
// the formatter of the real e-mails (summary.ts: renderSummaryEmail) so the demo shows the format
// the business really gets. Called by mount-config.ts for every example a stage plays.
//
// Only what the script itself did counts: its tool steps, read like the tool executor reads them
// (lib/voice/tools/execute.ts), after the real input validator:
//   create_lead, request_callback (ok)  → a request e-mail each, sent the moment the tool takes it
//                                         (summary.ts deliverRequest)
//   book / reschedule / cancel (ok),    → one end-of-call summary with all of them, sent when the
//   transfer_call (ok or not answered)    call ends (session.ts finishSession, endOfCallSummary)
//   check_availability, end_call,       → nothing
//   a step that failed
//
// Three header lines of the real e-mails would need values the script does not have: when the call
// started, how long it lasted and the session id. Each e-mail is rendered twice with different
// values for those three, and only the lines both renderings share are kept, so nothing invented
// reaches the page and the rest stays exactly what the formatter writes.
//
// A reference is what the system hands out: a booking takes the one the assistant reads out in
// the script (as the demos tests require); a request, whose reference the scripts never say, gets
// one derived from the script and the line, in the format of session.ts (LD- and four characters).
//
// Plain module: no "server-only" import (the node:test runner cannot load it), but server-side
// data in, so it is only imported by mount-config.ts.
import { scriptCaptionId, type AfterCallMail, type AfterCallStep, type DemoAfterCall } from "@/lib/voice/after-call";
import { parseIsoInstant, toZonedIso } from "@/lib/voice/hours";
import { validateToolInput } from "@/lib/voice/tools/validate";
import type { Booking, CallSummary, DemoScript, DemoScriptLine, VoiceTenantConfig } from "@/lib/voice/types";
import { renderSummaryEmail } from "./summary";

type Outcome = CallSummary["outcomes"][number];
type Step = NonNullable<DemoScriptLine["tool"]>;

/**
 * The day the examples are set in (early December 2026, like the demos tests): the validator
 * refuses a date in the past, and an example must keep its e-mails after that day has gone by.
 */
const EXAMPLE_DAY = new Date("2026-12-01T07:00:00+01:00");

/** The alphabet of references (session.ts, calendar/memory.ts): no 0/O, no 1/I. */
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BOOKING_REF = /\bMV-[2-9A-HJ-NP-Z]{4}\b/;

/** Two renderings that differ only in what the script cannot know (see the header). */
const VARIANTS = [
  { startedAt: Date.UTC(2026, 0, 5, 7, 13), durationSeconds: 61, sessionId: "example-a" },
  { startedAt: Date.UTC(2027, 7, 21, 16, 47), durationSeconds: 3723, sessionId: "example-b" },
] as const;

/** A 32-bit FNV-1a hash: a stable reference for the same script line on every build. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function derivedRef(prefix: string, seed: string): string {
  const hash = fnv1a(seed);
  let code = "";
  for (let index = 0; index < 4; index += 1) code += REF_ALPHABET[(hash >>> (index * 5)) & 31];
  return `${prefix}-${code}`;
}

/** The booking reference the assistant reads out, on the step's line or a later one of the assistant. */
function spokenBookingRef(script: DemoScript, lineIndex: number): string | null {
  for (const line of script.lines.slice(lineIndex)) {
    if (line.role !== "assistant") continue;
    const match = BOOKING_REF.exec(line.text);
    if (match) return match[0];
  }
  return null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** End of an appointment that starts at `start` (ISO with offset): the service's length later. */
function endOf(tenant: VoiceTenantConfig, serviceId: string, start: string): string {
  const startMs = parseIsoInstant(start);
  const minutes = tenant.calendar?.services.find((service) => service.id === serviceId)?.durationMinutes ?? 0;
  if (startMs === null) return start;
  try {
    return toZonedIso(new Date(startMs + minutes * 60_000), tenant.hours.timezone);
  } catch {
    return start;
  }
}

interface Memory {
  /** The bookings this example made or moved, by reference. */
  bookings: Map<string, Booking>;
  /** The service the caller asked about last (check_availability): what a moved appointment is. */
  service: string | null;
}

/** What one tool step leaves in the call's summary, or null (see the header). */
function outcomeOf(
  script: DemoScript,
  lineIndex: number,
  step: Step,
  tenant: VoiceTenantConfig,
  memory: Memory,
): Outcome | null {
  const checked = validateToolInput(tenant, step.name, step.input, { now: EXAMPLE_DAY });
  if (!checked.ok) return null;
  const input = checked.value;
  const ok = step.outcome === "ok";
  switch (step.name) {
    case "check_availability":
      memory.service = text(input.service) ?? memory.service;
      return null;
    case "create_lead": {
      if (!ok) return null;
      const contact: Record<string, string> = {};
      for (const key of ["name", "phone", "email", "company"]) {
        const value = text(input[key]);
        if (value !== undefined) contact[key] = value;
      }
      return {
        kind: "lead",
        taskId: String(input.task),
        ref: derivedRef("LD", scriptCaptionId(script.id, lineIndex)),
        fields: { ...(input.fields as Record<string, string>) },
        contact,
      };
    }
    case "request_callback": {
      if (!ok) return null;
      const preferredTime = text(input.preferred_time);
      return {
        kind: "callback",
        name: String(input.name),
        phone: String(input.phone),
        topic: String(input.topic),
        ...(preferredTime === undefined ? {} : { preferredTime }),
      };
    }
    case "book_appointment": {
      if (!ok) return null;
      const serviceId = String(input.service);
      const start = String(input.start);
      const notes = text(input.notes);
      const booking: Booking = {
        ref: spokenBookingRef(script, lineIndex) ?? derivedRef("MV", scriptCaptionId(script.id, lineIndex)),
        serviceId,
        start,
        end: endOf(tenant, serviceId, start),
        name: String(input.name),
        contact: String(input.contact),
        ...(typeof input.party_size === "number" ? { partySize: input.party_size } : {}),
        ...(notes === undefined ? {} : { notes }),
        status: "confirmed",
        createdAt: EXAMPLE_DAY.toISOString(),
      };
      memory.bookings.set(booking.ref, booking);
      memory.service = serviceId;
      return { kind: "booking", booking };
    }
    case "reschedule_appointment": {
      if (!ok) return null;
      const ref = String(input.reference);
      const start = String(input.new_start);
      const earlier = memory.bookings.get(ref);
      // An appointment booked before the call: the calendar would know its service and contact;
      // the example knows the service the caller asked about, and leaves out what it never heard.
      const serviceId = earlier?.serviceId ?? memory.service ?? "";
      const booking: Booking = {
        ...(earlier ?? { contact: "", status: "confirmed" as const, createdAt: EXAMPLE_DAY.toISOString() }),
        ref,
        serviceId,
        name: earlier?.name ?? String(input.name),
        start,
        end: endOf(tenant, serviceId, start),
      };
      memory.bookings.set(ref, booking);
      return { kind: "reschedule", booking };
    }
    case "cancel_appointment":
      return ok ? { kind: "cancellation", ref: String(input.reference) } : null;
    case "transfer_call":
      // A transfer nobody answered is in the summary too, as "not answered" (execute.ts).
      return { kind: "transfer", targetId: String(input.target), connected: ok };
    default:
      return null;
  }
}

/** One e-mail as renderSummaryEmail writes it, without the lines that need what the script does not know. */
function renderMail(script: DemoScript, tenant: VoiceTenantConfig, outcomes: Outcome[], request: boolean): AfterCallMail {
  const [first, second] = VARIANTS.map((variant) =>
    renderSummaryEmail(
      {
        tenant: tenant.id,
        sessionId: variant.sessionId,
        channel: "phone",
        startedAt: new Date(variant.startedAt).toISOString(),
        durationSeconds: request ? 0 : variant.durationSeconds,
        locale: script.locale,
        outcomes,
        noOutcome: outcomes.length === 0,
      },
      tenant,
      { request },
    ),
  );
  const a = first.text.split("\n");
  const b = second.text.split("\n");
  const kept = a.length === b.length ? a.filter((line, index) => line === b[index]) : a;
  return {
    subject: first.subject === second.subject ? first.subject : "",
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/**
 * The e-mails of one written example and the steps at which the business has them. Every step
 * lists all the e-mails the business has if the call ends right after it: the requests so far, in
 * order, then the end-of-call summary of what else happened, if anything did.
 */
export function demoAfterCall(script: DemoScript, tenant: VoiceTenantConfig): DemoAfterCall {
  const mails: AfterCallMail[] = [];
  const indexOf = (mail: AfterCallMail): number => {
    const found = mails.findIndex((known) => known.subject === mail.subject && known.text === mail.text);
    if (found !== -1) return found;
    mails.push(mail);
    return mails.length - 1;
  };
  const memory: Memory = { bookings: new Map(), service: null };
  const requests: number[] = [];
  const atEnd: Outcome[] = [];
  const steps: AfterCallStep[] = [];

  script.lines.forEach((line, lineIndex) => {
    // As the player: a tool belongs to an assistant line with text (scripted.ts schedule()).
    if (!line.tool || line.role !== "assistant" || line.text.trim() === "") return;
    const outcome = outcomeOf(script, lineIndex, line.tool, tenant, memory);
    if (outcome === null) return;
    if (outcome.kind === "lead" || outcome.kind === "callback") requests.push(indexOf(renderMail(script, tenant, [outcome], true)));
    else atEnd.push(outcome);
    const summary = atEnd.length > 0 ? [indexOf(renderMail(script, tenant, [...atEnd], false))] : [];
    steps.push({ captionId: scriptCaptionId(script.id, lineIndex), mails: [...requests, ...summary] });
  });

  return { locale: tenant.defaultLocale, mails, steps };
}
