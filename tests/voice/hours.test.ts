// Opening hours, holidays and the answer policy (lib/voice/hours.ts), including the two Swiss clock
// changes of 2027: Sunday 28 March (02:00 -> 03:00) and Sunday 31 October (03:00 -> 02:00).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnswerPolicy, BusinessHours, TimeRange } from "@/lib/voice/types";
import {
  addDays,
  daysBetween,
  decideAnswer,
  forwardingPlan,
  isHoliday,
  isOpenAt,
  isValidTimeZone,
  nextOpening,
  parseIsoInstant,
  toZonedIso,
  validateHours,
  wallTimeToEpoch,
  zonedParts,
  zonedTimeToIso,
} from "@/lib/voice/hours";

const ZURICH = "Europe/Zurich";
const WORKDAY: TimeRange[] = [
  { from: "08:00", to: "12:00" },
  { from: "13:30", to: "18:00" },
];

// A fictional shop. 2026-12-08 (a Tuesday) is a holiday, but an exception opens it 10:00-16:00.
const HOURS: BusinessHours = {
  timezone: ZURICH,
  weekly: {
    mon: WORKDAY,
    tue: WORKDAY,
    wed: WORKDAY,
    thu: WORKDAY,
    fri: WORKDAY,
    sat: [{ from: "09:00", to: "13:00" }],
    sun: [],
  },
  holidays: [{ date: "2026-12-08" }, { date: "2026-12-25" }, { date: "2026-12-26" }],
  exceptions: [
    { date: "2026-12-08", ranges: [{ from: "10:00", to: "16:00" }] },
    { date: "2026-12-24", ranges: [{ from: "08:00", to: "12:00" }] },
    { date: "2026-12-31", ranges: [] },
  ],
};

const POLICY_OFF: AnswerPolicy = {
  always: false,
  afterHours: false,
  weekends: false,
  holidays: false,
  noAnswerAfterSeconds: null,
  whenBusy: false,
};

const at = (iso: string): Date => new Date(iso);
const iso = (date: Date | null): string | null => (date === null ? null : toZonedIso(date, ZURICH));

describe("zonedParts and zonedTimeToIso", () => {
  it("reads local date, weekday and minutes in winter and summer", () => {
    assert.deepEqual(zonedParts(at("2026-12-03T13:30:00Z"), ZURICH), { date: "2026-12-03", weekday: "thu", minutes: 14 * 60 + 30 });
    assert.deepEqual(zonedParts(at("2026-07-01T12:00:00Z"), ZURICH), { date: "2026-07-01", weekday: "wed", minutes: 14 * 60 });
    // Past local midnight while it is still the previous day in UTC.
    assert.deepEqual(zonedParts(at("2026-12-03T23:30:00Z"), ZURICH), { date: "2026-12-04", weekday: "fri", minutes: 30 });
  });

  it("writes ISO 8601 with the offset in force", () => {
    assert.equal(zonedTimeToIso("2026-12-03", "14:30", ZURICH), "2026-12-03T14:30:00+01:00");
    assert.equal(zonedTimeToIso("2026-07-01", "14:30", ZURICH), "2026-07-01T14:30:00+02:00");
    assert.equal(zonedTimeToIso("2026-12-03", "24:00", ZURICH), "2026-12-04T00:00:00+01:00");
    assert.equal(zonedTimeToIso("2026-02-30", "10:00", ZURICH), null);
    assert.equal(zonedTimeToIso("2026-12-03", "25:00", ZURICH), null);
    assert.equal(zonedTimeToIso("2026-12-03", "9:00", ZURICH), null);
  });

  it("spring forward 28 March 2027: 02:00-02:59 does not exist", () => {
    assert.equal(zonedTimeToIso("2027-03-28", "01:59", ZURICH), "2027-03-28T01:59:00+01:00");
    for (const time of ["02:00", "02:30", "02:59"]) assert.equal(zonedTimeToIso("2027-03-28", time, ZURICH), null, time);
    assert.equal(zonedTimeToIso("2027-03-28", "03:00", ZURICH), "2027-03-28T03:00:00+02:00");
    // The clock jumps at 01:00 UTC.
    assert.equal(zonedParts(at("2027-03-28T00:59:00Z"), ZURICH).minutes, 1 * 60 + 59);
    assert.equal(zonedParts(at("2027-03-28T01:00:00Z"), ZURICH).minutes, 3 * 60);
    // "next": a time in the gap maps to the moment of the jump.
    assert.equal(wallTimeToEpoch("2027-03-28", 150, ZURICH, "next"), Date.UTC(2027, 2, 28, 1, 0));
    assert.equal(wallTimeToEpoch("2027-03-28", 150, ZURICH, "null"), null);
  });

  it("fall back 31 October 2027: 02:00-02:59 happens twice, the earlier one is chosen", () => {
    assert.equal(zonedTimeToIso("2027-10-31", "01:59", ZURICH), "2027-10-31T01:59:00+02:00");
    assert.equal(zonedTimeToIso("2027-10-31", "02:30", ZURICH), "2027-10-31T02:30:00+02:00");
    assert.equal(zonedTimeToIso("2027-10-31", "03:00", ZURICH), "2027-10-31T03:00:00+01:00");
    assert.equal(zonedParts(at("2027-10-31T00:30:00Z"), ZURICH).minutes, 150);
    assert.equal(zonedParts(at("2027-10-31T01:30:00Z"), ZURICH).minutes, 150);
    assert.equal(toZonedIso(at("2027-10-31T01:30:00Z"), ZURICH), "2027-10-31T02:30:00+01:00");
  });

  it("parses only ISO date-times that carry an offset", () => {
    assert.equal(parseIsoInstant("2026-12-03T14:30:00+01:00"), Date.UTC(2026, 11, 3, 13, 30));
    assert.equal(parseIsoInstant("2026-12-03T13:30Z"), Date.UTC(2026, 11, 3, 13, 30));
    assert.equal(parseIsoInstant("2026-12-03T14:30:00"), null);
    assert.equal(parseIsoInstant("2026-12-03"), null);
    assert.equal(parseIsoInstant("2026-02-30T10:00:00+01:00"), null);
    assert.equal(parseIsoInstant("next Tuesday"), null);
  });

  it("does date arithmetic on calendar days", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2027-03-27", 1), "2027-03-28");
    assert.equal(daysBetween("2026-12-01", "2026-12-31"), 30);
    assert.equal(daysBetween("2027-03-27", "2027-03-29"), 2);
  });

  it("recognises time zones", () => {
    assert.equal(isValidTimeZone(ZURICH), true);
    assert.equal(isValidTimeZone("Mars/Olympus"), false);
    assert.equal(isValidTimeZone(""), false);
    // An unknown zone falls back to Zurich instead of throwing.
    assert.deepEqual(zonedParts(at("2026-12-03T13:30:00Z"), "Mars/Olympus"), zonedParts(at("2026-12-03T13:30:00Z"), ZURICH));
  });
});

