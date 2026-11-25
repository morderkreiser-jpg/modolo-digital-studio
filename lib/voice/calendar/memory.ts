// The built-in calendar: deterministic, kept in process memory, no backend. Used by the demos and
// the tests; real calendars (Google, Microsoft) are other implementations of CalendarProvider.
//
// Rules, shared by findSlots and book so that a slot offered is a slot bookable:
//   - Start times sit on a grid of slotStepMinutes counted from local midnight.
//   - The whole appointment, buffers included, must fit inside ONE bookable range of that day.
//     Bookable ranges: `config.bookable` for the weekday, or the opening hours when it is omitted.
//     Holidays close the day; an exception day uses its own hours (intersected with `bookable`).
//   - minLeadMinutes from now, at most maxDaysAhead calendar days ahead (tenant zone).
//   - "single" capacity: the blocked spans (appointment plus buffers) of two bookings never overlap.
//     "seats" capacity: at no moment of the new booking's turn window do the parties seated at that
//     moment exceed `total` (the real peak, not the sum of every overlapping booking: two
//     sittings one after the other share the same seats).
//   - With `busySeed`, about one start time in three is already taken (hash of seed + date + time),
//     so demos and tests meet "not available". Without it nothing is pre-booked.
//
// Every method is synchronous inside: between the checks and the write there is no await, so two
// "simultaneous" book() calls run one after the other and can never double-book. Methods never
// throw; failures are CalendarResult errors. Times are ISO 8601 with the tenant's offset.
import type {
  Booking,
  BusinessHours,
  CalendarConfig,
  CalendarErrorCode,
  CalendarProvider,
  CalendarResult,
  CalendarService,
  Slot,
} from "@/lib/voice/types";
import {
  daysBetween,
  formatClockTime,
  isHoliday,
  isValidDate,
  openingRangesOn,
  parseIsoInstant,
  toMinuteRanges,
  toZonedIso,
  wallTimeToEpoch,
  weekdayOf,
  zonedParts,
} from "@/lib/voice/hours";

export interface MemoryCalendarOptions {
  /** Pre-books about a third of the start times, deterministically. Demos set it; live tenants never. */
  busySeed?: string;
  /** Makes booking references deterministic (tests). Without it they are random. */
  refSeed?: string;
  /** Bookings kept at most; the oldest are dropped beyond it, so a public demo cannot grow memory. */
  maxBookings?: number;
}

/** 32 symbols: digits and capitals without 0/O and 1/I, which callers confuse when spelling. */
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REF_PREFIX = "MV-";
const REF_LENGTH = 4;

const MINUTE_MS = 60_000;
const DEFAULT_STEP_MINUTES = 30;
const DEFAULT_MAX_BOOKINGS = 5_000;
const MAX_NAME_CHARS = 100;
const MAX_CONTACT_CHARS = 120;
const MAX_NOTES_CHARS = 500;
/** Part-of-day bounds, minutes since local midnight: morning < 12:00 <= afternoon < 17:00 <= evening. */
const NOON = 12 * 60;
const EVENING = 17 * 60;

interface Entry {
  booking: Booking;
  startMs: number;
  endMs: number;
  /** The span the resource is blocked: buffers included. */
  spanStart: number;
  spanEnd: number;
  seats: number;
  nameKey: string;
}

interface Span {
  startMs: number;
  endMs: number;
  spanStart: number;
  spanEnd: number;
}

type Result<T> = CalendarResult<T>;

function fail<T>(code: CalendarErrorCode): Result<T> {
  return { ok: false, code };
}

