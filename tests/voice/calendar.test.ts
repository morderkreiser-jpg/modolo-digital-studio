// The built-in memory calendar (lib/voice/calendar): slots, bookings, buffers, seats, lead time,
// the clock change, cancel / reschedule rules, idempotency, the busy seed, and getCalendar().
// Time is injected (`now`), never waited for. All businesses here are fictional.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Booking, BusinessHours, CalendarConfig, CalendarProvider, Slot, TimeRange, VoiceTenantConfig } from "@/lib/voice/types";
import {
  createMemoryCalendar,
  getCalendar,
  nameKey,
  normalizeBookingRef,
  resetCalendarsForTests,
} from "@/lib/voice/calendar";

const ZURICH = "Europe/Zurich";
const WORKDAY: TimeRange[] = [
  { from: "08:00", to: "12:00" },
  { from: "13:00", to: "18:00" },
];
const HOURS: BusinessHours = {
  timezone: ZURICH,
  weekly: { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: [{ from: "09:00", to: "13:00" }], sun: [] },
  holidays: [{ date: "2026-12-25" }, { date: "2026-12-08" }],
  exceptions: [{ date: "2026-12-08", ranges: [{ from: "10:00", to: "12:00" }] }],
};

const SALON: CalendarConfig = {
  provider: "memory",
  services: [
    { id: "cut", label: { en: "Haircut" }, durationMinutes: 30 },
    { id: "color", label: { en: "Colouring" }, durationMinutes: 60, bufferAfterMinutes: 15 },
    { id: "consult", label: { en: "Consultation" }, durationMinutes: 30, bufferBeforeMinutes: 15 },
  ],
  capacity: { kind: "single" },
  slotStepMinutes: 15,
  minLeadMinutes: 60,
  maxDaysAhead: 30,
  allowCancel: true,
  allowReschedule: true,
  changeMinLeadMinutes: 24 * 60,
};

/** Tuesday 1 December 2026, 09:00 in Zurich. */
const NOW = new Date("2026-12-01T08:00:00Z");
const ISO_REF = /^MV-[2-9A-HJ-NP-Z]{4}$/;

let keyCounter = 0;
const nextKey = (): string => `key-${++keyCounter}`;

function startsOf(slots: Slot[]): string[] {
  return slots.map((slot) => slot.start);
}

async function slots(calendar: CalendarProvider, date: string, serviceId = "cut", extra: Partial<Parameters<CalendarProvider["findSlots"]>[0]> = {}): Promise<string[]> {
  const result = await calendar.findSlots({ serviceId, date, now: NOW, ...extra });
  assert.ok(result.ok, `findSlots failed: ${result.ok ? "" : result.code}`);
  return startsOf(result.value);
}

async function book(
  calendar: CalendarProvider,
  start: string,
  overrides: Partial<Parameters<CalendarProvider["book"]>[0]> = {},
): Promise<Booking> {
  const result = await calendar.book({
    serviceId: "cut",
    start,
    name: "Anna Muster",
    contact: "+41791234567",
    idempotencyKey: nextKey(),
    now: NOW,
    ...overrides,
  });
  assert.ok(result.ok, `book failed: ${result.ok ? "" : result.code}`);
  return result.value;
}