describe("isOpenAt", () => {
  it("follows the weekly ranges, start included, end excluded", () => {
    assert.equal(isOpenAt(HOURS, at("2026-12-03T09:00:00Z")), true); // Thu 10:00
    assert.equal(isOpenAt(HOURS, at("2026-12-03T11:30:00Z")), false); // Thu 12:30, lunch
    assert.equal(isOpenAt(HOURS, at("2026-12-03T16:59:00Z")), true); // Thu 17:59
    assert.equal(isOpenAt(HOURS, at("2026-12-03T17:00:00Z")), false); // Thu 18:00
    assert.equal(isOpenAt(HOURS, at("2026-12-03T06:59:00Z")), false); // Thu 07:59
  });

  it("is closed on a closed day and on a holiday", () => {
    assert.equal(isOpenAt(HOURS, at("2026-12-06T10:00:00Z")), false); // Sunday
    assert.equal(isOpenAt(HOURS, at("2026-12-25T09:00:00Z")), false); // Friday, holiday
    assert.equal(isHoliday(HOURS, "2026-12-25"), true);
  });

  it("lets an exception open a holiday and close a working day", () => {
    assert.equal(isHoliday(HOURS, "2026-12-08"), false);
    assert.equal(isOpenAt(HOURS, at("2026-12-08T14:00:00Z")), true); // 15:00 on the holiday
    assert.equal(isOpenAt(HOURS, at("2026-12-08T08:00:00Z")), false); // 09:00: the exception opens at 10:00
    assert.equal(isOpenAt(HOURS, at("2026-12-31T09:00:00Z")), false); // Thursday, closed by exception
    assert.equal(isOpenAt(HOURS, at("2026-12-24T12:00:00Z")), false); // 13:00, short day
  });

  it("handles a range ending at 24:00 and the next day starting at 00:00", () => {
    const night: BusinessHours = {
      ...HOURS,
      weekly: { ...HOURS.weekly, fri: [{ from: "18:00", to: "24:00" }], sat: [{ from: "00:00", to: "02:00" }] },
      holidays: [],
      exceptions: [],
    };
    assert.equal(isOpenAt(night, at("2026-12-04T22:59:00Z")), true); // Fri 23:59
    assert.equal(isOpenAt(night, at("2026-12-04T23:00:00Z")), true); // Sat 00:00
    assert.equal(isOpenAt(night, at("2026-12-05T00:59:00Z")), true); // Sat 01:59
    assert.equal(isOpenAt(night, at("2026-12-05T01:00:00Z")), false); // Sat 02:00
  });

  it("reads wall-clock time on the days of the clock change", () => {
    const sundayNight: BusinessHours = {
      ...HOURS,
      weekly: { ...HOURS.weekly, sun: [{ from: "01:00", to: "04:00" }] },
      holidays: [],
      exceptions: [],
    };
    assert.equal(isOpenAt(sundayNight, at("2027-03-28T00:59:00Z")), true); // 01:59 CET
    assert.equal(isOpenAt(sundayNight, at("2027-03-28T01:00:00Z")), true); // 03:00 CEST
    assert.equal(isOpenAt(sundayNight, at("2027-03-28T02:00:00Z")), false); // 04:00 CEST
    assert.equal(isOpenAt(sundayNight, at("2027-10-31T01:30:00Z")), true); // second 02:30 (CET)
    assert.equal(isOpenAt(sundayNight, at("2027-10-31T02:59:00Z")), true); // 03:59 CET
    assert.equal(isOpenAt(sundayNight, at("2027-10-31T03:00:00Z")), false); // 04:00 CET
  });
});