export function createMemoryCalendar(
  config: CalendarConfig,
  hours: BusinessHours,
  options: MemoryCalendarOptions = {},
): CalendarProvider {
  const timezone = hours.timezone;
  const step = positiveInteger(config.slotStepMinutes) ?? DEFAULT_STEP_MINUTES;
  const maxBookings = positiveInteger(options.maxBookings) ?? DEFAULT_MAX_BOOKINGS;
  const entries = new Map<string, Entry>();
  // idempotencyKey -> what the first call asked for and the booking it produced. Only successes are
  // remembered: a failure (slot taken, too soon) must not stick to a key that is retried later.
  const bookKeys = new Map<string, { fingerprint: string; ref: string }>();
  const moveKeys = new Map<string, { fingerprint: string; ref: string }>();
  let refCounter = 0;

  function serviceById(id: unknown): CalendarService | null {
    if (typeof id !== "string" || !Array.isArray(config.services)) return null;
    const service = config.services.find((candidate) => candidate.id === id);
    return service && positiveInteger(service.durationMinutes) !== null ? service : null;
  }

  /** Seats a party takes, or why it cannot be booked. A single resource ignores the party size. */
  function seatsFor(partySize: number | undefined): number | CalendarErrorCode {
    if (config.capacity.kind !== "seats" || partySize === undefined) return 1;
    if (!Number.isInteger(partySize) || partySize < 1) return "invalid";
    if (partySize > config.capacity.maxPartySize) return "not_allowed";
    return partySize;
  }

  function bookableRanges(date: string): Array<[number, number]> {
    const weekday = weekdayOf(date);
    if (weekday === null) return [];
    const opening = toMinuteRanges(openingRangesOn(hours, date));
    if (!config.bookable) return opening;
    // Special hours of an exception day limit the bookable hours; a holiday closes them; on any
    // other day `bookable` stands on its own (it may extend beyond the opening hours).
    if (hours.exceptions?.some((exception) => exception.date === date)) {
      return intersect(toMinuteRanges(config.bookable[weekday]), opening);
    }
    if (isHoliday(hours, date)) return [];
    return toMinuteRanges(config.bookable[weekday]);
  }

  function spanFor(service: CalendarService, startMs: number): Span {
    const endMs = startMs + service.durationMinutes * MINUTE_MS;
    return {
      startMs,
      endMs,
      spanStart: startMs - (nonNegative(service.bufferBeforeMinutes) * MINUTE_MS),
      spanEnd: endMs + nonNegative(service.bufferAfterMinutes) * MINUTE_MS,
    };
  }

  function fitsOneRange(date: string, span: Span): boolean {
    for (const [from, to] of bookableRanges(date)) {
      const fromMs = wallTimeToEpoch(date, from, timezone, "next");
      const toMs = wallTimeToEpoch(date, to, timezone, "next");
      if (fromMs !== null && toMs !== null && span.spanStart >= fromMs && span.spanEnd <= toMs) return true;
    }
    return false;
  }

  function isSeededBusy(date: string, minutes: number): boolean {
    if (options.busySeed === undefined) return false;
    return hash32(`${options.busySeed}|${date}|${formatClockTime(minutes)}`) % 3 === 0;
  }

  function hasCapacity(span: Span, seats: number, excludeRef: string | null): boolean {
    const others: Entry[] = [];
    for (const entry of entries.values()) {
      if (entry.booking.status === "confirmed" && entry.booking.ref !== excludeRef) others.push(entry);
    }
    if (config.capacity.kind !== "seats") {
      return !others.some((entry) => entry.spanStart < span.spanEnd && span.spanStart < entry.spanEnd);
    }
    const { total, turnMinutes } = config.capacity;
    const turn = (positiveInteger(turnMinutes) ?? Math.max(1, Math.round((span.endMs - span.startMs) / MINUTE_MS))) * MINUTE_MS;
    const windowEnd = span.startMs + turn;
    const overlapping = others.filter((entry) => entry.startMs < windowEnd && span.startMs < entry.startMs + turn);
    // Occupancy only changes when a sitting starts, so the peak is at one of these moments.
    const moments = [span.startMs, ...overlapping.map((entry) => entry.startMs).filter((at) => at > span.startMs)];
    for (const moment of moments) {
      let seated = seats;
      for (const entry of overlapping) {
        if (entry.startMs <= moment && moment < entry.startMs + turn) seated += entry.seats;
      }
      if (seated > total) return false;
    }
    return true;
  }

  /** Why this start cannot be booked now, or null when it can. The single source of truth. */
  function evaluate(
    service: CalendarService,
    startMs: number,
    seats: number,
    nowMs: number,
    excludeRef: string | null,
  ): CalendarErrorCode | null {
    const local = zonedParts(new Date(startMs), timezone);
    if (startMs % MINUTE_MS !== 0 || local.minutes % step !== 0) return "invalid";
    if (startMs < nowMs + nonNegative(config.minLeadMinutes) * MINUTE_MS) return "too_soon";
    const today = zonedParts(new Date(nowMs), timezone).date;
    if (daysBetween(today, local.date) > nonNegative(config.maxDaysAhead)) return "too_far";
    const span = spanFor(service, startMs);
    if (!fitsOneRange(local.date, span)) return "outside_hours";
    if (isSeededBusy(local.date, local.minutes)) return "conflict";
    return hasCapacity(span, seats, excludeRef) ? null : "conflict";
  }

  function findEntry(ref: unknown, name: unknown): Entry | null {
    const normalized = typeof ref === "string" ? normalizeBookingRef(ref) : null;
    if (normalized === null || typeof name !== "string") return null;
    const entry = entries.get(normalized);
    // A wrong name answers exactly like an unknown reference: nothing tells a guesser which half was wrong.
    return entry && entry.nameKey === nameKey(name) ? entry : null;
  }

  function nextRef(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = options.refSeed === undefined ? randomCode(REF_LENGTH) : seededCode(options.refSeed, refCounter++);
      const ref = `${REF_PREFIX}${code}`;
      if (!entries.has(ref)) return ref;
    }
    // A million codes make this unreachable in practice; a longer code beats a loop without end.
    return `${REF_PREFIX}${randomCode(REF_LENGTH * 2)}`;
  }

  function remember(entry: Entry): void {
    entries.set(entry.booking.ref, entry);
    while (entries.size > maxBookings) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function rememberKey(map: Map<string, { fingerprint: string; ref: string }>, key: string, value: { fingerprint: string; ref: string }): void {
    map.set(key, value);
    while (map.size > maxBookings) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  function nowOf(now: Date | undefined): number {
    const ms = now instanceof Date ? now.getTime() : Number.NaN;
    return Number.isFinite(ms) ? ms : Date.now();
  }

  function toSlot(service: CalendarService, startMs: number): Slot {
    const span = spanFor(service, startMs);
    return {
      serviceId: service.id,
      start: toZonedIso(new Date(span.startMs), timezone),
      end: toZonedIso(new Date(span.endMs), timezone),
    };
  }

  // ------------------------------------------------------------------------------------------
  // The provider
  // ------------------------------------------------------------------------------------------

  function findSlots(query: Parameters<CalendarProvider["findSlots"]>[0]): Result<Slot[]> {
    const service = serviceById(query.serviceId);
    if (service === null || !isValidDate(query.date)) return fail("invalid");
    const seats = seatsFor(query.partySize);
    if (typeof seats === "string") return fail(seats);
    const partOfDay = query.partOfDay;
    if (partOfDay !== undefined && partOfDay !== "morning" && partOfDay !== "afternoon" && partOfDay !== "evening") {
      return fail("invalid");
    }

    const nowMs = nowOf(query.now);
    const ahead = daysBetween(zonedParts(new Date(nowMs), timezone).date, query.date);
    if (ahead < 0) return fail("too_soon");
    if (ahead > nonNegative(config.maxDaysAhead)) return fail("too_far");
    const ranges = bookableRanges(query.date);
    if (ranges.length === 0) return fail("outside_hours");

    const seen = new Set<number>();
    const starts: number[] = [];
    for (const [from, to] of ranges) {
      for (let minutes = Math.ceil(from / step) * step; minutes < to; minutes += step) {
        if (!inPartOfDay(minutes, partOfDay)) continue;
        // null: the time does not exist on this day (spring gap).
        const startMs = wallTimeToEpoch(query.date, minutes, timezone, "null");
        if (startMs === null || seen.has(startMs)) continue;
        seen.add(startMs);
        if (evaluate(service, startMs, seats, nowMs, null) === null) starts.push(startMs);
      }
    }
    starts.sort((a, b) => a - b);
    return { ok: true, value: starts.map((startMs) => toSlot(service, startMs)) };
  }

  function book(request: Parameters<CalendarProvider["book"]>[0]): Result<Booking> {
    const service = serviceById(request.serviceId);
    const startMs = typeof request.start === "string" ? parseIsoInstant(request.start) : null;
    const name = cleanText(request.name, MAX_NAME_CHARS);
    const contact = cleanText(request.contact, MAX_CONTACT_CHARS);
    const notes = request.notes === undefined ? "" : cleanText(request.notes, MAX_NOTES_CHARS);
    const key = typeof request.idempotencyKey === "string" ? request.idempotencyKey : "";
    if (service === null || startMs === null || name === "" || contact === "" || key === "") return fail("invalid");
    const seats = seatsFor(request.partySize);
    if (typeof seats === "string") return fail(seats);
    const partySize = config.capacity.kind === "seats" ? seats : undefined;

    const fingerprint = JSON.stringify([service.id, startMs, name, contact, partySize ?? null, notes]);
    const prior = bookKeys.get(key);
    if (prior) {
      // The same key for a different request is a caller bug: refuse rather than guess.
      if (prior.fingerprint !== fingerprint) return fail("invalid");
      const entry = entries.get(prior.ref);
      if (entry && entry.booking.status === "confirmed") return { ok: true, value: { ...entry.booking } };
      // Cancelled (or dropped) since: the key protects against duplicates, not against booking again.
      bookKeys.delete(key);
    }

    const nowMs = nowOf(request.now);
    const code = evaluate(service, startMs, seats, nowMs, null);
    if (code !== null) return fail(code);

    const span = spanFor(service, startMs);
    const booking: Booking = {
      ref: nextRef(),
      serviceId: service.id,
      start: toZonedIso(new Date(span.startMs), timezone),
      end: toZonedIso(new Date(span.endMs), timezone),
      name,
      contact,
      ...(partySize === undefined ? {} : { partySize }),
      ...(notes === "" ? {} : { notes }),
      status: "confirmed",
      createdAt: toZonedIso(new Date(nowMs), timezone),
    };
    remember({ booking, ...span, seats, nameKey: nameKey(name) });
    rememberKey(bookKeys, key, { fingerprint, ref: booking.ref });
    return { ok: true, value: { ...booking } };
  }

  function cancel(request: Parameters<CalendarProvider["cancel"]>[0]): Result<Booking> {
    if (!config.allowCancel) return fail("not_allowed");
    const entry = findEntry(request.ref, request.name);
    if (entry === null) return fail("not_found");
    // Cancelling twice is harmless: a repeated call gets the same answer, not an error.
    if (entry.booking.status === "cancelled") return { ok: true, value: { ...entry.booking } };
    if (nowOf(request.now) + nonNegative(config.changeMinLeadMinutes) * MINUTE_MS > entry.startMs) {
      return fail("too_late_to_change");
    }
    entry.booking = { ...entry.booking, status: "cancelled" };
    return { ok: true, value: { ...entry.booking } };
  }

  function reschedule(request: Parameters<CalendarProvider["reschedule"]>[0]): Result<Booking> {
    if (!config.allowReschedule) return fail("not_allowed");
    const key = typeof request.idempotencyKey === "string" ? request.idempotencyKey : "";
    const newStartMs = typeof request.newStart === "string" ? parseIsoInstant(request.newStart) : null;
    if (key === "" || newStartMs === null) return fail("invalid");
    const entry = findEntry(request.ref, request.name);
    if (entry === null || entry.booking.status !== "confirmed") return fail("not_found");

    const fingerprint = JSON.stringify([entry.booking.ref, newStartMs]);
    const prior = moveKeys.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return fail("invalid");
      if (entry.startMs === newStartMs) return { ok: true, value: { ...entry.booking } };
      moveKeys.delete(key);
    }
    if (entry.startMs === newStartMs) {
      rememberKey(moveKeys, key, { fingerprint, ref: entry.booking.ref });
      return { ok: true, value: { ...entry.booking } };
    }

    const nowMs = nowOf(request.now);
    if (nowMs + nonNegative(config.changeMinLeadMinutes) * MINUTE_MS > entry.startMs) return fail("too_late_to_change");
    const service = serviceById(entry.booking.serviceId);
    if (service === null) return fail("invalid");
    // The booking itself does not block its new time; on any failure the old slot stays untouched.
    const code = evaluate(service, newStartMs, entry.seats, nowMs, entry.booking.ref);
    if (code !== null) return fail(code);

    const span = spanFor(service, newStartMs);
    Object.assign(entry, span);
    entry.booking = {
      ...entry.booking,
      start: toZonedIso(new Date(span.startMs), timezone),
      end: toZonedIso(new Date(span.endMs), timezone),
    };
    rememberKey(moveKeys, key, { fingerprint, ref: entry.booking.ref });
    return { ok: true, value: { ...entry.booking } };
  }

  return {
    async findSlots(query) {
      return settle(() => findSlots(query));
    },
    async book(request) {
      return settle(() => book(request));
    },
    async cancel(request) {
      return settle(() => cancel(request));
    },
    async reschedule(request) {
      return settle(() => reschedule(request));
    },
  };
}