describe("findSlots", () => {
  it("lists grid start times that fit inside one range", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const starts = await slots(calendar, "2026-12-03");
    assert.equal(starts[0], "2026-12-03T08:00:00+01:00");
    assert.ok(starts.includes("2026-12-03T11:30:00+01:00"));
    assert.ok(!starts.includes("2026-12-03T11:45:00+01:00"), "a 30-minute cut at 11:45 would run into the lunch break");
    assert.ok(!starts.some((start) => start.includes("T12:")));
    assert.equal(starts.at(-1), "2026-12-03T17:30:00+01:00");
    assert.equal(starts.length, 15 + 19);
    const result = await calendar.findSlots({ serviceId: "cut", date: "2026-12-03", now: NOW });
    assert.ok(result.ok);
    assert.deepEqual(result.value[0], { serviceId: "cut", start: "2026-12-03T08:00:00+01:00", end: "2026-12-03T08:30:00+01:00" });
  });

  it("filters by part of day", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const morning = await slots(calendar, "2026-12-03", "cut", { partOfDay: "morning" });
    const afternoon = await slots(calendar, "2026-12-03", "cut", { partOfDay: "afternoon" });
    const evening = await slots(calendar, "2026-12-03", "cut", { partOfDay: "evening" });
    assert.ok(morning.every((start) => start < "2026-12-03T12:00"));
    assert.equal(afternoon[0], "2026-12-03T13:00:00+01:00");
    assert.equal(afternoon.at(-1), "2026-12-03T16:45:00+01:00");
    assert.deepEqual(evening, ["2026-12-03T17:00:00+01:00", "2026-12-03T17:15:00+01:00", "2026-12-03T17:30:00+01:00"]);
    assert.equal(morning.length + afternoon.length + evening.length, 34);
  });

  it("respects the lead time and the booking horizon", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const today = await slots(calendar, "2026-12-01");
    assert.equal(today[0], "2026-12-01T10:00:00+01:00", "09:00 now plus 60 minutes lead");
    assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "2026-11-30", now: NOW }), { ok: false, code: "too_soon" });
    assert.ok((await calendar.findSlots({ serviceId: "cut", date: "2026-12-31", now: NOW })).ok, "30 days ahead");
    assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "2027-01-01", now: NOW }), { ok: false, code: "too_far" });
    const tooSoon = await calendar.book({ serviceId: "cut", start: "2026-12-01T09:45:00+01:00", name: "A B", contact: "x", idempotencyKey: nextKey(), now: NOW });
    assert.deepEqual(tooSoon, { ok: false, code: "too_soon" });
  });

  it("knows closed days, holidays and exception hours", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "2026-12-06", now: NOW }), { ok: false, code: "outside_hours" });
    assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "2026-12-25", now: NOW }), { ok: false, code: "outside_hours" });
    const exceptionDay = await slots(calendar, "2026-12-08");
    assert.equal(exceptionDay[0], "2026-12-08T10:00:00+01:00");
    assert.equal(exceptionDay.at(-1), "2026-12-08T11:30:00+01:00");
  });

  it("uses `bookable` instead of the opening hours, but never on a holiday", async () => {
    const calendar = createMemoryCalendar(
      { ...SALON, bookable: { ...HOURS.weekly, thu: [{ from: "14:00", to: "16:00" }], fri: [{ from: "08:00", to: "10:00" }] } },
      HOURS,
    );
    const thursday = await slots(calendar, "2026-12-03");
    assert.equal(thursday[0], "2026-12-03T14:00:00+01:00");
    assert.equal(thursday.at(-1), "2026-12-03T15:30:00+01:00");
    assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "2026-12-25", now: NOW }), { ok: false, code: "outside_hours" });
  });

  it("refuses unknown services, bad dates and bad parts of day", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    assert.deepEqual(await calendar.findSlots({ serviceId: "massage", date: "2026-12-03", now: NOW }), { ok: false, code: "invalid" });
    assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "03.12.2026", now: NOW }), { ok: false, code: "invalid" });
    const night = await calendar.findSlots({ serviceId: "cut", date: "2026-12-03", now: NOW, partOfDay: "night" as "evening" });
    assert.deepEqual(night, { ok: false, code: "invalid" });
  });
});