describe("nextOpening", () => {
  it("is the moment itself while open", () => {
    assert.equal(iso(nextOpening(HOURS, at("2026-12-03T09:00:00Z"))), "2026-12-03T10:00:00+01:00");
  });

  it("finds the end of the lunch break, the next week and the end of holidays", () => {
    assert.equal(iso(nextOpening(HOURS, at("2026-12-03T11:30:00Z"))), "2026-12-03T13:30:00+01:00");
    assert.equal(iso(nextOpening(HOURS, at("2026-12-05T13:00:00Z"))), "2026-12-07T08:00:00+01:00"); // Sat 14:00
    assert.equal(iso(nextOpening(HOURS, at("2026-12-07T17:30:00Z"))), "2026-12-08T10:00:00+01:00"); // exception day
    // Thu 24 Dec 13:00 -> 25 and 26 are holidays, 27 is Sunday -> Monday 28 at 08:00.
    assert.equal(iso(nextOpening(HOURS, at("2026-12-24T12:00:00Z"))), "2026-12-28T08:00:00+01:00");
  });

  it("opens at the jump when the opening time falls in the spring gap", () => {
    const early: BusinessHours = {
      ...HOURS,
      weekly: { ...HOURS.weekly, sun: [{ from: "02:30", to: "05:00" }] },
      holidays: [],
      exceptions: [],
    };
    assert.equal(iso(nextOpening(early, at("2027-03-27T22:00:00Z"))), "2027-03-28T03:00:00+02:00");
  });

  it("gives up after 14 days", () => {
    const closed: BusinessHours = {
      timezone: ZURICH,
      weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      holidays: [],
    };
    assert.equal(nextOpening(closed, at("2026-12-03T09:00:00Z")), null);
    const longBreak: BusinessHours = {
      ...HOURS,
      exceptions: Array.from({ length: 20 }, (_, day) => ({ date: addDays("2026-12-01", day), ranges: [] })),
    };
    assert.equal(nextOpening(longBreak, at("2026-12-01T09:00:00Z")), null);
  });
});

