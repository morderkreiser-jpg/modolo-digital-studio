// Opening hours, holidays and the answer policy of a tenant, always in the tenant's own time zone.
//
// Pure functions without dependencies: safe on the client and on the server. Every conversion
// between an instant and a wall-clock time goes through Intl.DateTimeFormat with the tenant's IANA
// zone, so daylight-saving changes come from the platform's time zone data, never from a fixed
// offset. In Europe/Zurich:
//   - spring forward (last Sunday of March, 02:00 -> 03:00): local times 02:00-02:59 do not exist;
//   - fall back (last Sunday of October, 03:00 -> 02:00): local times 02:00-02:59 happen twice, and
//     where one instant must be picked it is the earlier one.
// Opening hours are compared as wall-clock minutes since local midnight (hours * 60 + minutes),
// which is what "open until 18:00" means, also on the two days a year that are not 24 hours long.
//
// Nothing here throws. Malformed ranges are skipped (validateHours lists them), an invalid Date
// reads as the Unix epoch, and an unknown time zone falls back to Europe/Zurich, the zone of every
// Swiss tenant: a wrong-but-plausible answer beats a crashed call, and tests validate every tenant.
import { WEEKDAYS } from "@/lib/voice/types";
import type { AnswerPolicy, BusinessHours, ClockTime, TimeRange, Weekday } from "@/lib/voice/types";

export const DEFAULT_TIMEZONE = "Europe/Zurich";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DAY_MINUTES = 24 * 60;
/** nextOpening gives up after this many days. */
const LOOKAHEAD_DAYS = 14;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------------------------
// Zone arithmetic
// ---------------------------------------------------------------------------------------------

// Building an Intl.DateTimeFormat costs far more than using one: one per zone, reused. Zones come
// from tenant configuration only, so the map stays tiny.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = createFormatter(timezone);
  } catch {
    formatter = timezone === DEFAULT_TIMEZONE ? createFormatter("UTC") : formatterFor(DEFAULT_TIMEZONE);
  }
  formatters.set(timezone, formatter);
  return formatter;
}

function createFormatter(timezone: string): Intl.DateTimeFormat {
  // en-US with numeric parts: digits only, no locale-specific month names. h23 so that midnight is
  // 0, not 24 (older engines still print 24; wallClock() corrects that too).
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
}