describe("book", () => {
  it("returns a confirmed booking with a short reference and removes the slot", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const booking = await book(calendar, "2026-12-03T14:30:00+01:00", { notes: "  first\u0000 visit  " });
    assert.match(booking.ref, ISO_REF);
    assert.equal(booking.start, "2026-12-03T14:30:00+01:00");
    assert.equal(booking.end, "2026-12-03T15:00:00+01:00");
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.notes, "first visit");
    assert.equal(booking.createdAt, "2026-12-01T09:00:00+01:00");
    assert.equal(booking.partySize, undefined);
    const starts = await slots(calendar, "2026-12-03");
    assert.ok(!starts.includes("2026-12-03T14:30:00+01:00"));
    assert.ok(!starts.includes("2026-12-03T14:15:00+01:00"), "14:15-14:45 overlaps");
    assert.ok(starts.includes("2026-12-03T14:00:00+01:00"));
    assert.ok(starts.includes("2026-12-03T15:00:00+01:00"));
  });

  it("accepts the same instant written with another offset", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const booking = await book(calendar, "2026-12-03T13:30:00Z");
    assert.equal(booking.start, "2026-12-03T14:30:00+01:00");
  });

  it("never double-books under two simultaneous calls", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const request = { serviceId: "cut", start: "2026-12-03T10:00:00+01:00", contact: "+41791234567", now: NOW };
    const [first, second] = await Promise.all([
      calendar.book({ ...request, name: "Anna Muster", idempotencyKey: nextKey() }),
      calendar.book({ ...request, name: "Beat Keller", idempotencyKey: nextKey() }),
    ]);
    assert.equal([first, second].filter((result) => result.ok).length, 1);
    assert.deepEqual(second, { ok: false, code: "conflict" });
  });

  it("is idempotent on the key", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const request = { serviceId: "cut", start: "2026-12-03T10:00:00+01:00", name: "Anna Muster", contact: "+41791234567", idempotencyKey: "same", now: NOW };
    const [first, again] = await Promise.all([calendar.book(request), calendar.book(request)]);
    assert.ok(first.ok && again.ok);
    assert.deepEqual(again.value, first.value);
    const third = await calendar.book({ ...request, idempotencyKey: "other" });
    assert.deepEqual(third, { ok: false, code: "conflict" }, "only one booking exists");
    // The same key for a different request is refused, not silently answered with the first booking.
    assert.deepEqual(await calendar.book({ ...request, start: "2026-12-03T11:00:00+01:00" }), { ok: false, code: "invalid" });
  });

  it("lets a key book again once its booking was cancelled", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const request = { serviceId: "cut", start: "2026-12-04T10:00:00+01:00", name: "Anna Muster", contact: "+41791234567", idempotencyKey: "rebook", now: NOW };
    const first = await calendar.book(request);
    assert.ok(first.ok);
    assert.ok((await calendar.cancel({ ref: first.value.ref, name: "Anna Muster", now: NOW })).ok);
    const second = await calendar.book(request);
    assert.ok(second.ok);
    assert.notEqual(second.value.ref, first.value.ref);
    assert.equal(second.value.status, "confirmed");
  });

  it("refuses off-grid starts, times outside the hours and incomplete requests", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const base = { serviceId: "cut", name: "Anna Muster", contact: "+41791234567", now: NOW };
    assert.deepEqual(await calendar.book({ ...base, start: "2026-12-03T10:10:00+01:00", idempotencyKey: nextKey() }), { ok: false, code: "invalid" });
    assert.deepEqual(await calendar.book({ ...base, start: "2026-12-03T12:15:00+01:00", idempotencyKey: nextKey() }), { ok: false, code: "outside_hours" });
    assert.deepEqual(await calendar.book({ ...base, start: "2026-12-03T10:00:00", idempotencyKey: nextKey() }), { ok: false, code: "invalid" });
    assert.deepEqual(await calendar.book({ ...base, start: "2026-12-03T10:00:00+01:00", name: "  ", idempotencyKey: nextKey() }), { ok: false, code: "invalid" });
    assert.deepEqual(await calendar.book({ ...base, start: "2026-12-03T10:00:00+01:00", idempotencyKey: "" }), { ok: false, code: "invalid" });
  });
});

describe("buffers", () => {
  it("blocks the buffer after an appointment", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    await book(calendar, "2026-12-03T08:00:00+01:00", { serviceId: "color" }); // 08:00-09:00, blocked until 09:15
    const starts = await slots(calendar, "2026-12-03");
    assert.ok(!starts.includes("2026-12-03T09:00:00+01:00"));
    assert.equal(starts[0], "2026-12-03T09:15:00+01:00");
  });

  it("keeps the buffers inside the bookable range", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const color = await slots(calendar, "2026-12-03", "color", { partOfDay: "morning" });
    assert.equal(color.at(-1), "2026-12-03T10:45:00+01:00", "10:45 + 60 + 15 = 12:00");
    const consult = await slots(calendar, "2026-12-03", "consult");
    assert.equal(consult[0], "2026-12-03T08:15:00+01:00", "15 minutes of preparation before");
  });

  it("does not place a booking inside another one's buffer", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    await book(calendar, "2026-12-03T10:00:00+01:00"); // cut 10:00-10:30
    const consult = await slots(calendar, "2026-12-03", "consult");
    assert.ok(!consult.includes("2026-12-03T10:30:00+01:00"), "its preparation would start at 10:15");
    assert.ok(consult.includes("2026-12-03T10:45:00+01:00"));
  });
});

