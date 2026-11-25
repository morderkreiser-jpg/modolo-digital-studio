// Runs one tool call of the model. Server-only (node:crypto): the inputs carry personal data and the
// sinks reach the business.
//
// Order, cheapest and most fundamental first, stopping at the first refusal:
//   1. the tool exists for THIS tenant (listed and usable)          else not_enabled
//   2. the per-session cap on tool calls (a model looping stops)      else limit_reached
//   3. validateToolInput: strict schema, tenant ids, normalisation    else invalid_input
//   4. a repeat of something this session already did is answered from memory; only a genuinely
//      new booking, lead or callback then takes a unit of its cap     else limit_reached
//   5. the action itself (calendar, sinks), whose failures are reported as failures (and give the
//      cap unit back).
//
// The `say` of every outcome is a short factual English line for the model. It states what did NOT
// happen whenever something failed, so the model never tells a caller a booking, request or
// transfer went through when it did not. It never contains a transfer number.
//
// Repeats are harmless: bookings and moves carry an idempotency key derived from the session, the
// tool and the normalised input, so a model that repeats a call gets the same booking back instead
// of a second one; a repeated lead or callback returns the first answer without reaching the sink
// again; an outcome is recorded and counted once. A booking of the same service at the same time
// with OTHER details (the caller corrected a phone number) is not a second booking either: the
// model is told the time is already booked in this conversation and how to change it. Only on a
// calendar with seats, when the model marks the call as another group (separate_party) under a
// name that does not hold the time yet, is it a second party, booked like any other
// (bookAppointment).
//
// The caps live in ctx.counters, one object per session. When the session is kept in a shared
// store between requests, ctx.caps counts them atomically there as well, so requests of one
// session running in parallel can never pass more actions than the caps allow.
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
  HandoffTarget,
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
import { nameKey } from "@/lib/voice/calendar/memory";
import { isHoliday, isOpenAt, parseIsoInstant, weekdayOf, zonedParts } from "@/lib/voice/hours";
import { enabledTools, englishText, usesSeats } from "./definitions";
import { normalizePhone, validateToolInput } from "./validate";

export interface SessionCounters {
  toolCalls: number;
  bookings: number;
  leads: number;
}

/**
 * The per-session caps kept atomically in a store (lib/voice/server/limits.ts createSessionCaps).
 * `take` takes one unit of `kind` when fewer than `max` were taken, else answers false.
 */
export interface SessionCaps {
  take(kind: keyof SessionCounters, max: number): Promise<boolean>;
  /** Gives back a unit taken for an action that did not happen. */
  giveBack(kind: keyof SessionCounters): Promise<void>;
}

/**
 * Where leads and callback wishes go. `idempotencyKey` is the tool call's own (the session, the
 * tool and the normalised input): a sink that hands the record to a service passes it on, so the
 * same request sent twice reaches the business once, and derives anything it answers with (the
 * lead's ref) from it, so the second answer names what the business received. `uncertain`: the
 * service did not say in time whether it took the record.
 */