/** True when the runtime knows this IANA time zone. */
export function isValidTimeZone(timezone: unknown): boolean {
  if (typeof timezone !== "string" || timezone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(epochMs: number, timezone: string): Wall {
  const wall: Wall = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(timezone).formatToParts(epochMs)) {
    if (part.type === "year") wall.year = Number(part.value);
    else if (part.type === "month") wall.month = Number(part.value);
    else if (part.type === "day") wall.day = Number(part.value);
    else if (part.type === "hour") wall.hour = Number(part.value) % 24;
    else if (part.type === "minute") wall.minute = Number(part.value);
    else if (part.type === "second") wall.second = Number(part.value);
  }
  return wall;
}

/** The wall-clock reading as if it were UTC: lets plain arithmetic compare local times. */
function wallAsUtc(wall: Wall): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** UTC offset of the zone at this instant, in ms (Zurich: 3_600_000 in winter, 7_200_000 in summer). */
function offsetAt(epochMs: number, timezone: string): number {
  const second = Math.floor(epochMs / 1000) * 1000;
  return wallAsUtc(wallClock(second, timezone)) - second;
}

/**
 * The instant at which the wall clock of `timezone` reads `date` + `minutes` (0-1440; 1440 is the
 * next midnight). Of two such instants (autumn) the earlier one. For a time that does not exist
 * (spring gap) `gap` decides: "null" answers null, "next" answers the first instant whose wall
 * clock reads that time or later, i.e. the moment the clock jumps. null for a malformed date.
 */
export function wallTimeToEpoch(
  date: string,
  minutes: number,
  timezone: string,
  gap: "null" | "next" = "null",
): number | null {
  const parts = parseDate(date);
  if (parts === null || !Number.isInteger(minutes) || minutes < 0 || minutes > DAY_MINUTES) return null;
  const local = Date.UTC(parts.year, parts.month - 1, parts.day) + minutes * MINUTE_MS;

  // The offsets a day either side cover any single transition near this wall time (zones change
  // at most twice a year, never twice within two days).
  const before = offsetAt(local - DAY_MS, timezone);
  const after = offsetAt(local + DAY_MS, timezone);
  const candidates = before === after ? [local - before] : [local - before, local - after].sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (wallAsUtc(wallClock(candidate, timezone)) === local) return candidate;
  }
  if (gap === "null" || before === after) return null;

  // In the gap: the transition lies in (local - larger offset, local - smaller offset]. Binary
  // search to the minute; transitions happen on whole minutes.
  let lo = local - Math.max(before, after);
  let hi = local - Math.min(before, after);
  const target = offsetAt(hi, timezone);
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.max(MINUTE_MS, Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS);
    if (mid >= hi) break;
    if (offsetAt(mid, timezone) === target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Local calendar date, weekday and wall-clock minutes since local midnight of an instant. */
export function zonedParts(at: Date, timezone: string): { date: string; weekday: Weekday; minutes: number } {
  const ms = at.getTime();
  const wall = wallClock(Number.isFinite(ms) ? ms : 0, timezone);
  const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
  return { date, weekday: weekdayOf(date) ?? "mon", minutes: wall.hour * 60 + wall.minute };
}

/**
 * An instant as ISO 8601 with the zone's offset at that instant, to the second:
 * "2026-12-03T14:30:00+01:00". "" for an invalid Date.
 */
export function toZonedIso(at: Date, timezone: string): string {
  const ms = at.getTime();
  if (!Number.isFinite(ms)) return "";
  const second = Math.floor(ms / 1000) * 1000;
  const wall = wallAsUtc(wallClock(second, timezone));
  const offsetMinutes = Math.round((wall - second) / MINUTE_MS);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${new Date(wall).toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * A local date and time as ISO 8601 with the offset in force then. null for a malformed input and
 * for a local time that does not exist (spring gap); the earlier instant for an ambiguous one
 * (autumn). "24:00" is the next midnight.
 */
export function zonedTimeToIso(date: string, time: ClockTime, timezone: string): string | null {
  const minutes = parseClockTime(time, true);
  if (minutes === null) return null;
  const epoch = wallTimeToEpoch(date, minutes, timezone, "null");
  return epoch === null ? null : toZonedIso(new Date(epoch), timezone);
}

/**
 * Epoch ms of a strict ISO 8601 date-time WITH an offset ("Z" or "+01:00"). null for anything
 * else: a time without an offset is ambiguous, and Date.parse would guess.
 */
export function parseIsoInstant(value: string): number | null {
  const match = ISO_PATTERN.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  if (parseDate(`${y}-${mo}-${d}`) === null) return null;
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMins = Number(zone.slice(4, 6));
    if (offsetHours > 14 || offsetMins > 59) return null;
    offsetMinutes = (zone[0] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMins);
  }
  const millis = fraction === undefined ? 0 : Math.floor(Number(`0.${fraction}`) * 1000);
  return (
    Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, minute, second, millis) - offsetMinutes * MINUTE_MS
  );
}

// ---------------------------------------------------------------------------------------------
// Dates and clock times
// ---------------------------------------------------------------------------------------------

function parseDate(date: string): { year: number; month: number; day: number } | null {
  if (typeof date !== "string") return null;
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round trip through Date.UTC rejects 2026-02-30 and friends.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isValidDate(date: unknown): date is string {
  return typeof date === "string" && parseDate(date) !== null;
}

/** "HH:MM" as minutes since midnight; "24:00" (1440) only when `allowEndOfDay`. null otherwise. */
export function parseClockTime(time: unknown, allowEndOfDay = false): number | null {
  if (typeof time !== "string") return null;
  const match = CLOCK_PATTERN.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return allowEndOfDay ? DAY_MINUTES : null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight as "HH:MM" (1440 -> "24:00"). */
export function formatClockTime(minutes: number): ClockTime {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Weekday of a YYYY-MM-DD date, or null for a malformed one. */
export function weekdayOf(date: string): Weekday | null {
  const parts = parseDate(date);
  if (parts === null) return null;
  const sundayFirst = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return WEEKDAYS[(sundayFirst + 6) % 7];
}

/** The date `days` calendar days after (or before) `date`. "" for a malformed date. */
export function addDays(date: string, days: number): string {
  const parts = parseDate(date);
  if (parts === null || !Number.isFinite(days)) return "";
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Math.trunc(days))).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). NaN for a malformed date. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null) return Number.NaN;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** Valid ranges as [from, to] minutes, sorted by start. Malformed or empty ranges are dropped. */
export function toMinuteRanges(ranges: readonly TimeRange[] | undefined): Array<[number, number]> {
  if (!Array.isArray(ranges)) return [];
  const result: Array<[number, number]> = [];
  for (const range of ranges) {
    const from = parseClockTime(range?.from);
    const to = parseClockTime(range?.to, true);
    if (from !== null && to !== null && from < to) result.push([from, to]);
  }
  return result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ---------------------------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------------------------

/**
 * True when `date` is one of the tenant's holidays and no exception overrides it: an exception
 * for a holiday (a shop that opens on 8 December) wins.
 */
export function isHoliday(hours: BusinessHours, date: string): boolean {
  if (hours.exceptions?.some((exception) => exception.date === date)) return false;
  return Array.isArray(hours.holidays) && hours.holidays.some((holiday) => holiday.date === date);
}

/** The opening ranges of one local date: the exception if any, else closed on a holiday, else the week. */
export function openingRangesOn(hours: BusinessHours, date: string): TimeRange[] {
  const exception = hours.exceptions?.find((candidate) => candidate.date === date);
  if (exception) return Array.isArray(exception.ranges) ? exception.ranges : [];
  if (isHoliday(hours, date)) return [];
  const weekday = weekdayOf(date);
  if (weekday === null) return [];
  const ranges = hours.weekly?.[weekday];
  return Array.isArray(ranges) ? ranges : [];
}

/** Open at this instant? Exceptions win over holidays, holidays over the weekly schedule. */
export function isOpenAt(hours: BusinessHours, at: Date): boolean {
  const { date, minutes } = zonedParts(at, hours.timezone);
  return toMinuteRanges(openingRangesOn(hours, date)).some(([from, to]) => from <= minutes && minutes < to);
}

/**
 * The earliest instant at or after `from` at which the business is open (`from` itself when it is
 * open already), or null when nothing opens within 14 days.
 */
export function nextOpening(hours: BusinessHours, from: Date): Date | null {
  const fromMs = from.getTime();
  if (!Number.isFinite(fromMs)) return null;
  const limit = fromMs + LOOKAHEAD_DAYS * DAY_MS;
  const today = zonedParts(from, hours.timezone).date;
  for (let day = 0; day <= LOOKAHEAD_DAYS; day += 1) {
    const date = addDays(today, day);
    for (const [start, end] of toMinuteRanges(openingRangesOn(hours, date))) {
      // "next": a range that starts inside the spring gap opens when the clock jumps.
      const startMs = wallTimeToEpoch(date, start, hours.timezone, "next");
      const endMs = wallTimeToEpoch(date, end, hours.timezone, "next");
      if (startMs === null || endMs === null || endMs <= startMs || endMs <= fromMs) continue;
      const opensAt = Math.max(startMs, fromMs);
      return opensAt > limit ? null : new Date(opensAt);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Answer policy
// ---------------------------------------------------------------------------------------------

export type AnswerReason = "always" | "after_hours" | "weekend" | "holiday" | "busy" | "no_answer" | "human_first";

/**
 * Whether the AI answers a phone call arriving at `at`, and why. The most specific reason wins:
 * always, then holiday, weekend, after hours; while open, a busy line or a call nobody picked up.
 * `line` is the state of the business's own line when the call reached us ("free" = it was
 * forwarded for another reason, e.g. unconditional forwarding). Following the AnswerPolicy
 * contract, busy and no-answer forwarding only count while the business is open: after hours
 * only `afterHours` lets the AI answer.
 */
export function decideAnswer(
  policy: AnswerPolicy,
  hours: BusinessHours,
  at: Date,
  line: "free" | "busy" | "unanswered",
): { aiAnswers: boolean; reason: AnswerReason } {
  if (policy.always) return { aiAnswers: true, reason: "always" };
  const { date, weekday } = zonedParts(at, hours.timezone);
  if (policy.holidays && isHoliday(hours, date)) return { aiAnswers: true, reason: "holiday" };
  if (policy.weekends && (weekday === "sat" || weekday === "sun")) return { aiAnswers: true, reason: "weekend" };
  const open = isOpenAt(hours, at);
  if (policy.afterHours && !open) return { aiAnswers: true, reason: "after_hours" };
  if (open && line === "busy" && policy.whenBusy) return { aiAnswers: true, reason: "busy" };
  if (open && line === "unanswered" && policy.noAnswerAfterSeconds !== null) {
    return { aiAnswers: true, reason: "no_answer" };
  }
  return { aiAnswers: false, reason: "human_first" };
}

export interface ForwardingStep {
  type: "unconditional" | "time_based" | "no_reply" | "busy";
  seconds?: number;
  note: string;
}

/**
 * The call forwardings the customer has to set up at the phone company so that calls reach the
 * assistant exactly when the policy says. Empty when the AI never answers phone calls. The notes
 * are setup instructions for the person configuring the line (English, like the admin texts).
 */
export function forwardingPlan(policy: AnswerPolicy): ForwardingStep[] {
  if (policy.always) {
    return [{ type: "unconditional", note: "Forward every call to the assistant's number, at all times." }];
  }
  const plan: ForwardingStep[] = [];
  const windows: string[] = [];
  if (policy.afterHours) windows.push("outside the opening hours");
  if (policy.weekends) windows.push("on Saturdays and Sundays");
  if (policy.holidays) windows.push("on the business's holidays");
  if (windows.length > 0) {
    let note =
      `Forward every call to the assistant's number ${joinList(windows)}. ` +
      "If the line has no time-based forwarding, switch unconditional forwarding on and off by hand at these times.";
    if (policy.holidays) note += " Holidays are single dates: add them to the schedule or switch forwarding on by hand.";
    plan.push({ type: "time_based", note });
  }
  if (policy.noAnswerAfterSeconds !== null && Number.isFinite(policy.noAnswerAfterSeconds)) {
    const seconds = Math.max(0, Math.round(policy.noAnswerAfterSeconds));
    plan.push({
      type: "no_reply",
      seconds,
      note: `Forward calls nobody answers within ${seconds} seconds to the assistant's number.`,
    });
  }
  if (policy.whenBusy) {
    plan.push({ type: "busy", note: "Forward calls to the assistant's number while the line is busy." });
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Validation (for tenant tests and the setup tools)
// ---------------------------------------------------------------------------------------------

/** Human-readable problems of a BusinessHours value; empty when it is fine. */
export function validateHours(hours: BusinessHours): string[] {
  const problems: string[] = [];
  if (!isValidTimeZone(hours?.timezone)) problems.push(`Unknown time zone "${String(hours?.timezone)}".`);

  for (const day of WEEKDAYS) {
    const ranges = hours?.weekly?.[day];
    if (!Array.isArray(ranges)) problems.push(`weekly.${day} is missing (use [] for a closed day).`);
    else checkRanges(`weekly.${day}`, ranges, problems);
  }

  if (!Array.isArray(hours?.holidays)) {
    problems.push("holidays is missing (use [] for none).");
  } else {
    hours.holidays.forEach((holiday, index) => {
      if (!isValidDate(holiday?.date)) {
        problems.push(`holidays[${index}]: "${String(holiday?.date)}" is not a date (YYYY-MM-DD).`);
      }
    });
  }

  const seen = new Set<string>();
  (hours?.exceptions ?? []).forEach((exception, index) => {
    const where = `exceptions[${index}]`;
    if (!isValidDate(exception?.date)) {
      problems.push(`${where}: "${String(exception?.date)}" is not a date (YYYY-MM-DD).`);
    } else if (seen.has(exception.date)) {
      problems.push(`${where}: ${exception.date} has more than one exception.`);
    } else {
      seen.add(exception.date);
    }
    if (!Array.isArray(exception?.ranges)) problems.push(`${where}.ranges is missing (use [] for closed).`);
    else checkRanges(`${where} (${String(exception.date)})`, exception.ranges, problems);
  });
  return problems;
}

function checkRanges(where: string, ranges: readonly TimeRange[], problems: string[]): void {
  const valid: Array<{ from: number; to: number; text: string }> = [];
  ranges.forEach((range, index) => {
    const from = parseClockTime(range?.from);
    const to = parseClockTime(range?.to, true);
    const text = `${String(range?.from)}-${String(range?.to)}`;
    if (from === null) problems.push(`${where}[${index}]: start "${String(range?.from)}" is not a time (HH:MM, 00:00-23:59).`);
    if (to === null) problems.push(`${where}[${index}]: end "${String(range?.to)}" is not a time (HH:MM, up to 24:00).`);
    if (from === null || to === null) return;
    if (from >= to) {
      problems.push(`${where}[${index}]: ${text} does not end after it starts (split ranges that cross midnight).`);
      return;
    }
    valid.push({ from, to, text });
  });
  valid.sort((a, b) => a.from - b.from);
  for (let index = 1; index < valid.length; index += 1) {
    if (valid[index - 1].to > valid[index].from) {
      problems.push(`${where}: ${valid[index - 1].text} overlaps ${valid[index].text}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