describe("seats capacity", () => {
  const RESTAURANT_HOURS: BusinessHours = {
    timezone: ZURICH,
    weekly: { mon: [], tue: [{ from: "18:00", to: "23:00" }], wed: [{ from: "18:00", to: "23:00" }], thu: [{ from: "18:00", to: "23:00" }], fri: [{ from: "18:00", to: "23:00" }], sat: [{ from: "18:00", to: "23:00" }], sun: [] },
    holidays: [],
  };
  const RESTAURANT: CalendarConfig = {
    provider: "memory",
    services: [{ id: "table", label: { en: "Table" }, durationMinutes: 90 }],
    capacity: { kind: "seats", total: 10, maxPartySize: 6, turnMinutes: 90 },
    slotStepMinutes: 30,
    minLeadMinutes: 30,
    maxDaysAhead: 60,
    allowCancel: true,
    allowReschedule: true,
    changeMinLeadMinutes: 120,
  };
  const DAY = "2026-12-03";
  const table = (calendar: CalendarProvider, time: string, partySize: number) =>
    calendar.book({ serviceId: "table", start: `${DAY}T${time}:00+01:00`, name: "Gast", contact: "+41791234567", partySize, idempotencyKey: nextKey(), now: NOW });

  it("fills up to the total and no further", async () => {
    const calendar = createMemoryCalendar(RESTAURANT, RESTAURANT_HOURS);
    assert.ok((await table(calendar, "19:00", 6)).ok);
    assert.ok((await table(calendar, "19:00", 4)).ok);
    assert.deepEqual(await table(calendar, "19:00", 1), { ok: false, code: "conflict" });
    assert.deepEqual(await table(calendar, "20:00", 1), { ok: false, code: "conflict" }, "still seated until 20:30");
    const booked = await table(calendar, "20:30", 6);
    assert.ok(booked.ok, "the 19:00 tables are free again at 20:30");
    assert.equal(booked.value.partySize, 6);
  });

  it("counts the real peak, not every overlapping booking", async () => {
    const calendar = createMemoryCalendar(RESTAURANT, RESTAURANT_HOURS);
    assert.ok((await table(calendar, "18:00", 6)).ok); // seated 18:00-19:30
    assert.ok((await table(calendar, "19:30", 4)).ok); // seated 19:30-21:00
    // 19:00-20:30 meets 6 people until 19:30 and 4 after: 2 more fit at every moment.
    assert.ok((await table(calendar, "19:00", 2)).ok);
    const offered = await slots(calendar, DAY, "table", { partySize: 3 });
    assert.ok(!offered.includes(`${DAY}T19:00:00+01:00`), "6 + 2 + 3 = 11 at 19:00");
    assert.ok(offered.includes(`${DAY}T21:00:00+01:00`));
    assert.equal(offered.at(-1), `${DAY}T21:30:00+01:00`, "a 90-minute table must end by 23:00");
  });

  it("refuses parties above the maximum and nonsense sizes", async () => {
    const calendar = createMemoryCalendar(RESTAURANT, RESTAURANT_HOURS);
    assert.deepEqual(await table(calendar, "19:00", 7), { ok: false, code: "not_allowed" });
    assert.deepEqual(await table(calendar, "19:00", 0), { ok: false, code: "invalid" });
    assert.deepEqual(await calendar.findSlots({ serviceId: "table", date: DAY, partySize: 7, now: NOW }), { ok: false, code: "not_allowed" });
  });
});