/** Runs a calendar operation; a bug or bad data surfaces as "unavailable", never as an exception. */
function settle<T>(operation: () => Result<T>): Result<T> {
  try {
    return operation();
  } catch {
    return fail("unavailable");
  }
}

// ---------------------------------------------------------------------------------------------
// References and names
// ---------------------------------------------------------------------------------------------

/**
 * A booking reference as stored ("MV-7K2Q"), from what a caller or the model wrote: any case,
 * spaces or dashes, with or without the "MV" prefix. null when it cannot be a reference.
 */
export function normalizeBookingRef(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  let code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.startsWith("MV") && code.length > REF_LENGTH) code = code.slice(2);
  if (code.length < REF_LENGTH || code.length > REF_LENGTH * 2) return null;
  return `${REF_PREFIX}${code}`;
}

/**
 * The form two names are compared in: no case, no accents, "ss" for "ß", punctuation as spaces,
 * words in any order. "Muster Hans" matches "Hans Muster" (Swiss forms put the surname first),
 * "Mueller-Weiss" does not match "Müller Weiss" (that would need transliteration rules) but
 * "Muller Weiss" does: speech recognisers often drop the accents.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .sort()
    .join(" ");
}

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
  else for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  // 256 is a multiple of 32: masking keeps every symbol equally likely.
  return Array.from(bytes, (byte) => REF_ALPHABET[byte & 31]).join("");
}

function seededCode(seed: string, counter: number): string {
  const hash = hash32(`${seed}#${counter}`);
  let code = "";
  for (let index = 0; index < REF_LENGTH; index += 1) code += REF_ALPHABET[(hash >>> (index * 5)) & 31];
  return code;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** FNV-1a with the murmur3 finalizer: FNV alone mixes the low bits of short, similar strings poorly. */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function inPartOfDay(minutes: number, partOfDay: "morning" | "afternoon" | "evening" | undefined): boolean {
  if (partOfDay === "morning") return minutes < NOON;
  if (partOfDay === "afternoon") return minutes >= NOON && minutes < EVENING;
  if (partOfDay === "evening") return minutes >= EVENING;
  return true;
}

function intersect(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const [aFrom, aTo] of a) {
    for (const [bFrom, bTo] of b) {
      const from = Math.max(aFrom, bFrom);
      const to = Math.min(aTo, bTo);
      if (from < to) result.push([from, to]);
    }
  }
  return result.sort((x, y) => x[0] - y[0]);
}

/** Trimmed single-line text without control characters, at most `max` characters. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/[\p{Cc}​-‏‪-‮⁠-⁤⁦-⁩﻿]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