export interface ToolSinks {
  lead(record: {
    tenant: string;
    sessionId: string;
    taskId: string;
    fields: Record<string, string>;
    contact: Record<string, string>;
    summary: string;
    locale: VoiceLocale;
    idempotencyKey?: string;
  }): Promise<{ ok: boolean; ref: string; uncertain?: boolean }>;
  callback(record: {
    tenant: string;
    sessionId: string;
    name: string;
    phone: string;
    topic: string;
    preferredTime?: string;
    locale: VoiceLocale;
    idempotencyKey?: string;
  }): Promise<{ ok: boolean; uncertain?: boolean }>;
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
  /** The session's caps in a shared store; when given, they decide (counters mirror them). */
  caps?: SessionCaps;
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

/** An appointment this session booked or moved, as it stands now. */
export interface SessionBooking {
  serviceId: string;
  start: string;
  /** Idempotency key of the book_appointment call that made it ("" when it was only moved here). */
  key: string;
  status: "confirmed" | "cancelled";
  /**
   * Who it is booked for, as two short hashes (personOf): of the normalised name and of the
   * contact, never the name or the contact themselves. A second group at the same time needs a
   * name other than this one; the contact picks the booking a correction refers to (review
   * finding S2-11). Absent in snapshots written before; such a booking counts as the same
   * person, the safe direction.
   */
  person?: BookingPerson;
}

export interface BookingPerson {
  name: string;
  contact: string;
}

// What one session has already done, for replays. Keyed by the session's counters object (one per
// session, see ToolContext), so it disappears with the session.
interface SessionMemory {
  recorded: Set<string>;
  replies: Map<string, ToolOutcome>;
  /** By booking reference. */
  bookings: Map<string, SessionBooking>;
}
const sessions = new WeakMap<SessionCounters, SessionMemory>();

function memoryOf(counters: SessionCounters): SessionMemory {
  let memory = sessions.get(counters);
  if (memory === undefined) {
    memory = { recorded: new Set(), replies: new Map(), bookings: new Map() };
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
  /** Absent in snapshots written before bookings were remembered. */
  bookings?: Array<[string, SessionBooking]>;
}

/** Largest number of entries carried per list: far above any per-session tool cap. */
const MAX_MEMORY_ENTRIES = 200;

export function exportToolMemory(counters: SessionCounters): ToolMemorySnapshot {
  const memory = sessions.get(counters);
  if (memory === undefined) return { recorded: [], replies: [], bookings: [] };
  return {
    recorded: [...memory.recorded].slice(-MAX_MEMORY_ENTRIES),
    replies: [...memory.replies].slice(-MAX_MEMORY_ENTRIES),
    bookings: [...memory.bookings]
      .slice(-MAX_MEMORY_ENTRIES)
      .map(([ref, booking]) => [ref, { ...booking, ...(booking.person ? { person: { ...booking.person } } : {}) }]),
  };
}

const PERSON_HASH_RE = /^[0-9a-f]{16}$/;

function isBookingPerson(value: unknown): value is BookingPerson {
  if (typeof value !== "object" || value === null) return false;
  const { name, contact } = value as Partial<BookingPerson>;
  return typeof name === "string" && PERSON_HASH_RE.test(name) && typeof contact === "string" && PERSON_HASH_RE.test(contact);
}

/**
 * Restores an exported memory onto the session's (new) counters object. Entries that do not have
 * the exported shape are skipped: the snapshot comes back from storage. Never throws.
 */
export function importToolMemory(counters: SessionCounters, snapshot: unknown): void {
  if (typeof snapshot !== "object" || snapshot === null) return;
  const memory = memoryOf(counters);
  const { recorded, replies, bookings } = snapshot as { recorded?: unknown; replies?: unknown; bookings?: unknown };
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
  if (Array.isArray(bookings)) {
    for (const entry of bookings.slice(-MAX_MEMORY_ENTRIES)) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") continue;
      const booking = entry[1] as Partial<SessionBooking> | null;
      if (
        booking &&
        typeof booking === "object" &&
        typeof booking.serviceId === "string" &&
        typeof booking.start === "string" &&
        typeof booking.key === "string" &&
        (booking.status === "confirmed" || booking.status === "cancelled")
      ) {
        const person = isBookingPerson(booking.person) ? { name: booking.person.name, contact: booking.person.contact } : undefined;
        memory.bookings.set(entry[0], {
          serviceId: booking.serviceId,
          start: booking.start,
          key: booking.key,
          status: booking.status,
          ...(person ? { person } : {}),
        });
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
  const capped = await checkToolCallCap(ctx, name);
  if (capped !== null) return capped;

  // The call's language and clock: a number without a country code is taken as Swiss only in a
  // German call, and a date a caller leaves must not lie in the past.
  const checked = validateToolInput(ctx.tenant, name, call.input, { locale: ctx.locale, now: ctx.now });
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
 * The cap on tool calls. end_call is exempt: ending a conversation must always work. Every other
 * call counts, invalid ones and repeats included (a model looping on bad input stops).
 */
async function checkToolCallCap(ctx: ToolContext, name: VoiceToolName): Promise<ToolOutcome | null> {
  if (name === "end_call") return null;
  const { counters, limits } = ctx;
  const allowed = ctx.caps ? await ctx.caps.take("toolCalls", limits.toolCallsPerSession) : counters.toolCalls < limits.toolCallsPerSession;
  if (!allowed) {
    return failure("limit_reached", "No more actions are possible in this conversation. Tell the caller what was done so far.");
  }
  counters.toolCalls += 1;
  return null;
}

// The wording keeps earlier successes intact: a capped new action must not sound like "it was lost".
const NO_MORE_BOOKINGS = "No more bookings are possible in this conversation; this one was not booked. Bookings confirmed earlier stand.";
// A callback request is a record handed to the business like a lead: same cap.
const NO_MORE_REQUESTS =
  "No more requests can be passed on in this conversation; this one was not stored. Requests passed on earlier stand.";
// The email service did not answer in time: the request may have arrived. Neither "passed on"
// nor "lost" is true, and a second try with the same details cannot send it twice (the sink
// passes the call's idempotency key on). Review finding S2-8.
const UNCERTAIN_REQUEST =
  "It is not certain that the request reached the team: the email service did not confirm it in time. Do not say it was passed on, and do not say it was lost. Offer to try once more; with the same details it is not sent twice.";

/** Takes one unit of a booking or lead cap for a genuinely NEW action. */
async function takeActionCap(ctx: ToolContext, kind: "bookings" | "leads"): Promise<boolean> {
  const max = kind === "bookings" ? ctx.limits.bookingsPerSession : ctx.limits.leadsPerSession;
  return ctx.caps ? ctx.caps.take(kind, max) : ctx.counters[kind] < max;
}

/** The action did not happen (or was not new): its unit goes back. */
async function returnActionCap(ctx: ToolContext, kind: "bookings" | "leads"): Promise<void> {
  if (ctx.caps) await ctx.caps.giveBack(kind);
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
  const memory = memoryOf(ctx.counters);
  // The flag says what the call is for, not what is booked: the same details with or without it
  // are the same booking, so it stays out of the key.
  const { separate_party: separateParty, ...details } = input;
  const key = idempotencyKey(ctx, "book_appointment", details);
  const serviceId = input.service as string;
  const start = input.start as string;
  const person = personOf(ctx, input.name as string, input.contact as string);

  // This conversation's bookings of the same service at the same time. With the same details it
  // is a repeat, and the calendar's idempotency hands the first booking back. With other details
  // it is taken for a correction (a misheard name, a phone number or the party size fixed): a
  // second booking would hold a second table, or meet the caller's own booking as "taken", so the
  // model is told what stands and how to change it (review correttezza/F1). Which details changed
  // cannot tell a correction from another group: the name and the contact are kept only as hashes,
  // and a caller may correct both at once ("Sara Moller", +41...44 → "Sarah Müller", +41...45).
  // So on a calendar with seats a second group at the same time is booked only when the model
  // says so (separate_party, after the caller confirmed it) and gives that group's own name;
  // within the bookings cap (review finding S2-11). Where one time takes one booking, every other
  // booking of it is refused.
  const sameTime = [...memory.bookings.entries()].filter(
    ([, booking]) => booking.status === "confirmed" && booking.serviceId === serviceId && booking.start === start,
  );
  const repeat = sameTime.some(([, booking]) => booking.key === key);
  if (!repeat && sameTime.length > 0) {
    const seats = usesSeats(ctx.tenant);
    const sameName = sameTime.find(([, booking]) => booking.person === undefined || booking.person.name === person.name);
    if (!seats || separateParty !== true || sameName !== undefined) {
      const meant = sameName ?? bookingMeant(sameTime, person);
      // Several bookings at this time and neither the name nor the contact says which one the
      // call corrects: no reference is named, or the model would be told to cancel another
      // group's table (final review).
      if (meant === null) return alreadyBookedSeveral(ctx, sameTime, seats);
      return alreadyBooked(ctx, meant[0], meant[1], seats, seats && separateParty === true);
    }
  }
  if (!repeat && !(await takeActionCap(ctx, "bookings"))) return failure("limit_reached", NO_MORE_BOOKINGS);

  const result = await safely(
    ctx.calendar.book({
      serviceId,
      start,
      name: input.name as string,
      contact: input.contact as string,
      partySize: input.party_size as number | undefined,
      notes: input.notes as string | undefined,
      idempotencyKey: key,
      now: ctx.now,
    }),
  );
  if (!result.ok) {
    if (!repeat) await returnActionCap(ctx, "bookings");
    return calendarFailure(ctx, "book", result.code);
  }

  const booking = result.value;
  if (recordOnce(ctx, `booking:${booking.ref}`, { kind: "booking", booking })) {
    ctx.counters.bookings += 1;
  } else if (!repeat) {
    // The calendar answered with a booking this session already has: nothing new was booked.
    await returnActionCap(ctx, "bookings");
  }
  memory.bookings.set(booking.ref, { serviceId: booking.serviceId, start: booking.start, key, status: "confirmed", person });
  const { date, time } = spokenStart(booking.start, ctx.tenant.hours.timezone);
  const party = booking.partySize === undefined ? "" : ` For ${booking.partySize} ${booking.partySize === 1 ? "person" : "people"}.`;
  return {
    ok: true,
    say: `Booked: ${date} at ${time}, reference ${booking.ref}.${party} Give the caller the reference.`,
    data: bookingData(booking),
  };
}

/**
 * The say for a booking of a time this conversation already booked, with other details (see
 * bookAppointment). It also says what a booking for someone else needs: on a calendar with seats
 * the caller's confirmation and that group's own name (`flagged`: the model said it was another
 * group, under a name that already holds this time), elsewhere another time.
 */
function alreadyBooked(ctx: ToolContext, ref: string, booking: SessionBooking, seats: boolean, flagged = false): ToolOutcome {
  const { date, time } = spokenStart(booking.start, ctx.tenant.hours.timezone);
  const change = enabledTools(ctx.tenant).includes("cancel_appointment")
    ? ` To change the name, contact, party size or notes, cancel reference ${ref} with cancel_appointment, then book again.`
    : " Its details cannot be changed here; tell the caller the booking stands as it was made.";
  const other = !seats
    ? " This time takes only one booking: for someone else, check availability and offer other times."
    : flagged
      ? " This name already holds this time, so it is not another group: an extra booking for a different group needs that group's own name."
      : " Only if the caller confirms they want an extra booking for a different group, in addition to this one, call book_appointment again with that group's own name and separate_party: true.";
  return failure(
    "conflict",
    `This conversation already booked this time: ${date} at ${time}, reference ${ref}, with the details given then. Nothing new was booked and that booking was not changed.${change}${other}`,
  );
}

/**
 * Who a booking is for, as two short hashes (SessionBooking.person): of the name as the calendar
 * matches it (nameKey: case, accents and word order do not count) and of the contact (already
 * normalised by validate.ts: E.164 or a lower-case address). Salted with the tenant and the
 * session, like the idempotency keys.
 */
function personOf(ctx: ToolContext, name: string, contact: string): BookingPerson {
  const hash = (part: string, value: string): string =>
    createHash("sha256").update(JSON.stringify([ctx.tenant.id, ctx.sessionId, part, value])).digest("hex").slice(0, 16);
  return { name: hash("name", nameKey(String(name ?? ""))), contact: hash("contact", String(contact ?? "").trim().toLowerCase()) };
}

/**
 * Of the bookings at one time, the one a call with other details refers to, for the conflict say:
 * the one with the same contact, else the only one there is. null when several are booked and
 * nothing says which one is meant: the say then names none of them (alreadyBookedSeveral).
 */
function bookingMeant(sameTime: Array<[string, SessionBooking]>, person: BookingPerson): [string, SessionBooking] | null {
  const sameContact = sameTime.find(([, booking]) => booking.person?.contact === person.contact);
  if (sameContact !== undefined) return sameContact;
  return sameTime.length === 1 ? sameTime[0] : null;
}

/**
 * The say when this conversation holds several bookings at this time and the call matches none of
 * them by name or contact (a caller of the first group correcting both, after a second group was
 * booked). It lists the references and has the model ask which one is meant, instead of pointing
 * at one of them.
 */
function alreadyBookedSeveral(ctx: ToolContext, sameTime: Array<[string, SessionBooking]>, seats: boolean): ToolOutcome {
  const { date, time } = spokenStart(sameTime[0][1].start, ctx.tenant.hours.timezone);
  const refs = sameTime.map(([ref]) => ref).join(", ");
  const change = enabledTools(ctx.tenant).includes("cancel_appointment")
    ? " To change the name, contact, party size or notes of one of them, first ask the caller which booking they mean, then cancel that reference with cancel_appointment and book again."
    : " Their details cannot be changed here; tell the caller the bookings stand as they were made.";
  const other = seats
    ? " Only if the caller confirms they want one more booking for a different group, in addition to these, call book_appointment again with that group's own name and separate_party: true."
    : "";
  return failure(
    "conflict",
    `This conversation already booked this time more than once: ${date} at ${time}, references ${refs}, each with the details given then. Nothing new was booked and none of them was changed. The details of this call match none of them, so it is not known which one it is about.${change}${other}`,
  );
}

async function cancelAppointment(ctx: ToolContext, input: Input): Promise<ToolOutcome> {
  if (ctx.calendar === null) return calendarFailure(ctx, "cancel", "unavailable");
  const result = await safely(
    ctx.calendar.cancel({ ref: input.reference as string, name: input.name as string, now: ctx.now }),
  );
  if (!result.ok) return calendarFailure(ctx, "cancel", result.code);

  const booking = result.value;
  recordOnce(ctx, `cancellation:${booking.ref}`, { kind: "cancellation", ref: booking.ref });
  const own = memoryOf(ctx.counters).bookings.get(booking.ref);
  if (own) own.status = "cancelled";
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
  // A move is its own outcome ("moved", not "booked"), and every move that changed the time is
  // recorded, so the last one always says where the appointment is now (also after moving back).
  // A repeat of the last move changes nothing and records nothing.
  const memory = memoryOf(ctx.counters);
  const known = memory.bookings.get(booking.ref);
  if (known === undefined || known.start !== booking.start) safeRecord(ctx, { kind: "reschedule", booking });
  if (known) {
    known.start = booking.start;
    known.person ??= personOf(ctx, booking.name, booking.contact);
  } else {
    memory.bookings.set(booking.ref, {
      serviceId: booking.serviceId,
      start: booking.start,
      key: "",
      status: "confirmed",
      person: personOf(ctx, booking.name, booking.contact),
    });
  }
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
  if (!(await takeActionCap(ctx, "leads"))) return failure("limit_reached", NO_MORE_REQUESTS);

  const taskId = input.task as string;
  const fields = input.fields as Record<string, string>;
  const contact: Record<string, string> = {};
  for (const field of ["name", "phone", "email", "company"]) {
    if (typeof input[field] === "string") contact[field] = input[field] as string;
  }
  let answer: { ok: boolean; ref: string; uncertain?: boolean } | null = null;
  try {
    answer = await ctx.sinks.lead({
      tenant: ctx.tenant.id,
      sessionId: ctx.sessionId,
      taskId,
      fields,
      contact,
      summary: input.summary as string,
      locale: ctx.locale,
      idempotencyKey: key,
    });
  } catch {
    answer = null;
  }
  if (answer?.ok !== true && answer?.uncertain === true) {
    // Not remembered: a repeat must reach the sink again, which sends it with the same key.
    await returnActionCap(ctx, "leads");
    return failure("unavailable", UNCERTAIN_REQUEST);
  }
  if (answer?.ok !== true || typeof answer.ref !== "string" || answer.ref === "") {
    await returnActionCap(ctx, "leads");
    return failure(
      "unavailable",
      `The request could not be stored. Nothing was passed on. Tell the caller it did not go through.${fallbackOffer(ctx, "written")}`,
    );
  }

  ctx.counters.leads += 1;
  recordOnce(ctx, `lead:${answer.ref}`, { kind: "lead", taskId, ref: answer.ref, fields, contact });
  // The task's own follow-up wording first: how a trade's office answers a job request is part
  // of the business's knowledge, not of the written channel.
  const task = ctx.tenant.tasks.find((candidate) => candidate.id === taskId);
  const outcome: ToolOutcome = {
    ok: true,
    say: `Stored and passed on to the team, reference ${answer.ref}.${promiseLine(ctx, task?.followUp ?? ctx.tenant.handoff.written.promise)}`,
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
  if (!(await takeActionCap(ctx, "leads"))) return failure("limit_reached", NO_MORE_REQUESTS);

  const name = input.name as string;
  const phone = input.phone as string;
  const topic = input.topic as string;
  const preferredTime = input.preferred_time as string | undefined;
  let answer: { ok: boolean; uncertain?: boolean } | null = null;
  try {
    answer = await ctx.sinks.callback({
      tenant: ctx.tenant.id,
      sessionId: ctx.sessionId,
      name,
      phone,
      topic,
      ...(preferredTime === undefined ? {} : { preferredTime }),
      locale: ctx.locale,
      idempotencyKey: key,
    });
  } catch {
    answer = null;
  }
  if (answer?.ok !== true && answer?.uncertain === true) {
    await returnActionCap(ctx, "leads");
    return failure("unavailable", UNCERTAIN_REQUEST);
  }
  if (answer?.ok !== true) {
    await returnActionCap(ctx, "leads");
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
  if (!takesTransfers(ctx.tenant.hours, target, ctx.now)) {
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

/**
 * Whether a transfer target takes calls at `at`. Without its own schedule it follows the opening
 * hours. With one, the tenant's calendar still applies: a holiday closes it and a day with special
 * hours limits it to those hours, so a closed office never rings on Good Friday. Only an on-call
 * line (`onCall`) follows its own schedule alone.
 */
export function takesTransfers(hours: BusinessHours, target: HandoffTarget, at: Date): boolean {
  if (!target.available) return isOpenAt(hours, at);
  const own: BusinessHours = { timezone: hours.timezone, weekly: target.available, holidays: [] };
  if (target.onCall === true) return isOpenAt(own, at);
  const date = zonedParts(at, hours.timezone).date;
  // A day with its own hours wins over the holiday list (BusinessHours): both schedules apply.
  if (hours.exceptions?.some((exception) => exception.date === date)) return isOpenAt(own, at) && isOpenAt(hours, at);
  if (isHoliday(hours, date)) return false;
  return isOpenAt(own, at);
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

/**
 * The tenant's own words about timing, so the model never invents a promise. Without them, the
 * business information decides: it may state when the office answers a request (and then the
 * assistant may say so), and when it states nothing, nothing is promised.
 */
function promiseLine(ctx: ToolContext, promise: VoiceText | undefined): string {
  const text = localText(ctx, promise);
  return text === ""
    ? " Do not promise when the business will get back, beyond what the business information states about requests."
    : ` About timing, say only: "${text}"`;
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