describe("the clock change", () => {
  const ALWAYS: BusinessHours = {
    timezone: ZURICH,
    weekly: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [{ from: "00:00", to: "24:00" }]])) as BusinessHours["weekly"],
    holidays: [],
  };
  const HOURLY: CalendarConfig = {
    ...SALON,
    services: [{ id: "visit", label: { en: "Visit" }, durationMinutes: 60 }],
    slotStepMinutes: 60,
    minLeadMinutes: 0,
    maxDaysAhead: 400,
  };
  const before = new Date("2027-03-20T12:00:00Z");

  it("has 23 hourly slots on 28 March 2027 and switches offset at 03:00", async () => {
    const calendar = createMemoryCalendar(HOURLY, ALWAYS);
    const result = await calendar.findSlots({ serviceId: "visit", date: "2027-03-28", now: before });
    assert.ok(result.ok);
    assert.equal(result.value.length, 23);
    assert.ok(!result.value.some((slot) => slot.start.startsWith("2027-03-28T02:")));
    assert.deepEqual(result.value[1], { serviceId: "visit", start: "2027-03-28T01:00:00+01:00", end: "2027-03-28T03:00:00+02:00" });
    assert.equal(result.value[2].start, "2027-03-28T03:00:00+02:00");
    assert.equal(result.value.at(-1)?.end, "2027-03-29T00:00:00+02:00");
  });

  it("offers each wall-clock hour once on 31 October 2027, with real 60-minute ends", async () => {
    const calendar = createMemoryCalendar(HOURLY, ALWAYS);
    const result = await calendar.findSlots({ serviceId: "visit", date: "2027-10-31", now: before });
    assert.ok(result.ok);
    assert.equal(result.value.length, 24);
    assert.deepEqual(result.value[1], { serviceId: "visit", start: "2027-10-31T01:00:00+02:00", end: "2027-10-31T02:00:00+02:00" });
    assert.deepEqual(result.value[2], { serviceId: "visit", start: "2027-10-31T02:00:00+02:00", end: "2027-10-31T02:00:00+01:00" });
    assert.equal(result.value.at(-1)?.end, "2027-11-01T00:00:00+01:00");
  });

  it("books across the jump without overlap", async () => {
    const calendar = createMemoryCalendar(HOURLY, ALWAYS);
    const night = await book(calendar, "2027-03-28T01:00:00+01:00", { serviceId: "visit", now: before });
    assert.equal(night.end, "2027-03-28T03:00:00+02:00");
    const morning = await book(calendar, "2027-03-28T03:00:00+02:00", { serviceId: "visit", now: before });
    assert.equal(morning.start, "2027-03-28T03:00:00+02:00");
  });
});

describe("cancel", () => {
  it("needs the reference and the right name", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const booking = await book(calendar, "2026-12-04T10:00:00+01:00", { name: "Hans Müller" });
    assert.deepEqual(await calendar.cancel({ ref: booking.ref, name: "Hans Meier", now: NOW }), { ok: false, code: "not_found" });
    assert.deepEqual(await calendar.cancel({ ref: "MV-2222", name: "Hans Müller", now: NOW }), { ok: false, code: "not_found" });
    const cancelled = await calendar.cancel({ ref: booking.ref.toLowerCase().replace("-", " "), name: "  muller   HANS ", now: NOW });
    assert.ok(cancelled.ok);
    assert.equal(cancelled.value.status, "cancelled");
    assert.ok((await slots(calendar, "2026-12-04")).includes("2026-12-04T10:00:00+01:00"), "the slot is free again");
    const again = await calendar.cancel({ ref: booking.ref, name: "Hans Müller", now: NOW });
    assert.ok(again.ok && again.value.status === "cancelled", "cancelling twice is not an error");
  });

  it("honours allowCancel and the change lead time", async () => {
    const strict = createMemoryCalendar({ ...SALON, allowCancel: false }, HOURS);
    const kept = await book(strict, "2026-12-04T10:00:00+01:00");
    assert.deepEqual(await strict.cancel({ ref: kept.ref, name: "Anna Muster", now: NOW }), { ok: false, code: "not_allowed" });

    const calendar = createMemoryCalendar(SALON, HOURS);
    const soon = await book(calendar, "2026-12-02T08:30:00+01:00"); // in 23.5 hours
    assert.deepEqual(await calendar.cancel({ ref: soon.ref, name: "Anna Muster", now: NOW }), { ok: false, code: "too_late_to_change" });
  });
});

