// Runs one tool call of the model. Server-only (node:crypto): the inputs carry personal data and the
// sinks reach the business.
//
// Order, cheapest and most fundamental first, stopping at the first refusal:
//   1. the tool exists for THIS tenant (listed and usable)          else not_enabled
//   2. per-session caps (tool calls, bookings, leads)                 else limit_reached
//   3. validateToolInput: strict schema, tenant ids, normalisation    else invalid_input
//   4. the action itself (calendar, sinks), whose failures are reported as failures.
//
// The `say` of every outcome is a short factual English line for the model. It states what did NOT
// happen whenever something failed, so the model never tells a caller a booking, request or
// transfer went through when it did not. It never contains a transfer number.
//
// Repeats are harmless: bookings and moves carry an idempotency key derived from the session, the
// tool and the normalised input, so a model that repeats a call gets the same booking back instead
// of a second one; a repeated lead or callback returns the first answer without reaching the sink
// again; an outcome is recorded and counted once.
//
// executeTool never throws: a bug or a throwing backend becomes an "unavailable" outcome.
import { createHash } from "node:crypto";
import { VOICE_LOCALES, isVoiceToolName } from "@/lib/voice/types";
import type {
  Booking,
  BusinessHours,
  CalendarErrorCode,
  CalendarProvider,
  CalendarResult,
  CallSummary,
  ToolCall,
  ToolErrorCode,
  ToolOutcome,
  VoiceChannel,
  VoiceLimits,
  VoiceLocale,
  VoiceTenantConfig,
  VoiceText,
  VoiceToolName,
} from "@/lib/voice/types";
import { isOpenAt, parseIsoInstant, weekdayOf, zonedParts } from "@/lib/voice/hours";
import { enabledTools, englishText } from "./definitions";
import { normalizePhone, validateToolInput } from "./validate";

export interface SessionCounters {
  toolCalls: number;
  bookings: number;
  leads: number;
}

export interface ToolSinks {
  lead(record: {
    tenant: string;
    sessionId: string;
    taskId: string;
    fields: Record<string, string>;
    contact: Record<string, string>;
    summary: string;
    locale: VoiceLocale;
  }): Promise<{ ok: boolean; ref: string }>;
  callback(record: {
    tenant: string;
    sessionId: string;
    name: string;
    phone: string;
    topic: string;
    preferredTime?: string;
    locale: VoiceLocale;
  }): Promise<{ ok: boolean }>;
  transfer(request: { tenant: string; sessionId: string; targetId: string }): Promise<{ connected: boolean }>;
}

export interface ToolContext {
  tenant: VoiceTenantConfig;
  sessionId: string;
  locale: VoiceLocale;
  channel: VoiceChannel;
  now: Date;
  limits: VoiceLimits;
  /** Mutated: one object for the whole session. */
  counters: SessionCounters;
  calendar: CalendarProvider | null;
  sinks: ToolSinks;
  record(outcome: CallSummary["outcomes"][number]): void;
}

type Outcome = CallSummary["outcomes"][number];
type Input = Record<string, unknown>;

/** Slots listed to the model at most: on the phone two or three are offered anyway. */
const MAX_SLOTS_SHOWN = 16;
/** A run that could be a phone number: digits with the separators people type between them. */
const PHONE_LIKE = /\+?\d[\d\s().\/-]{4,}\d/g;
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// What one session has already done, for replays. Keyed by the session's counters object (one per
// session, see ToolContext), so it disappears with the session.
interface SessionMemory {
  recorded: Set<string>;
  replies: Map<string, ToolOutcome>;
}
const sessions = new WeakMap<SessionCounters, SessionMemory>();

function memoryOf(counters: SessionCounters): SessionMemory {
  let memory = sessions.get(counters);
  if (memory === undefined) {
    memory = { recorded: new Set(), replies: new Map() };
    sessions.set(counters, memory);
  }
  return memory;
}

/**
 * The replay memory of a session as plain JSON. A session whose state is stored between requests
 * (the text-turn mode keeps it in the KV store, lib/voice/server/state.ts) gets a new counters
 * object on every request: without carrying this along, a lead repeated in a later turn would
 * reach the sink a second time and an outcome would be recorded twice.
 */
export interface ToolMemorySnapshot {
  recorded: string[];
  replies: Array<[string, ToolOutcome]>;
}

/** Largest number of entries carried per list: far above any per-session tool cap. */
const MAX_MEMORY_ENTRIES = 200;