describe("decideAnswer", () => {
  const thursdayOpen = at("2026-12-03T09:00:00Z"); // 10:00
  const thursdayEvening = at("2026-12-03T19:00:00Z"); // 20:00
  const saturdayOpen = at("2026-12-05T09:00:00Z"); // 10:00
  const christmas = at("2026-12-25T09:00:00Z");

  it("always", () => {
    assert.deepEqual(decideAnswer({ ...POLICY_OFF, always: true }, HOURS, thursdayOpen, "free"), { aiAnswers: true, reason: "always" });
  });

  it("after_hours, also on a closed holiday when holidays are not switched on", () => {
    const policy = { ...POLICY_OFF, afterHours: true };
    assert.deepEqual(decideAnswer(policy, HOURS, thursdayEvening, "free"), { aiAnswers: true, reason: "after_hours" });
    assert.deepEqual(decideAnswer(policy, HOURS, christmas, "free"), { aiAnswers: true, reason: "after_hours" });
    assert.deepEqual(decideAnswer(policy, HOURS, thursdayOpen, "free"), { aiAnswers: false, reason: "human_first" });
  });

  it("weekend, even while open", () => {
    assert.deepEqual(decideAnswer({ ...POLICY_OFF, weekends: true }, HOURS, saturdayOpen, "free"), { aiAnswers: true, reason: "weekend" });
  });

  it("holiday, but not on a holiday an exception opens", () => {
    const policy = { ...POLICY_OFF, holidays: true, afterHours: true };
    assert.deepEqual(decideAnswer(policy, HOURS, christmas, "free"), { aiAnswers: true, reason: "holiday" });
    assert.deepEqual(decideAnswer(policy, HOURS, at("2026-12-08T10:00:00Z"), "free"), { aiAnswers: false, reason: "human_first" });
  });

  it("busy and no_answer only while open", () => {
    const policy = { ...POLICY_OFF, whenBusy: true, noAnswerAfterSeconds: 20 };
    assert.deepEqual(decideAnswer(policy, HOURS, thursdayOpen, "busy"), { aiAnswers: true, reason: "busy" });
    assert.deepEqual(decideAnswer(policy, HOURS, thursdayOpen, "unanswered"), { aiAnswers: true, reason: "no_answer" });
    assert.deepEqual(decideAnswer(policy, HOURS, thursdayOpen, "free"), { aiAnswers: false, reason: "human_first" });
    assert.deepEqual(decideAnswer(policy, HOURS, thursdayEvening, "busy"), { aiAnswers: false, reason: "human_first" });
  });

  it("human_first when nothing applies", () => {
    assert.deepEqual(decideAnswer(POLICY_OFF, HOURS, thursdayEvening, "unanswered"), { aiAnswers: false, reason: "human_first" });
  });
});

describe("forwardingPlan", () => {
  it("is one unconditional forwarding for `always`", () => {
    const plan = forwardingPlan({ ...POLICY_OFF, always: true, afterHours: true, whenBusy: true });
    assert.deepEqual(plan.map((step) => step.type), ["unconditional"]);
  });

  it("combines time-based, no-reply and busy forwarding", () => {
    const plan = forwardingPlan({ ...POLICY_OFF, afterHours: true, weekends: true, holidays: true, noAnswerAfterSeconds: 20, whenBusy: true });
    assert.deepEqual(plan.map((step) => step.type), ["time_based", "no_reply", "busy"]);
    assert.equal(plan[1].seconds, 20);
    assert.match(plan[0].note, /outside the opening hours, on Saturdays and Sundays and on the business's holidays/);
    for (const step of plan) assert.ok(step.note.length > 0);
  });

  it("is empty when the AI never answers the phone", () => {
    assert.deepEqual(forwardingPlan(POLICY_OFF), []);
  });
});

describe("validateHours", () => {
  it("accepts good hours", () => {
    assert.deepEqual(validateHours(HOURS), []);
  });

  it("names every problem", () => {
    const bad = {
      timezone: "Mars/Olympus",
      weekly: {
        mon: [{ from: "8:00", to: "12:00" }],
        tue: [{ from: "12:00", to: "08:00" }],
        wed: [
          { from: "08:00", to: "12:00" },
          { from: "11:00", to: "14:00" },
        ],
        thu: [{ from: "24:00", to: "24:00" }],
        fri: [{ from: "08:00", to: "24:00" }],
        sat: [],
      },
      holidays: [{ date: "2026-02-30" }],
      exceptions: [
        { date: "2026-12-24", ranges: [] },
        { date: "2026-12-24", ranges: [{ from: "10:00", to: "25:00" }] },
      ],
    } as unknown as BusinessHours;
    const problems = validateHours(bad).join("\n");
    assert.match(problems, /Unknown time zone "Mars\/Olympus"/);
    assert.match(problems, /weekly\.mon\[0\]: start "8:00" is not a time/);
    assert.match(problems, /weekly\.tue\[0\]: 12:00-08:00 does not end after it starts/);
    assert.match(problems, /weekly\.wed: 08:00-12:00 overlaps 11:00-14:00/);
    assert.match(problems, /weekly\.thu\[0\]: start "24:00" is not a time/);
    assert.doesNotMatch(problems, /weekly\.fri/);
    assert.match(problems, /weekly\.sun is missing/);
    assert.match(problems, /holidays\[0\]: "2026-02-30" is not a date/);
    assert.match(problems, /exceptions\[1\]: 2026-12-24 has more than one exception/);
    assert.match(problems, /exceptions\[1\] \(2026-12-24\)\[0\]: end "25:00" is not a time/);
  });
});