describe("reschedule", () => {
  it("moves the booking, keeps the reference and frees the old slot", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const booking = await book(calendar, "2026-12-04T10:00:00+01:00");
    const request = { ref: booking.ref, name: "Anna Muster", newStart: "2026-12-04T14:00:00+01:00", idempotencyKey: "move-1", now: NOW };
    const moved = await calendar.reschedule(request);
    assert.ok(moved.ok);
    assert.equal(moved.value.ref, booking.ref);
    assert.equal(moved.value.start, "2026-12-04T14:00:00+01:00");
    assert.equal(moved.value.end, "2026-12-04T14:30:00+01:00");
    const starts = await slots(calendar, "2026-12-04");
    assert.ok(starts.includes("2026-12-04T10:00:00+01:00"));
    assert.ok(!starts.includes("2026-12-04T14:00:00+01:00"));
    const repeated = await calendar.reschedule(request);
    assert.ok(repeated.ok);
    assert.deepEqual(repeated.value, moved.value);
  });

  it("keeps the old slot when the new one is taken", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const first = await book(calendar, "2026-12-04T10:00:00+01:00");
    await book(calendar, "2026-12-04T11:00:00+01:00", { name: "Beat Keller" });
    const failed = await calendar.reschedule({ ref: first.ref, name: "Anna Muster", newStart: "2026-12-04T11:00:00+01:00", idempotencyKey: nextKey(), now: NOW });
    assert.deepEqual(failed, { ok: false, code: "conflict" });
    assert.ok(!(await slots(calendar, "2026-12-04")).includes("2026-12-04T10:00:00+01:00"), "10:00 is still held");
    const cancelled = await calendar.cancel({ ref: first.ref, name: "Anna Muster", now: NOW });
    assert.ok(cancelled.ok);
    assert.equal(cancelled.value.start, "2026-12-04T10:00:00+01:00");
  });

  it("may overlap its own old time", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const booking = await book(calendar, "2026-12-04T10:00:00+01:00");
    const moved = await calendar.reschedule({ ref: booking.ref, name: "Anna Muster", newStart: "2026-12-04T10:15:00+01:00", idempotencyKey: nextKey(), now: NOW });
    assert.ok(moved.ok);
  });

  it("honours allowReschedule, names and the change lead time", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS);
    const booking = await book(calendar, "2026-12-04T10:00:00+01:00");
    const base = { ref: booking.ref, newStart: "2026-12-04T15:00:00+01:00", now: NOW };
    assert.deepEqual(await calendar.reschedule({ ...base, name: "Someone Else", idempotencyKey: nextKey() }), { ok: false, code: "not_found" });
    const fixed = createMemoryCalendar({ ...SALON, allowReschedule: false }, HOURS);
    const kept = await book(fixed, "2026-12-04T10:00:00+01:00");
    assert.deepEqual(
      await fixed.reschedule({ ref: kept.ref, name: "Anna Muster", newStart: base.newStart, idempotencyKey: nextKey(), now: NOW }),
      { ok: false, code: "not_allowed" },
    );
    const soon = await book(calendar, "2026-12-02T08:30:00+01:00");
    assert.deepEqual(
      await calendar.reschedule({ ref: soon.ref, name: "Anna Muster", newStart: base.newStart, idempotencyKey: nextKey(), now: NOW }),
      { ok: false, code: "too_late_to_change" },
    );
  });
});

describe("busy seed", () => {
  async function weekOfSlots(calendar: CalendarProvider): Promise<string[]> {
    const all: string[] = [];
    for (const date of ["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07", "2026-12-09", "2026-12-10"]) {
      all.push(...(await slots(calendar, date)));
    }
    return all;
  }

  it("takes about a third of the slots, the same ones every time", async () => {
    const free = await weekOfSlots(createMemoryCalendar(SALON, HOURS));
    const seeded = await weekOfSlots(createMemoryCalendar(SALON, HOURS, { busySeed: "demo-salon" }));
    const again = await weekOfSlots(createMemoryCalendar(SALON, HOURS, { busySeed: "demo-salon" }));
    const other = await weekOfSlots(createMemoryCalendar(SALON, HOURS, { busySeed: "demo-garage" }));
    assert.deepEqual(seeded, again);
    assert.notDeepEqual(seeded, other);
    const taken = 1 - seeded.length / free.length;
    assert.ok(taken > 0.2 && taken < 0.45, `share taken: ${taken}`);
    assert.ok(seeded.every((start) => free.includes(start)));
  });

  it("answers conflict when booking a pre-taken slot", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS, { busySeed: "demo-salon" });
    const free = new Set(await slots(calendar, "2026-12-03"));
    const all = await slots(createMemoryCalendar(SALON, HOURS), "2026-12-03");
    const taken = all.find((start) => !free.has(start));
    assert.ok(taken !== undefined);
    const result = await calendar.book({ serviceId: "cut", start: taken, name: "Anna Muster", contact: "x", idempotencyKey: nextKey(), now: NOW });
    assert.deepEqual(result, { ok: false, code: "conflict" });
  });
});