export function exportToolMemory(counters: SessionCounters): ToolMemorySnapshot {
  const memory = sessions.get(counters);
  if (memory === undefined) return { recorded: [], replies: [] };
  return {
    recorded: [...memory.recorded].slice(-MAX_MEMORY_ENTRIES),
    replies: [...memory.replies].slice(-MAX_MEMORY_ENTRIES),
  };
}

/**
 * Restores an exported memory onto the session's (new) counters object. Entries that do not have
 * the exported shape are skipped: the snapshot comes back from storage. Never throws.
 */
export function importToolMemory(counters: SessionCounters, snapshot: unknown): void {
  if (typeof snapshot !== "object" || snapshot === null) return;
  const memory = memoryOf(counters);
  const { recorded, replies } = snapshot as { recorded?: unknown; replies?: unknown };
  if (Array.isArray(recorded)) {
    for (const key of recorded.slice(-MAX_MEMORY_ENTRIES)) if (typeof key === "string") memory.recorded.add(key);
  }
  if (Array.isArray(replies)) {
    for (const entry of replies.slice(-MAX_MEMORY_ENTRIES)) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") continue;
      const outcome = entry[1] as Partial<ToolOutcome> | null;
      if (outcome && typeof outcome === "object" && typeof outcome.ok === "boolean" && typeof outcome.say === "string") {
        memory.replies.set(entry[0], outcome as ToolOutcome);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function executeTool(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  let outcome: ToolOutcome;
  try {
    outcome = await run(ctx, call);
  } catch {
    outcome = failure("unavailable", "Something failed on our side. Nothing was done. Tell the caller it did not go through.");
  }
  return withoutTransferNumbers(outcome, ctx);
}

async function run(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  const name = call?.name;
  if (!isVoiceToolName(name) || !enabledTools(ctx.tenant).includes(name)) {
    return failure("not_enabled", "This action does not exist here. Do not try it again; tell the caller what you can do instead.");
  }
  const capped = checkCaps(ctx, name);
  if (capped !== null) return capped;

  const checked = validateToolInput(ctx.tenant, name, call.input);
  if (!checked.ok) {
    return failure(
      "invalid_input",
      `Some details are missing or not valid: ${checked.errors.join(" ")} Ask the caller again for these details. Nothing was done yet.`,
    );
  }
  const input = checked.value;
  switch (name) {
    case "check_availability":
      return checkAvailability(ctx, input);
    case "book_appointment":
      return bookAppointment(ctx, input);
    case "cancel_appointment":
      return cancelAppointment(ctx, input);
    case "reschedule_appointment":
      return rescheduleAppointment(ctx, input);
    case "create_lead":
      return createLead(ctx, input);
    case "request_callback":
      return requestCallback(ctx, input);
    case "transfer_call":
      return transferCall(ctx, input);
    case "end_call":
      return { ok: true, say: "The conversation ends after your goodbye.", data: { reason: input.reason }, endCall: true };
  }
}

/**
 * Per-session caps. end_call is exempt: ending a conversation must always work. Every other call
 * counts against toolCallsPerSession, invalid ones included (a model looping on bad input stops).
 */
function checkCaps(ctx: ToolContext, name: VoiceToolName): ToolOutcome | null {
  if (name === "end_call") return null;
  const { counters, limits } = ctx;
  if (counters.toolCalls >= limits.toolCallsPerSession) {
    return failure("limit_reached", "No more actions are possible in this conversation. Tell the caller what was done so far.");
  }
  counters.toolCalls += 1;
  // The wording keeps earlier successes intact: a capped repeat must not sound like "it was lost".
  if (name === "book_appointment" && counters.bookings >= limits.bookingsPerSession) {
    return failure(
      "limit_reached",
      "No more bookings are possible in this conversation; this one was not booked. Bookings confirmed earlier stand.",
    );
  }
  // A callback request is a record handed to the business like a lead: same cap.
  if ((name === "create_lead" || name === "request_callback") && counters.leads >= limits.leadsPerSession) {
    return failure(
      "limit_reached",
      "No more requests can be passed on in this conversation; this one was not stored. Requests passed on earlier stand.",
    );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Calendar tools
// ---------------------------------------------------------------------------------------------

type CalendarAction = "check" | "book" | "cancel" | "move";

async function checkAvailability(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  const serviceId = input.service as string;
  const date = input.date as string;
  const partOfDay = input.part_of_day as "morning" | "afternoon" | "evening" | undefined;
  if (ctx.calendar === null) return calendarFailure(ctx, "check", "unavailable", date);
  const result = await safely(
    ctx.calendar.findSlots({
      serviceId,
      date,
      partySize: input.party_size as number | undefined,
      partOfDay,
      now: ctx.now,
    }),
  );
  if (!result.ok) return calendarFailure(ctx, "check", result.code, date);

  const when = `${spokenDate(date)}${partOfDay ? ` (${partOfDay})` : ""}`;
  const service = serviceLabel(ctx, serviceId);
  if (result.value.length === 0) {
    return failure(
      "not_available",
      `No free start times for ${service} on ${when}. Offer another day${partOfDay ? " or another part of the day" : ""}.`,
    );
  }
  const timezone = ctx.tenant.hours.timezone;
  const shown = result.value.slice(0, MAX_SLOTS_SHOWN).map((slot) => ({ start: slot.start, time: localTime(slot.start, timezone) }));
  const more = result.value.length - shown.length;
  return {
    ok: true,
    say:
      `Free start times for ${service} on ${when}: ${shown.map((slot) => slot.time).join(", ")}` +
      `${more > 0 ? `, and ${more} later ones` : ""}. Offer the caller two or three of them.`,
    data: { service: serviceId, date, slots: shown, ...(more > 0 ? { more } : {}) },
  };
}

async function bookAppointment(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  if (ctx.calendar === null) return calendarFailure(ctx, "book", "unavailable");
  const result = await safely(
    ctx.calendar.book({
      serviceId: input.service as string,
      start: input.start as string,
      name: input.name as string,
      contact: input.contact as string,
      partySize: input.party_size as number | undefined,
      notes: input.notes as string | undefined,
      idempotencyKey: idempotencyKey(ctx, "book_appointment", input),
      now: ctx.now,
    }),
  );
  if (!result.ok) return calendarFailure(ctx, "book", result.code);

  const booking = result.value;
  if (recordOnce(ctx, `booking:${booking.ref}:${booking.start}`, { kind: "booking", booking })) ctx.counters.bookings += 1;
  const { date, time } = spokenStart(booking.start, ctx.tenant.hours.timezone);
  const party = booking.partySize === undefined ? "" : ` For ${booking.partySize} ${booking.partySize === 1 ? "person" : "people"}.`;
  return {
    ok: true,
    say: `Booked: ${date} at ${time}, reference ${booking.ref}.${party} Give the caller the reference.`,
    data: bookingData(booking),
  };
}

async function cancelAppointment(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  if (ctx.calendar === null) return calendarFailure(ctx, "cancel", "unavailable");
  const result = await safely(
    ctx.calendar.cancel({ ref: input.reference as string, name: input.name as string, now: ctx.now }),
  );
  if (!result.ok) return calendarFailure(ctx, "cancel", result.code);

  const booking = result.value;
  recordOnce(ctx, `cancellation:${booking.ref}`, { kind: "cancellation", ref: booking.ref });
  const { date, time } = spokenStart(booking.start, ctx.tenant.hours.timezone);
  return {
    ok: true,
    say: `Cancelled: the appointment on ${date} at ${time}, reference ${booking.ref}.`,
    data: bookingData(booking),
  };
}

async function rescheduleAppointment(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  if (ctx.calendar === null) return calendarFailure(ctx, "move", "unavailable");
  const result = await safely(
    ctx.calendar.reschedule({
      ref: input.reference as string,
      name: input.name as string,
      newStart: input.new_start as string,
      idempotencyKey: idempotencyKey(ctx, "reschedule_appointment", input),
      now: ctx.now,
    }),
  );
  if (!result.ok) return calendarFailure(ctx, "move", result.code);

  const booking = result.value;
  // The summary shows the booking at its new time; the reference stays the same.
  recordOnce(ctx, `booking:${booking.ref}:${booking.start}`, { kind: "booking", booking });
  const { date, time } = spokenStart(booking.start, ctx.tenant.hours.timezone);
  return {
    ok: true,
    say: `Moved: the appointment ${booking.ref} is now on ${date} at ${time}.`,
    data: bookingData(booking),
  };
}

const NOTHING_DONE: Record<CalendarAction, string> = {
  check: "",
  book: " Nothing was booked.",
  cancel: " Nothing was cancelled.",
  move: " The appointment was not moved and stays as it was.",
};

function calendarFailure(ctx: ToolContext, action: CalendarAction, code: CalendarErrorCode, date?: string): ToolOutcome {
  const config = ctx.tenant.calendar;
  const done = NOTHING_DONE[action];
  const offer = fallbackOffer(ctx);
  switch (code) {
    case "conflict":
      return failure("conflict", `That time is no longer free.${done} Check availability again and offer other times.`);
    case "outside_hours":
      return action === "check"
        ? failure("not_available", `No bookings on ${spokenDate(date ?? "")}: the business is closed or takes no appointments that day. Offer another day.`)
        : failure("not_available", `That time is outside the bookable hours.${done} Check availability and offer one of the free times.`);
    case "too_soon":
      return action === "check"
        ? failure("not_available", `${spokenDate(date ?? "")} is in the past or too soon to book. Offer a later day.`)
        : failure(
            "not_available",
            `That time is too soon: bookings need at least ${duration(config?.minLeadMinutes ?? 0)} notice.${done} Offer a later time.`,
          );
    case "too_far":
      return failure(
        "not_available",
        `Appointments can be booked at most ${config?.maxDaysAhead ?? 0} days ahead.${done} Offer an earlier day.`,
      );
    case "not_allowed": {
      if (action === "cancel") return failure("not_available", `Appointments cannot be cancelled here.${done}${offer}`);
      if (action === "move") return failure("not_available", `Appointments cannot be moved here.${done}${offer}`);
      const capacity = config?.capacity;
      const max = capacity?.kind === "seats" ? capacity.maxPartySize : 1;
      return failure("not_available", `Groups of more than ${max} people cannot be booked here.${done}${offer}`);
    }
    case "too_late_to_change":
      return failure(
        "not_available",
        `The appointment starts in less than ${duration(config?.changeMinLeadMinutes ?? 0)}, too soon to change it here.${done}${offer}`,
      );
    case "not_found":
      return failure(
        "not_found",
        `No appointment matches this reference and name.${done} Ask the caller to repeat the reference and the name the booking was made under.`,
      );
    case "invalid":
      return action === "check"
        ? failure("invalid_input", "The calendar did not accept the service, day or party size. Ask the caller again.")
        : failure("invalid_input", `That is not one of the free start times.${done} Check availability and use a time it returned.`);
    case "unavailable":
    default:
      return action === "check"
        ? failure("unavailable", `The calendar could not be reached, so availability is unknown. Tell the caller you cannot check it right now.${offer}`)
        : failure("unavailable", `The calendar did not answer.${done} Tell the caller it did not go through.${offer}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Leads, callbacks, transfers
// ---------------------------------------------------------------------------------------------

async function createLead(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  const memory = memoryOf(ctx.counters);
  const key = idempotencyKey(ctx, "create_lead", input);
  const replay = memory.replies.get(key);
  if (replay !== undefined) return replay;

  const taskId = input.task as string;
  const fields = input.fields as Record<string, string>;
  const contact: Record<string, string> = {};
  for (const field of ["name", "phone", "email", "company"]) {
    if (typeof input[field] === "string") contact[field] = input[field] as string;
  }
  let answer: { ok: boolean; ref: string } | null = null;
  try {
    answer = await ctx.sinks.lead({
      tenant: ctx.tenant.id,
      sessionId: ctx.sessionId,
      taskId,
      fields,
      contact,
      summary: input.summary as string,
      locale: ctx.locale,
    });
  } catch {
    answer = null;
  }
  if (answer?.ok !== true || typeof answer.ref !== "string" || answer.ref === "") {
    return failure(
      "unavailable",
      `The request could not be stored. Nothing was passed on. Tell the caller it did not go through.${fallbackOffer(ctx, "written")}`,
    );
  }

  ctx.counters.leads += 1;
  recordOnce(ctx, `lead:${answer.ref}`, { kind: "lead", taskId, ref: answer.ref, fields, contact });
  const outcome: ToolOutcome = {
    ok: true,
    say: `Stored and passed on to the team, reference ${answer.ref}.${promiseLine(ctx, ctx.tenant.handoff.written.promise)}`,
    data: { reference: answer.ref },
  };
  memory.replies.set(key, outcome);
  return outcome;
}

async function requestCallback(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  const memory = memoryOf(ctx.counters);
  const key = idempotencyKey(ctx, "request_callback", input);
  const replay = memory.replies.get(key);
  if (replay !== undefined) return replay;

  const name = input.name as string;
  const phone = input.phone as string;
  const topic = input.topic as string;
  const preferredTime = input.preferred_time as string | undefined;
  let answer: { ok: boolean } | null = null;
  try {
    answer = await ctx.sinks.callback({
      tenant: ctx.tenant.id,
      sessionId: ctx.sessionId,
      name,
      phone,
      topic,
      ...(preferredTime === undefined ? {} : { preferredTime }),
      locale: ctx.locale,
    });
  } catch {
    answer = null;
  }
  if (answer?.ok !== true) {
    return failure(
      "unavailable",
      `The callback request could not be passed on. Tell the caller it did not go through.${fallbackOffer(ctx, "callback")}`,
    );
  }

  ctx.counters.leads += 1;
  recordOnce(ctx, `callback:${key}`, {
    kind: "callback",
    name,
    phone,
    topic,
    ...(preferredTime === undefined ? {} : { preferredTime }),
  });
  const outcome: ToolOutcome = {
    ok: true,
    say: `Callback request passed on.${promiseLine(ctx, ctx.tenant.handoff.callback.promise)}`,
  };
  memory.replies.set(key, outcome);
  return outcome;
}

async function transferCall(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  const target = ctx.tenant.handoff.transfer.targets.find((candidate) => candidate.id === input.target);
  if (target === undefined) return failure("invalid_input", "Unknown transfer target. Nobody was put through.");
  if (ctx.channel === "web") {
    return failure("forbidden", `Live transfer works only on phone calls; nobody was put through.${fallbackOffer(ctx)}`);
  }
  const label = localText(ctx, target.label) || target.id;
  // A target with its own schedule (an on-call line) follows it; otherwise the opening hours.
  const schedule: BusinessHours = target.available
    ? { timezone: ctx.tenant.hours.timezone, weekly: target.available, holidays: [] }
    : ctx.tenant.hours;
  if (!isOpenAt(schedule, ctx.now)) {
    return failure("not_available", `${label} takes no calls at this time; nobody was put through.${fallbackOffer(ctx)}`);
  }

  let connected: boolean;
  try {
    const answer = await ctx.sinks.transfer({ tenant: ctx.tenant.id, sessionId: ctx.sessionId, targetId: target.id });
    connected = answer?.connected === true;
  } catch {
    return failure("unavailable", `The transfer could not be started; nobody was put through.${fallbackOffer(ctx)}`);
  }
  safeRecord(ctx, { kind: "transfer", targetId: target.id, connected });
  if (!connected) {
    return failure("not_available", `${label} did not answer; the caller was not put through.${fallbackOffer(ctx)}`);
  }
  return { ok: true, say: `Connecting the caller to ${label} now.`, data: { target: target.id } };
}

// ---------------------------------------------------------------------------------------------
// Sinks for tests and demos
// ---------------------------------------------------------------------------------------------

/**
 * Sinks that keep everything in arrays. Leads get references "LD-2222", "LD-2223"... (the safe
 * alphabet of booking references). A transfer answers connected: false unless told otherwise.
 */
export function createMemorySinks(
  options: { transferConnected?: boolean } = {},
): ToolSinks & { leads: unknown[]; callbacks: unknown[]; transfers: unknown[] } {
  const leads: unknown[] = [];
  const callbacks: unknown[] = [];
  const transfers: unknown[] = [];
  return {
    leads,
    callbacks,
    transfers,
    async lead(record) {
      leads.push(record);
      return { ok: true, ref: `LD-${counterCode(leads.length - 1)}` };
    },
    async callback(record) {
      callbacks.push(record);
      return { ok: true };
    },
    async transfer(request) {
      transfers.push(request);
      return { connected: options.transferConnected === true };
    },
  };
}

function counterCode(counter: number): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  let rest = counter;
  for (let index = 0; index < 4; index += 1) {
    code = alphabet[rest % 32] + code;
    rest = Math.floor(rest / 32);
  }
  return code;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function failure(code: ToolErrorCode, say: string): ToolOutcome {
  return { ok: false, code, say };
}

/** A calendar call that cannot throw: an adapter that breaks its contract counts as unavailable. */
async function safely<T>(pending: Promise<CalendarResult<T>>): Promise<CalendarResult<T>> {
  try {
    const result = await pending;
    if (result && typeof result === "object" && typeof result.ok === "boolean") return result;
  } catch {
    // fall through
  }
  return { ok: false, code: "unavailable" };
}

/** Records an outcome the first time this session sees `key`. True when it was new. */
function recordOnce(ctx: ToolContext, key: string, outcome: Outcome): boolean {
  const memory = memoryOf(ctx.counters);
  if (memory.recorded.has(key)) return false;
  memory.recorded.add(key);
  safeRecord(ctx, outcome);
  return true;
}

function safeRecord(ctx: ToolContext, outcome: Outcome): void {
  try {
    ctx.record(outcome);
  } catch {
    // The summary is best effort; the caller's action already happened and must be reported as such.
  }
}

/**
 * sha256 of tenant + session + tool + the normalised input with sorted keys. The input was
 * normalised by validate.ts (E.164 phones, canonical ISO starts, trimmed text), so the same request
 * worded twice gives the same key, and two sessions never share one.
 */
function idempotencyKey(ctx: ToolContext, tool: VoiceToolName, input: Input): string {
  return createHash("sha256")
    .update(JSON.stringify([ctx.tenant.id, ctx.sessionId, tool, canonical(input)]))
    .digest("hex")
    .slice(0, 32);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Input).sort()) {
      const item = (value as Input)[key];
      if (item !== undefined) sorted[key] = canonical(item);
    }
    return sorted;
  }
  return value;
}

/** What the model may offer when an action fails, from what this tenant really offers. */
function fallbackOffer(ctx: ToolContext, exclude?: "callback" | "written"): string {
  const tools = enabledTools(ctx.tenant);
  const offers: string[] = [];
  if (exclude !== "callback" && tools.includes("request_callback")) offers.push("a callback");
  if (exclude !== "written" && ctx.tenant.handoff.written.enabled && tools.includes("create_lead")) {
    offers.push("a written follow-up");
  }
  return offers.length === 0 ? "" : ` Offer ${offers.join(" or ")} instead.`;
}

/** The tenant's own words about timing, so the model never invents a promise. */
function promiseLine(ctx: ToolContext, promise: VoiceText | undefined): string {
  const text = localText(ctx, promise);
  return text === "" ? " Do not promise when the business will get back." : ` About timing, say only: "${text}"`;
}

/** A VoiceText in the caller's language, else the tenant's default, else any. */
function localText(ctx: ToolContext, text: VoiceText | undefined): string {
  if (!text) return "";
  const own = text[ctx.locale] ?? text[ctx.tenant.defaultLocale];
  if (own) return own;
  for (const locale of VOICE_LOCALES) if (text[locale]) return text[locale] as string;
  return "";
}

function serviceLabel(ctx: ToolContext, serviceId: string): string {
  const service = ctx.tenant.calendar?.services.find((candidate) => candidate.id === serviceId);
  return service ? englishText(service.label, ctx.tenant.defaultLocale) || service.id : serviceId;
}

function bookingData(booking: Booking): Record<string, unknown> {
  return {
    reference: booking.ref,
    service: booking.serviceId,
    start: booking.start,
    end: booking.end,
    status: booking.status,
    ...(booking.partySize === undefined ? {} : { party_size: booking.partySize }),
  };
}

/** "2026-12-03" -> "Thursday 3 December 2026". Built by hand: ICU versions differ in commas. */
function spokenDate(date: string): string {
  const weekday = weekdayOf(date);
  if (weekday === null) return date;
  const [year, month, day] = date.split("-").map(Number);
  const index = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(weekday);
  return `${WEEKDAY_NAMES[index]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** The local day and HH:MM of an ISO start in the tenant's zone. */
function spokenStart(iso: string, timezone: string): { date: string; time: string } {
  const epoch = parseIsoInstant(iso);
  if (epoch === null) return { date: iso, time: "" };
  const parts = zonedParts(new Date(epoch), timezone);
  return { date: spokenDate(parts.date), time: clock(parts.minutes) };
}

function localTime(iso: string, timezone: string): string {
  return spokenStart(iso, timezone).time;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function duration(minutes: number): string {
  if (minutes > 0 && minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes > 0 && minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * Defence in depth: the says are built from labels, never from numbers, but a label typed with a
 * number in it ("Inhaberin (052 123 45 67)") must not leak the transfer line to the caller. Every
 * phone-like run of the say is compared by its E.164 form, whatever its spacing.
 */
function withoutTransferNumbers(outcome: ToolOutcome, ctx: ToolContext): ToolOutcome {
  const numbers = new Set<string>();
  for (const target of ctx.tenant.handoff?.transfer?.targets ?? []) {
    const number = typeof target.number === "string" ? normalizePhone(target.number) : null;
    if (number !== null) numbers.add(number);
  }
  if (numbers.size === 0) return outcome;
  const say = outcome.say.replace(PHONE_LIKE, (run) => (numbers.has(normalizePhone(run) ?? "") ? "[number withheld]" : run));
  return say === outcome.say ? outcome : { ...outcome, say };
}