describe("references and names", () => {
  it("are deterministic with a seed and always in the safe alphabet", async () => {
    const a = createMemoryCalendar(SALON, HOURS, { refSeed: "t" });
    const b = createMemoryCalendar(SALON, HOURS, { refSeed: "t" });
    const refsA = [await book(a, "2026-12-03T08:00:00+01:00"), await book(a, "2026-12-03T09:00:00+01:00")].map((x) => x.ref);
    const refsB = [await book(b, "2026-12-03T08:00:00+01:00"), await book(b, "2026-12-03T09:00:00+01:00")].map((x) => x.ref);
    assert.deepEqual(refsA, refsB);
    assert.notEqual(refsA[0], refsA[1]);
    const random = createMemoryCalendar(SALON, HOURS);
    for (let hour = 8; hour < 12; hour += 1) {
      const booking = await book(random, `2026-12-07T${String(hour).padStart(2, "0")}:00:00+01:00`);
      assert.match(booking.ref, ISO_REF);
    }
  });

  it("normalise references and names", () => {
    assert.equal(normalizeBookingRef("mv 7k2q"), "MV-7K2Q");
    assert.equal(normalizeBookingRef("7K2Q"), "MV-7K2Q");
    assert.equal(normalizeBookingRef("MV-7K2Q"), "MV-7K2Q");
    assert.equal(normalizeBookingRef("x"), null);
    assert.equal(nameKey("  Müller-Weiss   Hans "), nameKey("hans muller weiss"));
    assert.equal(nameKey("Strauß"), nameKey("Strauss"));
    assert.notEqual(nameKey("Hans Müller"), nameKey("Hans Meier"));
  });
});

describe("getCalendar", () => {
  beforeEach(() => resetCalendarsForTests());

  function tenant(id: string, calendar: CalendarConfig | undefined, kind: "live" | "demo" = "live"): VoiceTenantConfig {
    return {
      id,
      kind,
      business: { name: "Test", sector: "hairdresser", locality: "Winterthur", description: { en: "A fictional test business." } },
      locales: ["de"],
      defaultLocale: "de",
      persona: { assistantName: { de: "Assistent" }, formality: { de: "formal" }, style: [] },
      greeting: { de: "Hier spricht der KI-Assistent." },
      hours: HOURS,
      answerPolicy: { always: false, afterHours: true, weekends: false, holidays: true, noAnswerAfterSeconds: null, whenBusy: false },
      handoff: {
        transfer: { enabled: false, targets: [], ringSeconds: 20 },
        callback: { enabled: false },
        written: { enabled: false },
        emergency: { triggers: [], message: {} },
      },
      tasks: [],
      tools: [],
      ...(calendar ? { calendar } : {}),
      rules: [],
      plan: "demo",
      privacy: { recordAudio: false, transcriptRetentionDays: 0, summaryRetentionDays: 30, noticeUrl: {} },
      allowedOrigins: [],
      knowledge: () => ({ version: "test", sections: [] }),
    };
  }

  it("is null without a calendar and one instance per tenant id", async () => {
    assert.equal(getCalendar(tenant("no-calendar", undefined)), null);
    const first = getCalendar(tenant("salon", SALON));
    assert.ok(first);
    assert.equal(getCalendar(tenant("salon", SALON)), first);
    assert.notEqual(getCalendar(tenant("other-salon", SALON)), first);
    await book(first, "2026-12-03T10:00:00+01:00");
    assert.ok(!(await slots(getCalendar(tenant("salon", SALON))!, "2026-12-03")).includes("2026-12-03T10:00:00+01:00"));
    resetCalendarsForTests();
    assert.notEqual(getCalendar(tenant("salon", SALON)), first);
  });

  it("pre-books demo calendars but not live ones", async () => {
    const live = await slots(getCalendar(tenant("salon-live", SALON))!, "2026-12-03");
    const demo = await slots(getCalendar(tenant("demo-salon", SALON, "demo"))!, "2026-12-03");
    assert.equal(live.length, 34);
    assert.ok(demo.length < live.length);
  });

  it("never pretends with a calendar that is not connected", async () => {
    for (const provider of ["google", "microsoft"] as const) {
      const calendar = getCalendar(tenant(`ext-${provider}`, { ...SALON, provider }));
      assert.ok(calendar);
      const unavailable = { ok: false, code: "unavailable" };
      assert.deepEqual(await calendar.findSlots({ serviceId: "cut", date: "2026-12-03", now: NOW }), unavailable);
      assert.deepEqual(
        await calendar.book({ serviceId: "cut", start: "2026-12-03T10:00:00+01:00", name: "A B", contact: "x", idempotencyKey: "k", now: NOW }),
        unavailable,
      );
      assert.deepEqual(await calendar.cancel({ ref: "MV-2222", name: "A B", now: NOW }), unavailable);
      assert.deepEqual(
        await calendar.reschedule({ ref: "MV-2222", name: "A B", newStart: "2026-12-03T10:00:00+01:00", idempotencyKey: "k", now: NOW }),
        unavailable,
      );
    }
  });
});

// Review finding correttezza/F13: past maxBookings the oldest bookings were dropped, confirmed
// future ones included, which freed their slots for a second guest.
describe("a full calendar", () => {
  it("never drops a confirmed future booking: it refuses the new one instead", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS, { maxBookings: 2, refSeed: "full" });
    await book(calendar, "2026-12-03T10:00:00+01:00");
    await book(calendar, "2026-12-03T11:00:00+01:00");
    const third = await calendar.book({ serviceId: "cut", start: "2026-12-03T14:00:00+01:00", name: "Beat Keller", contact: "+41791234568", idempotencyKey: nextKey(), now: NOW });
    assert.deepEqual(third, { ok: false, code: "unavailable" });
    // The first booking still holds its slot.
    assert.ok(!(await slots(calendar, "2026-12-03")).includes("2026-12-03T10:00:00+01:00"));
  });

  it("makes room by dropping cancelled bookings and bookings that are over, oldest first", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS, { maxBookings: 2, refSeed: "room" });
    const cancelled = await book(calendar, "2026-12-03T10:00:00+01:00");
    await book(calendar, "2026-12-03T11:00:00+01:00");
    assert.ok((await calendar.cancel({ ref: cancelled.ref, name: "Anna Muster", now: NOW })).ok);
    await book(calendar, "2026-12-03T14:00:00+01:00");
    // Later, the bookings of the 3rd are over: they make room for new ones.
    const later = new Date("2026-12-10T08:00:00Z");
    const next = await calendar.book({ serviceId: "cut", start: "2026-12-11T10:00:00+01:00", name: "Beat Keller", contact: "+41791234568", idempotencyKey: nextKey(), now: later });
    assert.ok(next.ok);
  });

  it("an old key whose booking was dropped never answers with another guest's booking", async () => {
    const calendar = createMemoryCalendar(SALON, HOURS, { maxBookings: 1, refSeed: "same-seed" });
    const key = nextKey();
    const first = await calendar.book({ serviceId: "cut", start: "2026-12-03T10:00:00+01:00", name: "Anna Muster", contact: "+41791234567", idempotencyKey: key, now: NOW });
    assert.ok(first.ok);
    // Over: dropped for the next booking, whose reference may be the same code again.
    const later = new Date("2026-12-04T08:00:00Z");
    const other = await calendar.book({ serviceId: "cut", start: "2026-12-07T10:00:00+01:00", name: "Beat Keller", contact: "+41791234568", idempotencyKey: nextKey(), now: later });
    assert.ok(other.ok);
    // A retry with the first key books anew (if it can) or fails; it never hands out Beat Keller's booking.
    const retry = await calendar.book({ serviceId: "cut", start: "2026-12-03T10:00:00+01:00", name: "Anna Muster", contact: "+41791234567", idempotencyKey: key, now: later });
    assert.ok(!retry.ok || retry.value.name === "Anna Muster");
    if (retry.ok) assert.notEqual(retry.value.ref, other.value.ref);
  });
});
