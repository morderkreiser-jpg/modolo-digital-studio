// The model's tools (lib/voice/tools): definitions per tenant, server-side validation and
// execution with caps, idempotency, tenant isolation and failing backends. The tenants below are
// fictional fixtures; the calendar is the built-in memory calendar with a fixed reference seed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VOICE_LIMITS, VOICE_TOOLS } from "@/lib/voice/types";
import type {
  BusinessHours,
  CalendarConfig,
  CalendarProvider,
  CallSummary,
  TaskDefinition,
  TimeRange,
  ToolOutcome,
  VoiceTenantConfig,
} from "@/lib/voice/types";
import { createMemoryCalendar } from "@/lib/voice/calendar";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import { hasPhoneNumber, isValidEmail, normalizePhone, validateToolInput, withoutPhoneNumbers } from "@/lib/voice/tools/validate";
import {
  createMemorySinks,
  executeTool,
  exportToolMemory,
  importToolMemory,
  type ToolContext,
  type ToolSinks,
} from "@/lib/voice/tools/execute";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const ZURICH = "Europe/Zurich";
const WORKDAY: TimeRange[] = [
  { from: "08:00", to: "12:00" },
  { from: "13:00", to: "18:00" },
];
const HOURS: BusinessHours = {
  timezone: ZURICH,
  weekly: { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: [{ from: "09:00", to: "13:00" }], sun: [] },
  holidays: [{ date: "2026-12-25" }],
};
/** Tuesday 1 December 2026, 09:00 in Zurich. */
const NOW = new Date("2026-12-01T08:00:00Z");
const OWNER_NUMBER = "+41521234567";
const DESK_NUMBER = "+41529876543";

const SALON_CALENDAR: CalendarConfig = {
  provider: "memory",
  services: [
    { id: "cut", label: { en: "Haircut", de: "Haarschnitt" }, durationMinutes: 30 },
    { id: "color", label: { en: "Colouring", de: "Färben" }, durationMinutes: 60 },
  ],
  capacity: { kind: "single" },
  slotStepMinutes: 30,
  minLeadMinutes: 60,
  maxDaysAhead: 60,
  allowCancel: true,
  allowReschedule: true,
  changeMinLeadMinutes: 24 * 60,
};

const QUOTE_TASK: TaskDefinition = {
  id: "quote_request",
  label: { en: "Quote request", de: "Offertanfrage" },
  when: "The caller wants a price for a wedding styling or another occasion.",
  fields: [
    {
      id: "occasion",
      label: { en: "Occasion", de: "Anlass" },
      type: "choice",
      required: true,
      choices: [
        { id: "wedding", label: { en: "Wedding", de: "Hochzeit", it: "Matrimonio" } },
        { id: "other", label: { en: "Other", de: "Anderes" } },
      ],
    },
    { id: "event_date", label: { en: "Date of the event" }, type: "date", required: true },
    { id: "guests", label: { en: "People to style" }, type: "integer", required: false, min: 1, max: 12 },
    { id: "arrival", label: { en: "Arrival time" }, type: "time", required: false },
    { id: "at_home", label: { en: "Styling at home" }, type: "boolean", required: false },
    { id: "wishes", label: { en: "Wishes" }, type: "text", required: false, maxLength: 50 },
  ],
  contact: { name: "required", phone: "required", email: "optional", company: "none" },
};

const GIFT_TASK: TaskDefinition = {
  id: "gift_card",
  label: { en: "Gift card" },
  when: "The caller wants to order a gift card.",
  fields: [
    { id: "amount", label: { en: "Amount in CHF" }, type: "integer", required: true, min: 20, max: 500 },
    { id: "recipient_email", label: { en: "Recipient email" }, type: "email", required: false },
  ],
  contact: { name: "required", phone: "optional", email: "optional", company: "none" },
};

function makeTenant(overrides: Partial<VoiceTenantConfig> = {}): VoiceTenantConfig {
  return {
    id: "test-salon",
    kind: "demo",
    business: { name: "Salon Test", sector: "hairdresser", locality: "Winterthur", description: { en: "A fictional salon for tests." } },
    locales: ["de", "en"],
    defaultLocale: "de",
    persona: { assistantName: { de: "der digitale Assistent" }, formality: { de: "formal" }, style: [] },
    greeting: { de: "Hier spricht der KI-Assistent von Salon Test." },
    hours: HOURS,
    answerPolicy: { always: false, afterHours: true, weekends: false, holidays: true, noAnswerAfterSeconds: 20, whenBusy: true },
    handoff: {
      transfer: {
        enabled: true,
        ringSeconds: 20,
        targets: [
          {
            id: "owner",
            label: { en: "the owner", de: "die Inhaberin" },
            number: OWNER_NUMBER,
            available: { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: [], sun: [] },
          },
          { id: "front_desk", label: { en: "the front desk", de: "der Empfang" }, number: DESK_NUMBER },
        ],
      },
      callback: { enabled: true, promise: { de: "Wir rufen Sie am nächsten Werktag zurück.", en: "We call you back on the next working day." } },
      written: { enabled: true },
      emergency: { triggers: [], message: {} },
    },
    tasks: [QUOTE_TASK, GIFT_TASK],
    tools: [...VOICE_TOOLS],
    calendar: SALON_CALENDAR,
    rules: [],
    plan: "demo",
    privacy: { recordAudio: false, transcriptRetentionDays: 0, summaryRetentionDays: 30, noticeUrl: {} },
    allowedOrigins: [],
    knowledge: () => ({ version: "test", sections: [] }),
    ...overrides,
  };
}

const SALON = makeTenant();
// A second tenant: its ids must never be accepted for the salon.
const MOVERS = makeTenant({
  id: "test-movers",
  calendar: { ...SALON_CALENDAR, services: [{ id: "inspection", label: { en: "Inspection visit" }, durationMinutes: 60 }] },
  tasks: [
    {
      id: "moving_quote",
      label: { en: "Moving quote" },
      when: "The caller plans a move.",
      fields: [{ id: "rooms", label: { en: "Rooms" }, type: "integer", required: true, min: 1, max: 20 }],
      contact: { name: "required", phone: "required", email: "optional", company: "optional" },
    },
  ],
  handoff: {
    ...SALON.handoff,
    transfer: { enabled: true, ringSeconds: 20, targets: [{ id: "dispatch", label: { en: "dispatch" }, number: "+41447770000" }] },
  },
});
const RESTAURANT = makeTenant({
  id: "test-restaurant",
  calendar: {
    ...SALON_CALENDAR,
    services: [{ id: "table", label: { en: "Table" }, durationMinutes: 90 }],
    capacity: { kind: "seats", total: 20, maxPartySize: 8, turnMinutes: 90 },
  },
});

type Outcome = CallSummary["outcomes"][number];
type TestContext = ToolContext & { outcomes: Outcome[]; memorySinks: ReturnType<typeof createMemorySinks> };

function makeContext(tenant: VoiceTenantConfig = SALON, overrides: Partial<ToolContext> = {}): TestContext {
  const outcomes: Outcome[] = [];
  const memorySinks = createMemorySinks();
  return {
    tenant,
    sessionId: "session-1",
    locale: "de",
    channel: "phone",
    now: NOW,
    limits: { ...DEFAULT_VOICE_LIMITS, toolCallsPerSession: 50, bookingsPerSession: 5, leadsPerSession: 5 },
    counters: { toolCalls: 0, bookings: 0, leads: 0 },
    calendar: tenant.calendar ? createMemoryCalendar(tenant.calendar, tenant.hours, { refSeed: "tools" }) : null,
    sinks: memorySinks,
    record: (outcome) => outcomes.push(outcome),
    outcomes,
    memorySinks,
    ...overrides,
  };
}

const call = (name: string, input: unknown) => ({ id: "toolu_test", name, input });

const BOOK_INPUT = {
  service: "cut",
  start: "2026-12-03T14:30:00+01:00",
  name: "Anna Muster",
  contact: "079 123 45 67",
};

const LEAD_INPUT = {
  task: "quote_request",
  fields: { occasion: "Hochzeit", event_date: "2027-06-12", guests: "3" },
  name: "Anna Muster",
  phone: "+41 79 123 45 67",
  summary: "Bride and two bridesmaids, styling on the wedding day.",
};

function errorsOf(result: ReturnType<typeof validateToolInput>): string {
  assert.equal(result.ok, false, "expected validation errors");
  return result.ok ? "" : result.errors.join("\n");
}

function valueOf(result: ReturnType<typeof validateToolInput>): Record<string, unknown> {
  assert.ok(result.ok, result.ok ? "" : result.errors.join("\n"));
  return result.value;
}

function assertNoNumbers(outcome: ToolOutcome): void {
  const text = JSON.stringify(outcome);
  for (const digits of ["521234567", "529876543"]) assert.ok(!text.includes(digits), `transfer number leaked: ${text}`);
}

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

describe("toolDefinitions", () => {
  it("lists the tenant's tools in the fixed order", () => {
    assert.deepEqual(toolDefinitions(SALON).map((tool) => tool.name), [...VOICE_TOOLS]);
    const few = makeTenant({ tools: ["end_call", "check_availability"] });
    assert.deepEqual(toolDefinitions(few).map((tool) => tool.name), ["check_availability", "end_call"]);
  });

  it("drops tools the configuration cannot carry out", () => {
    const names = (tenant: VoiceTenantConfig) => toolDefinitions(tenant).map((tool) => tool.name);
    const noCalendar = names(makeTenant({ calendar: undefined }));
    assert.ok(!noCalendar.some((name) => name.endsWith("_appointment") || name === "check_availability"));
    assert.ok(!names(makeTenant({ handoff: { ...SALON.handoff, transfer: { ...SALON.handoff.transfer, enabled: false } } })).includes("transfer_call"));
    assert.ok(!names(makeTenant({ handoff: { ...SALON.handoff, transfer: { ...SALON.handoff.transfer, targets: [] } } })).includes("transfer_call"));
    assert.ok(!names(makeTenant({ handoff: { ...SALON.handoff, callback: { enabled: false } } })).includes("request_callback"));
    assert.ok(!names(makeTenant({ tasks: [] })).includes("create_lead"));
    assert.ok(!names(makeTenant({ calendar: { ...SALON_CALENDAR, allowCancel: false } })).includes("cancel_appointment"));
    assert.ok(!names(makeTenant({ calendar: { ...SALON_CALENDAR, allowReschedule: false } })).includes("reschedule_appointment"));
  });

  it("is byte-identical for the same tenant", () => {
    const first = JSON.stringify(toolDefinitions(SALON));
    assert.equal(JSON.stringify(toolDefinitions(SALON)), first);
    assert.equal(JSON.stringify(toolDefinitions(makeTenant())), first);
  });

  it("uses strict schemas built from this tenant's ids", () => {
    const tools = Object.fromEntries(toolDefinitions(SALON).map((tool) => [tool.name, tool]));
    const walk = (schema: unknown, where: string): void => {
      if (!schema || typeof schema !== "object") return;
      const node = schema as Record<string, unknown>;
      if (node.type === "object") assert.equal(node.additionalProperties, false, where);
      for (const [key, child] of Object.entries((node.properties as Record<string, unknown>) ?? {})) walk(child, `${where}.${key}`);
    };
    for (const tool of Object.values(tools)) walk(tool.inputSchema, tool.name);

    const service = tools.check_availability.inputSchema.properties.service as { enum: string[] };
    assert.deepEqual(service.enum, ["cut", "color"]);
    assert.deepEqual(tools.check_availability.inputSchema.required, ["service", "date"]);
    assert.ok(!("party_size" in tools.check_availability.inputSchema.properties));

    const lead = tools.create_lead.inputSchema;
    assert.deepEqual((lead.properties.task as { enum: string[] }).enum, ["quote_request", "gift_card"]);
    const fields = lead.properties.fields as { properties: Record<string, { type: string }> };
    assert.deepEqual(Object.keys(fields.properties), ["occasion", "event_date", "guests", "arrival", "at_home", "wishes", "amount", "recipient_email"]);
    assert.ok(Object.values(fields.properties).every((field) => field.type === "string"));
    assert.deepEqual(Object.keys(lead.properties), ["task", "fields", "name", "phone", "email", "summary"], "no task needs a company");

    assert.deepEqual((tools.transfer_call.inputSchema.properties.target as { enum: string[] }).enum, ["owner", "front_desk"]);
    assert.deepEqual((tools.end_call.inputSchema.properties.reason as { enum: string[] }).enum, ["caller_done", "no_response", "abuse", "limit"]);

    const seats = Object.fromEntries(toolDefinitions(RESTAURANT).map((tool) => [tool.name, tool]));
    assert.ok("party_size" in seats.check_availability.inputSchema.properties);
    assert.ok(seats.book_appointment.inputSchema.required.includes("party_size"));
  });

  it("tells the model when to act and never shows a transfer number", () => {
    const tools = Object.fromEntries(toolDefinitions(SALON).map((tool) => [tool.name, tool]));
    assert.match(tools.book_appointment.description, /wait for the caller's yes/);
    assert.match(tools.book_appointment.description, /Never say the appointment is booked unless this tool answered ok/);
    assert.match(tools.create_lead.description, /Never say the request was stored or passed on unless this tool answered ok/);
    assert.match(tools.create_lead.description, /quote_request: The caller wants a price/);
    assert.match(tools.request_callback.description, /Never say the callback request was passed on unless this tool answered ok/);
    const text = JSON.stringify(toolDefinitions(SALON));
    for (const digits of ["521234567", "529876543"]) assert.ok(!text.includes(digits));
  });
});

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

describe("validateToolInput", () => {
  it("refuses unknown and disabled tools and non-object input", () => {
    assert.match(errorsOf(validateToolInput(SALON, "send_sms", {})), /Unknown tool "send_sms"/);
    const noTransfer = makeTenant({ tools: ["end_call"] });
    assert.match(errorsOf(validateToolInput(noTransfer, "transfer_call", { target: "owner", reason: "x" })), /Unknown tool/);
    for (const input of [null, [], "text", 42]) {
      assert.match(errorsOf(validateToolInput(SALON, "end_call", input)), /must be an object/);
    }
  });

  it("reports unknown properties, wrong types and missing details", () => {
    const errors = errorsOf(validateToolInput(SALON, "check_availability", { service: 7, colour: "red", part_of_day: "night" }));
    assert.match(errors, /Unknown property "colour"/);
    assert.match(errors, /"service" must be a string/);
    assert.match(errors, /"date" is required/);
    assert.match(errors, /"part_of_day" must be one of: morning, afternoon, evening/);
    assert.match(errorsOf(validateToolInput(SALON, "check_availability", { service: "cut", date: "3.12.2026" })), /"date" must be a date as YYYY-MM-DD/);
    assert.match(errorsOf(validateToolInput(SALON, "check_availability", { service: "cut", date: "2026-12-03", party_size: 2 })), /Unknown property "party_size"/);
    const seats = errorsOf(validateToolInput(RESTAURANT, "book_appointment", { ...BOOK_INPUT, service: "table", party_size: "4" }));
    assert.match(seats, /"party_size" must be a whole number/);
    assert.match(errorsOf(validateToolInput(RESTAURANT, "check_availability", { service: "table", date: "2026-12-03" })), /"party_size" is required/);
    assert.match(errorsOf(validateToolInput(SALON, "end_call", { reason: "bored" })), /"reason" must be one of/);
    assert.match(errorsOf(validateToolInput(SALON, "transfer_call", { target: "owner" })), /"reason" is required/);
  });

  it("accepts only this tenant's ids", () => {
    assert.match(errorsOf(validateToolInput(SALON, "check_availability", { service: "inspection", date: "2026-12-03" })), /"service" must be one of: cut, color/);
    const lead = errorsOf(validateToolInput(SALON, "create_lead", { task: "moving_quote", fields: { rooms: "3" }, summary: "Move" }));
    assert.match(lead, /"task" must be one of: quote_request, gift_card/);
    assert.match(lead, /Unknown property "fields.rooms"/);
    assert.match(errorsOf(validateToolInput(SALON, "transfer_call", { target: "dispatch", reason: "x" })), /"target" must be one of: owner, front_desk/);
    assert.ok(validateToolInput(MOVERS, "check_availability", { service: "inspection", date: "2026-12-03" }).ok);
  });

  it("validates and normalises task fields", () => {
    const value = valueOf(
      validateToolInput(SALON, "create_lead", {
        ...LEAD_INPUT,
        fields: { occasion: "  matrimonio ", event_date: "2027-06-12", guests: "3", arrival: "9.30", at_home: "Ja", wishes: " Hochsteckfrisur " },
        email: "Anna.Muster@Example.CH",
      }),
    );
    assert.deepEqual(value.fields, { occasion: "wedding", event_date: "2027-06-12", guests: "3", arrival: "09:30", at_home: "yes", wishes: "Hochsteckfrisur" });
    assert.equal(value.phone, "+41791234567");
    assert.equal(value.email, "anna.muster@example.ch");
    const byId = valueOf(validateToolInput(SALON, "create_lead", { ...LEAD_INPUT, fields: { ...LEAD_INPUT.fields, occasion: "WEDDING" } }));
    assert.equal((byId.fields as Record<string, string>).occasion, "wedding");

    const errors = errorsOf(
      validateToolInput(SALON, "create_lead", {
        task: "quote_request",
        fields: { occasion: "birthday", event_date: "12.06.2027", guests: "13", arrival: "25:00", at_home: "maybe", wishes: "x".repeat(51), amount: "50" },
        name: "Anna Muster",
        summary: "Test",
      }),
    );
    assert.match(errors, /"fields.occasion" must be one of: wedding, other/);
    assert.match(errors, /"fields.event_date" must be a date as YYYY-MM-DD/);
    assert.match(errors, /"fields.guests" must be a whole number from 1 to 12/);
    assert.match(errors, /"fields.arrival" must be a time as HH:MM/);
    assert.match(errors, /"fields.at_home" must be "yes" or "no"/);
    assert.match(errors, /"fields.wishes" is too long \(at most 50 characters\)/);
    assert.match(errors, /"fields.amount" does not belong to task "quote_request"/);
    assert.match(errors, /"phone" is required for this task/);

    assert.match(errorsOf(validateToolInput(SALON, "create_lead", { ...LEAD_INPUT, fields: { event_date: "2027-06-12" } })), /"fields.occasion" \(Occasion\) is required/);
    assert.match(errorsOf(validateToolInput(SALON, "create_lead", { ...LEAD_INPUT, fields: { ...LEAD_INPUT.fields, guests: 3 } })), /"fields.guests" must be a string/);
    assert.match(errorsOf(validateToolInput(SALON, "create_lead", { ...LEAD_INPUT, fields: "wedding" })), /"fields" must be an object/);
    assert.match(errorsOf(validateToolInput(SALON, "create_lead", { ...LEAD_INPUT, company: "ACME" })), /Unknown property "company"/);
    assert.match(errorsOf(validateToolInput(SALON, "create_lead", { task: "gift_card", name: "Anna Muster", summary: "Gift" })), /"fields.amount" \(Amount in CHF\) is required/);
  });

  it("drops contact details a task does not need", () => {
    const noEmail: TaskDefinition = { ...GIFT_TASK, id: "gift_no_email", contact: { ...GIFT_TASK.contact, email: "none" } };
    const tenant = makeTenant({ tasks: [QUOTE_TASK, noEmail] });
    const value = valueOf(
      validateToolInput(tenant, "create_lead", { task: "gift_no_email", fields: { amount: "100" }, name: "Anna Muster", email: "anna@example.ch", summary: "Gift" }),
    );
    assert.equal(value.email, undefined);
  });

  it("cleans text, caps free text and refuses oversized identity data", () => {
    const value = valueOf(
      validateToolInput(SALON, "book_appointment", { ...BOOK_INPUT, name: " Anna\u0000  Muster‮ ", notes: `${"n".repeat(600)}` }),
    );
    assert.equal(value.name, "Anna Muster");
    assert.equal((value.notes as string).length, 500);
    assert.match(errorsOf(validateToolInput(SALON, "book_appointment", { ...BOOK_INPUT, name: "12345" })), /"name" must be a name/);
    assert.match(errorsOf(validateToolInput(SALON, "book_appointment", { ...BOOK_INPUT, name: "A".repeat(101) })), /"name" is too long/);
    const summary = valueOf(validateToolInput(SALON, "create_lead", { ...LEAD_INPUT, summary: "s".repeat(1500) })).summary as string;
    assert.equal(summary.length, 1000);
  });

  it("normalises start times, contacts and references", () => {
    const start = (value: string) => validateToolInput(SALON, "book_appointment", { ...BOOK_INPUT, start: value });
    assert.equal(valueOf(start("2026-12-03T14:30")).start, "2026-12-03T14:30:00+01:00");
    assert.equal(valueOf(start("2026-12-03T13:30:00Z")).start, "2026-12-03T14:30:00+01:00");
    assert.equal(valueOf(start("2027-07-01T10:00")).start, "2027-07-01T10:00:00+02:00");
    assert.match(errorsOf(start("2027-03-28T02:30")), /"start" must be a start time returned by check_availability/);
    assert.match(errorsOf(start("tomorrow at three")), /"start" must be a start time/);

    const contact = (value: string) => validateToolInput(SALON, "book_appointment", { ...BOOK_INPUT, contact: value });
    assert.equal(valueOf(contact("079 123 45 67")).contact, "+41791234567");
    assert.equal(valueOf(contact(" Anna@Example.ch ")).contact, "anna@example.ch");
    assert.match(errorsOf(contact("call me")), /"contact" must be a phone number/);

    assert.equal(valueOf(validateToolInput(SALON, "cancel_appointment", { reference: "mv 7k2q", name: "Anna Muster" })).reference, "MV-7K2Q");
    assert.match(errorsOf(validateToolInput(SALON, "cancel_appointment", { reference: "?", name: "Anna Muster" })), /"reference" must be a booking reference/);
  });
});

describe("normalizePhone", () => {
  const table: Array<[string, string | null]> = [
    ["079 123 45 67", "+41791234567"],
    ["0791234567", "+41791234567"],
    ["+41 79 123 45 67", "+41791234567"],
    ["0041 79 123 45 67", "+41791234567"],
    ["+41 (0)79 123 45 67", "+41791234567"],
    ["+41 079 123 45 67", "+41791234567"],
    ["079-123-45-67", "+41791234567"],
    ["079/123 45 67", "+41791234567"],
    ["(044) 123 45 67", "+41441234567"],
    ["0800 123 456", "+41800123456"],
    ["+39 02 1234 5678", "+390212345678"],
    ["0039 333 123 4567", "+393331234567"],
    ["+49 30 1234567", "+49301234567"],
    ["+1 (555) 123-4567", "+15551234567"],
    ["", null],
    ["117", null],
    ["079 123 45", null],
    ["07912345678", null],
    ["41791234567", null],
    ["79 123 45 67", null],
    ["+41 79 123 45 678", null],
    ["079 123 45 67 ext. 2", null],
    ["+0 123 4567", null],
    ["++41791234567", null],
    ["079+1234567", null],
    ["call me", null],
  ];
  for (const [raw, expected] of table) {
    it(`${JSON.stringify(raw)} -> ${expected}`, () => assert.equal(normalizePhone(raw), expected));
  }
});

describe("isValidEmail", () => {
  it("accepts ordinary and international addresses", () => {
    for (const email of ["anna@example.ch", "Anna.Muster+test@Example.CH", "info@müller.ch", "a@b.co", " x@y.it "]) {
      assert.equal(isValidEmail(email), true, email);
    }
  });

  it("refuses broken ones", () => {
    for (const email of ["", "anna", "anna@", "@example.ch", "anna@example", "anna muster@x.ch", "a@@b.ch", "a@b..ch", ".a@b.ch", "a.@b.ch", "a@b.c", "a@-b.ch"]) {
      assert.equal(isValidEmail(email), false, email);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

describe("executeTool: happy paths", () => {
  it("check_availability lists free times", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("check_availability", { service: "cut", date: "2026-12-03", part_of_day: "morning" }));
    assert.ok(outcome.ok);
    assert.match(outcome.say, /^Free start times for Haircut on Thursday 3 December 2026 \(morning\): 08:00, 08:30, 09:00/);
    const slots = outcome.data?.slots as Array<{ start: string; time: string }>;
    assert.deepEqual(slots[0], { start: "2026-12-03T08:00:00+01:00", time: "08:00" });
    assert.equal(ctx.counters.toolCalls, 1);
    assert.deepEqual(ctx.outcomes, []);
  });

  it("book, reschedule and cancel an appointment", async () => {
    const ctx = makeContext();
    const booked = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(booked.ok, booked.say);
    assert.match(booked.say, /^Booked: Thursday 3 December 2026 at 14:30, reference MV-[2-9A-HJ-NP-Z]{4}\./);
    const ref = booked.data?.reference as string;
    assert.equal(ctx.counters.bookings, 1);
    assert.equal(ctx.outcomes[0].kind, "booking");

    const moved = await executeTool(ctx, call("reschedule_appointment", { reference: ref, name: "anna muster", new_start: "2026-12-04T10:00:00+01:00" }));
    assert.ok(moved.ok, moved.say);
    assert.equal(moved.say, `Moved: the appointment ${ref} is now on Friday 4 December 2026 at 10:00.`);
    assert.equal(ctx.counters.bookings, 1, "a move is not a new booking");
    // A move is recorded as a move (review finding correttezza/F4: this asserted a second
    // "booking" outcome for the same reference, which the summary listed as a new appointment).
    const movedOutcome = ctx.outcomes[1];
    assert.ok(movedOutcome.kind === "reschedule" && movedOutcome.booking.start === "2026-12-04T10:00:00+01:00");
    assert.equal(ctx.outcomes.filter((outcome) => outcome.kind === "booking").length, 1, "one booking per reference");

    const cancelled = await executeTool(ctx, call("cancel_appointment", { reference: ref, name: "Anna Muster" }));
    assert.ok(cancelled.ok, cancelled.say);
    assert.equal(cancelled.say, `Cancelled: the appointment on Friday 4 December 2026 at 10:00, reference ${ref}.`);
    assert.deepEqual(ctx.outcomes[2], { kind: "cancellation", ref });
  });

  it("create_lead hands a normalised record to the sink", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    assert.ok(outcome.ok, outcome.say);
    assert.match(outcome.say, /^Stored and passed on to the team, reference LD-2222\./);
    // The record carries the call's idempotency key too (review finding S2-8): the sink passes it
    // to the email service, so the same request sent again reaches the business once.
    assert.equal(ctx.memorySinks.leads.length, 1);
    const { idempotencyKey, ...record } = ctx.memorySinks.leads[0] as Record<string, unknown>;
    assert.match(String(idempotencyKey), /^[0-9a-f]{32}$/);
    assert.deepEqual(record, {
      tenant: "test-salon",
      sessionId: "session-1",
      taskId: "quote_request",
      fields: { occasion: "wedding", event_date: "2027-06-12", guests: "3" },
      contact: { name: "Anna Muster", phone: "+41791234567" },
      summary: LEAD_INPUT.summary,
      locale: "de",
    });
    assert.equal(ctx.counters.leads, 1);
    assert.deepEqual(ctx.outcomes, [
      { kind: "lead", taskId: "quote_request", ref: "LD-2222", fields: { occasion: "wedding", event_date: "2027-06-12", guests: "3" }, contact: { name: "Anna Muster", phone: "+41791234567" } },
    ]);
  });

  it("request_callback passes the request on with the tenant's own promise", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("request_callback", { name: "Anna Muster", phone: "0791234567", topic: "Wedding styling", preferred_time: "morgen Vormittag" }));
    assert.ok(outcome.ok, outcome.say);
    assert.equal(outcome.say, 'Callback request passed on. About timing, say only: "Wir rufen Sie am nächsten Werktag zurück."');
    assert.deepEqual(ctx.outcomes, [{ kind: "callback", name: "Anna Muster", phone: "+41791234567", topic: "Wedding styling", preferredTime: "morgen Vormittag" }]);
    assert.equal(ctx.counters.leads, 1);
  });

  it("transfer_call connects a phone caller", async () => {
    const ctx = makeContext(SALON, { sinks: createMemorySinks({ transferConnected: true }) });
    const outcome = await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Complaint" }));
    assert.ok(outcome.ok, outcome.say);
    assert.equal(outcome.say, "Connecting the caller to die Inhaberin now.");
    assert.deepEqual(ctx.outcomes, [{ kind: "transfer", targetId: "owner", connected: true }]);
    assertNoNumbers(outcome);
  });

  it("end_call ends the conversation without counting", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("end_call", { reason: "caller_done" }));
    assert.deepEqual(outcome, { ok: true, say: "The conversation ends after your goodbye.", data: { reason: "caller_done" }, endCall: true });
    assert.equal(ctx.counters.toolCalls, 0);
  });
});

describe("executeTool: refusals", () => {
  it("refuses tools the tenant does not list", async () => {
    const ctx = makeContext(makeTenant({ tools: ["check_availability", "end_call"] }));
    const outcome = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.code, "not_enabled");
    assert.equal((await executeTool(ctx, call("format_disk", {}))).ok, false);
    assert.equal(ctx.counters.toolCalls, 0);
    assert.deepEqual(ctx.memorySinks.leads, []);
  });

  it("isolates tenants: another tenant's service, task or target is invalid input", async () => {
    const ctx = makeContext();
    for (const [name, input] of [
      ["check_availability", { service: "inspection", date: "2026-12-03" }],
      ["create_lead", { ...LEAD_INPUT, task: "moving_quote", fields: { rooms: "3" } }],
      ["transfer_call", { target: "dispatch", reason: "Move" }],
    ] as const) {
      const outcome = await executeTool(ctx, call(name, input));
      assert.ok(!outcome.ok && outcome.code === "invalid_input", `${name}: ${outcome.say}`);
    }
    assert.deepEqual(ctx.memorySinks.leads, []);
    assert.deepEqual(ctx.memorySinks.transfers, []);
  });

  it("explains invalid input so the model can ask again", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("book_appointment", { service: "cut", start: "2026-12-03T14:30:00+01:00", contact: "nope" }));
    assert.ok(!outcome.ok && outcome.code === "invalid_input");
    assert.match(outcome.say, /"name" is required/);
    assert.match(outcome.say, /"contact" must be a phone number/);
    assert.match(outcome.say, /Ask the caller again for these details\. Nothing was done yet\./);
    assert.equal(ctx.counters.toolCalls, 1);
    assert.equal(ctx.counters.bookings, 0);
  });

  it("enforces the per-session caps, but end_call always works", async () => {
    const ctx = makeContext(SALON, { limits: { ...DEFAULT_VOICE_LIMITS, toolCallsPerSession: 2 } });
    const check = call("check_availability", { service: "cut", date: "2026-12-03" });
    assert.ok((await executeTool(ctx, check)).ok);
    assert.ok((await executeTool(ctx, check)).ok);
    const third = await executeTool(ctx, check);
    assert.ok(!third.ok && third.code === "limit_reached");
    assert.ok((await executeTool(ctx, call("end_call", { reason: "limit" }))).ok);

    const bookings = makeContext(SALON, { limits: { ...DEFAULT_VOICE_LIMITS, bookingsPerSession: 1 } });
    assert.ok((await executeTool(bookings, call("book_appointment", BOOK_INPUT))).ok);
    const second = await executeTool(bookings, call("book_appointment", { ...BOOK_INPUT, start: "2026-12-03T15:30:00+01:00" }));
    assert.ok(!second.ok && second.code === "limit_reached");
    assert.match(second.say, /this one was not booked\. Bookings confirmed earlier stand\./);

    const leads = makeContext(SALON, { limits: { ...DEFAULT_VOICE_LIMITS, leadsPerSession: 1 } });
    assert.ok((await executeTool(leads, call("create_lead", LEAD_INPUT))).ok);
    const callback = await executeTool(leads, call("request_callback", { name: "Anna Muster", phone: "0791234567", topic: "Price" }));
    assert.ok(!callback.ok && callback.code === "limit_reached");
    assert.equal(leads.memorySinks.callbacks.length, 0);
  });

  it("reports a taken slot as a conflict and nothing as booked", async () => {
    const ctx = makeContext();
    assert.ok((await executeTool(ctx, call("book_appointment", BOOK_INPUT))).ok);
    const other = makeContext(SALON, { sessionId: "session-2", calendar: ctx.calendar });
    const outcome = await executeTool(other, call("book_appointment", { ...BOOK_INPUT, name: "Beat Keller" }));
    assert.ok(!outcome.ok && outcome.code === "conflict");
    assert.match(outcome.say, /Nothing was booked/);
    assert.deepEqual(other.outcomes, []);
  });

  it("does not cancel with a wrong name", async () => {
    const ctx = makeContext();
    const booked = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    const ref = booked.ok ? (booked.data?.reference as string) : "";
    const outcome = await executeTool(ctx, call("cancel_appointment", { reference: ref, name: "Beat Keller" }));
    assert.ok(!outcome.ok && outcome.code === "not_found");
    assert.match(outcome.say, /Nothing was cancelled/);
  });
});

describe("executeTool: repeats", () => {
  it("a repeated booking call books once", async () => {
    const ctx = makeContext();
    const first = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    // The same request worded differently normalises to the same input, hence the same key.
    const again = await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, contact: "+41 79 123 45 67", start: "2026-12-03T13:30:00Z" }));
    assert.ok(first.ok && again.ok);
    assert.equal(again.data?.reference, first.data?.reference);
    assert.equal(ctx.counters.bookings, 1);
    assert.equal(ctx.outcomes.length, 1);
    const check = await executeTool(ctx, call("check_availability", { service: "cut", date: "2026-12-03" }));
    assert.ok(check.ok && !(check.data?.slots as Array<{ time: string }>).some((slot) => slot.time === "14:30"));
  });

  it("a repeated lead reaches the sink once", async () => {
    const ctx = makeContext();
    const first = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    const again = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    assert.deepEqual(again, first);
    assert.equal(ctx.memorySinks.leads.length, 1);
    assert.equal(ctx.counters.leads, 1);
    assert.equal(ctx.outcomes.length, 1);
  });
});

describe("executeTool: transfers", () => {
  it("refuses a live transfer on the web and offers the alternatives", async () => {
    const ctx = makeContext(SALON, { channel: "web", sinks: createMemorySinks({ transferConnected: true }) });
    const outcome = await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Question" }));
    assert.ok(!outcome.ok && outcome.code === "forbidden");
    assert.match(outcome.say, /only on phone calls; nobody was put through\. Offer a callback or a written follow-up instead\./);
    assertNoNumbers(outcome);
    assert.deepEqual(ctx.outcomes, []);
  });

  it("refuses outside the target's availability and outside opening hours", async () => {
    const saturday = new Date("2026-12-05T09:00:00Z"); // 10:00, the shop is open, the owner is not
    const ctx = makeContext(SALON, { now: saturday, sinks: createMemorySinks({ transferConnected: true }) });
    const owner = await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Question" }));
    assert.ok(!owner.ok && owner.code === "not_available");
    assert.match(owner.say, /die Inhaberin takes no calls at this time; nobody was put through/);
    assert.ok((await executeTool(ctx, call("transfer_call", { target: "front_desk", reason: "Question" }))).ok);

    const sunday = makeContext(SALON, { now: new Date("2026-12-06T09:00:00Z"), sinks: createMemorySinks({ transferConnected: true }) });
    const desk = await executeTool(sunday, call("transfer_call", { target: "front_desk", reason: "Question" }));
    assert.ok(!desk.ok && desk.code === "not_available");
  });

  it("says so when nobody picks up, and records the attempt", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Question" }));
    assert.ok(!outcome.ok && outcome.code === "not_available");
    assert.match(outcome.say, /did not answer; the caller was not put through/);
    assert.deepEqual(ctx.outcomes, [{ kind: "transfer", targetId: "owner", connected: false }]);
    assertNoNumbers(outcome);
  });

  it("never lets a number slip into a say, even through a badly written label", async () => {
    const leaky = makeTenant({
      handoff: {
        ...SALON.handoff,
        transfer: { ...SALON.handoff.transfer, targets: [{ id: "owner", label: { de: "Inhaberin (052 123 45 67)" }, number: "+41521234567" }] },
      },
    });
    const ctx = makeContext(leaky);
    const outcome = await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Question" }));
    assert.match(outcome.say, /Inhaberin \(\[number withheld\]\) did not answer/);
    assert.ok(!outcome.say.replace(/\s/g, "").includes("0521234567"));
    assert.ok(!outcome.say.includes(OWNER_NUMBER));
  });
});

describe("executeTool: failing backends", () => {
  it("a lead sink that throws or refuses means nothing was stored", async () => {
    for (const lead of [
      async () => {
        throw new Error("smtp down");
      },
      async () => ({ ok: false, ref: "" }),
    ]) {
      const sinks: ToolSinks = { ...createMemorySinks(), lead };
      const ctx = makeContext(SALON, { sinks });
      const outcome = await executeTool(ctx, call("create_lead", LEAD_INPUT));
      assert.ok(!outcome.ok && outcome.code === "unavailable");
      assert.match(outcome.say, /could not be stored\. Nothing was passed on\. Tell the caller it did not go through\. Offer a callback instead\./);
      assert.equal(ctx.counters.leads, 0);
      assert.deepEqual(ctx.outcomes, []);
    }
  });

  it("a callback sink that fails offers the written route instead", async () => {
    const sinks: ToolSinks = {
      ...createMemorySinks(),
      callback: async () => {
        throw new Error("queue down");
      },
    };
    const ctx = makeContext(SALON, { sinks });
    const outcome = await executeTool(ctx, call("request_callback", { name: "Anna Muster", phone: "0791234567", topic: "Price" }));
    assert.ok(!outcome.ok && outcome.code === "unavailable");
    assert.match(outcome.say, /did not go through\. Offer a written follow-up instead\./);
  });

  it("a calendar that breaks or is missing means nothing was booked", async () => {
    const broken: CalendarProvider = {
      findSlots: async () => {
        throw new Error("timeout");
      },
      book: async () => {
        throw new Error("timeout");
      },
      cancel: async () => ({ ok: false, code: "unavailable" }),
      reschedule: async () => ({ ok: false, code: "unavailable" }),
    };
    const ctx = makeContext(SALON, { calendar: broken });
    const booked = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(!booked.ok && booked.code === "unavailable");
    assert.match(booked.say, /The calendar did not answer\. Nothing was booked\. Tell the caller it did not go through\./);
    const check = await executeTool(ctx, call("check_availability", { service: "cut", date: "2026-12-03" }));
    assert.ok(!check.ok && check.code === "unavailable");
    const moved = await executeTool(ctx, call("reschedule_appointment", { reference: "MV-2222", name: "Anna Muster", new_start: "2026-12-04T10:00:00+01:00" }));
    assert.match(moved.say, /The appointment was not moved and stays as it was/);
    const missing = makeContext(SALON, { calendar: null });
    const none = await executeTool(missing, call("book_appointment", BOOK_INPUT));
    assert.ok(!none.ok && none.code === "unavailable");
    assert.equal(ctx.counters.bookings + missing.counters.bookings, 0);
  });

  it("a transfer backend that throws is unavailable", async () => {
    const sinks: ToolSinks = {
      ...createMemorySinks(),
      transfer: async () => {
        throw new Error("sip down");
      },
    };
    const outcome = await executeTool(makeContext(SALON, { sinks }), call("transfer_call", { target: "owner", reason: "Question" }));
    assert.ok(!outcome.ok && outcome.code === "unavailable");
    assert.match(outcome.say, /nobody was put through/);
  });

  it("a summary recorder that throws does not undo a booking", async () => {
    const ctx = makeContext(SALON, {
      record: () => {
        throw new Error("summary store down");
      },
    });
    const outcome = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(outcome.ok);
  });

  it("never throws, whatever the model sends", async () => {
    const ctx = makeContext();
    const circular: Record<string, unknown> = { task: "quote_request", summary: "x", name: "Anna Muster", phone: "0791234567" };
    circular.fields = { occasion: "wedding", event_date: "2027-06-12", self: circular };
    for (const bad of [
      { id: "1", name: 42 as unknown as string, input: {} },
      { id: "2", name: "book_appointment", input: null },
      { id: "3", name: "create_lead", input: circular },
      { id: "4", name: "check_availability", input: { service: "cut", date: "2026-12-03", ["__proto__"]: { polluted: true } } },
    ]) {
      const outcome = await executeTool(ctx, bad);
      assert.equal(typeof outcome.say, "string");
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

// ---------------------------------------------------------------------------------------------
// Regressions of the review (research/revisione/revisione-1.json)
// ---------------------------------------------------------------------------------------------

/** The booking reference of an outcome, "" when it failed. */
const refOf = (outcome: ToolOutcome): string => (outcome.ok ? String(outcome.data?.reference ?? "") : "");

describe("review correttezza/F1: booking the same appointment again with a corrected detail", () => {
  const TABLE = { service: "table", start: "2026-12-15T13:30:00+01:00", name: "Sarah Collins", contact: "+41780000044", party_size: 4 };

  it("holds one table, not two, and says how to change the details", async () => {
    const ctx = makeContext(RESTAURANT);
    const first = await executeTool(ctx, call("book_appointment", TABLE));
    assert.ok(first.ok, first.say);
    const corrected = await executeTool(ctx, call("book_appointment", { ...TABLE, contact: "+41780000045" }));
    assert.ok(!corrected.ok && corrected.code === "conflict", corrected.say);
    assert.match(corrected.say, /already booked this time: Tuesday 15 December 2026 at 13:30, reference MV-/);
    assert.match(corrected.say, /Nothing new was booked and that booking was not changed\./);
    assert.match(corrected.say, /cancel reference MV-[2-9A-HJ-NP-Z]{4} with cancel_appointment, then book again/);
    assert.equal(ctx.counters.bookings, 1);
    assert.equal(ctx.outcomes.filter((outcome) => outcome.kind === "booking").length, 1);
    // Eight seats would have been held for one party: only four are.
    const check = await executeTool(ctx, call("check_availability", { service: "table", date: "2026-12-15", party_size: 8 }));
    assert.ok(check.ok, check.say);
  });

  it("on a single resource answers 'already booked', never 'no longer free', and rebooking after a cancel works", async () => {
    const ctx = makeContext();
    const first = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(first.ok);
    const ref = first.data?.reference as string;
    const corrected = await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, contact: "079 123 45 68" }));
    assert.ok(!corrected.ok);
    assert.doesNotMatch(corrected.say, /no longer free/);
    assert.match(corrected.say, new RegExp(`reference ${ref}`));
    // The salon lets callers change bookings more than 24 hours ahead: cancel, then book anew.
    const early = makeContext(SALON, { now: new Date("2026-12-01T08:00:00Z") });
    const booked = await executeTool(early, call("book_appointment", BOOK_INPUT));
    const bookedRef = refOf(booked);
    assert.ok((await executeTool(early, call("cancel_appointment", { reference: bookedRef, name: "Anna Muster" }))).ok);
    const again = await executeTool(early, call("book_appointment", { ...BOOK_INPUT, contact: "079 123 45 68" }));
    assert.ok(again.ok, again.say);
    assert.notEqual(again.data?.reference, bookedRef);
  });

  it("a tenant that cannot cancel by phone says the booking stands as made", async () => {
    const noCancel = makeTenant({ calendar: { ...SALON_CALENDAR, allowCancel: false }, tools: ["book_appointment", "check_availability", "end_call"] });
    const ctx = makeContext(noCancel);
    assert.ok((await executeTool(ctx, call("book_appointment", BOOK_INPUT))).ok);
    const corrected = await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, name: "Anna Muster-Keller" }));
    assert.ok(!corrected.ok);
    assert.match(corrected.say, /the booking stands as it was made/);
  });
});

describe("review S2-11: a second party at the same time on a calendar with seats", () => {
  const COLLINS = { service: "table", start: "2026-12-15T13:30:00+01:00", name: "Sarah Collins", contact: "+41780000044", party_size: 4 };
  const MEIER = { service: "table", start: "2026-12-15T13:30:00+01:00", name: "Peter Meier", contact: "+41780000077", party_size: 6 };
  /** What the model sends once the caller confirmed an extra table for another group. */
  const MEIER_GROUP = { ...MEIER, separate_party: true };
  const ASK_FIRST = /Only if the caller confirms they want an extra booking for a different group, in addition to this one, call book_appointment again with that group's own name and separate_party: true\./;

  it("books a table for another group at the same time once the model marks it so, within the bookings cap", async () => {
    const ctx = makeContext(RESTAURANT, { limits: { ...DEFAULT_VOICE_LIMITS, bookingsPerSession: 2 } });
    const first = await executeTool(ctx, call("book_appointment", COLLINS));
    assert.ok(first.ok, first.say);
    // Unmarked, another name and contact may be a correction of both: refused, with the way to an extra table.
    const unmarked = await executeTool(ctx, call("book_appointment", MEIER));
    assert.ok(!unmarked.ok && unmarked.code === "conflict", unmarked.say);
    assert.match(unmarked.say, ASK_FIRST);
    const second = await executeTool(ctx, call("book_appointment", MEIER_GROUP));
    assert.ok(second.ok, second.say);
    assert.notEqual(refOf(second), refOf(first));
    assert.equal(second.data?.party_size, 6);
    assert.equal(ctx.counters.bookings, 2);
    assert.equal(ctx.outcomes.filter((outcome) => outcome.kind === "booking").length, 2);
    // The same call again, with or without the mark, is a repeat, not a third table.
    for (const again of [MEIER_GROUP, MEIER]) {
      const repeat = await executeTool(ctx, call("book_appointment", again));
      assert.ok(repeat.ok, repeat.say);
      assert.equal(refOf(repeat), refOf(second));
    }
    assert.equal(ctx.counters.bookings, 2);
    // A third party is held to the cap.
    const third = await executeTool(ctx, call("book_appointment", { ...MEIER_GROUP, name: "Lea Frei", contact: "lea@example.ch", party_size: 2 }));
    assert.ok(!third.ok && third.code === "limit_reached", third.say);
  });

  it("the same name, however it is written, or the same contact is still a correction (correttezza/F1)", async () => {
    const ctx = makeContext(RESTAURANT);
    assert.ok((await executeTool(ctx, call("book_appointment", COLLINS))).ok);
    const corrections = [
      { ...COLLINS, contact: "+41780000045" },
      { ...COLLINS, name: "collins sarah", contact: "+41780000045", party_size: 5 },
      { ...COLLINS, name: "Sarah Cöllins", contact: "sarah@example.ch" },
      { ...COLLINS, name: "Sarah Meier", party_size: 6 },
    ];
    for (const input of corrections) {
      const outcome = await executeTool(ctx, call("book_appointment", input));
      assert.ok(!outcome.ok && outcome.code === "conflict", `${JSON.stringify(input)}: ${outcome.say}`);
      assert.match(outcome.say, /already booked this time/);
      assert.match(outcome.say, ASK_FIRST);
    }
    assert.equal(ctx.counters.bookings, 1);
    assert.equal(ctx.outcomes.length, 1);
  });

  it("a correction of the name AND the contact holds one table, not two (the verifier's probe)", async () => {
    const ctx = makeContext(RESTAURANT);
    const misheard = { ...COLLINS, name: "Sara Moller", contact: "+41780000044" };
    const first = await executeTool(ctx, call("book_appointment", misheard));
    assert.ok(first.ok, first.say);
    for (const corrected of [
      { ...misheard, name: "Sarah Müller", contact: "+41780000045" },
      { ...misheard, name: "Sarah Müller", contact: "sara@example.ch" },
    ]) {
      const outcome = await executeTool(ctx, call("book_appointment", corrected));
      assert.ok(!outcome.ok && outcome.code === "conflict", `${JSON.stringify(corrected)}: ${outcome.say}`);
      assert.match(outcome.say, new RegExp(`already booked this time: Tuesday 15 December 2026 at 13:30, reference ${refOf(first)}`));
      assert.match(outcome.say, /cancel reference MV-[2-9A-HJ-NP-Z]{4} with cancel_appointment, then book again/);
    }
    assert.equal(ctx.counters.bookings, 1);
    assert.equal(ctx.outcomes.filter((outcome) => outcome.kind === "booking").length, 1);
    // Eight seats would have been held for one party: only four are.
    const check = await executeTool(ctx, call("check_availability", { service: "table", date: "2026-12-15", party_size: 8 }));
    assert.ok(check.ok, check.say);
  });

  it("marked as another group under a name that already holds the time, it is still the same booking", async () => {
    const ctx = makeContext(RESTAURANT);
    const first = await executeTool(ctx, call("book_appointment", COLLINS));
    const marked = await executeTool(ctx, call("book_appointment", { ...COLLINS, name: "COLLINS Sarah", contact: "+41780000099", separate_party: true }));
    assert.ok(!marked.ok && marked.code === "conflict", marked.say);
    assert.match(marked.say, new RegExp(`reference ${refOf(first)}`));
    assert.match(marked.say, /This name already holds this time, so it is not another group/);
    assert.equal(ctx.counters.bookings, 1);
  });

  it("with two tables at one time, a correction names the booking with the same contact", async () => {
    const ctx = makeContext(RESTAURANT);
    const collins = await executeTool(ctx, call("book_appointment", COLLINS));
    const meier = await executeTool(ctx, call("book_appointment", MEIER_GROUP));
    assert.ok(collins.ok && meier.ok, meier.say);
    const corrected = await executeTool(ctx, call("book_appointment", { ...MEIER, name: "Petra Maier", party_size: 5 }));
    assert.ok(!corrected.ok && corrected.code === "conflict", corrected.say);
    assert.match(corrected.say, new RegExp(`reference ${refOf(meier)}`));
  });

  it("the mark exists only where a time holds several bookings", () => {
    const seats = Object.fromEntries(toolDefinitions(RESTAURANT).map((tool) => [tool.name, tool]));
    assert.equal((seats.book_appointment.inputSchema.properties.separate_party as { type: string }).type, "boolean");
    assert.ok(!seats.book_appointment.inputSchema.required.includes("separate_party"));
    const single = Object.fromEntries(toolDefinitions(SALON).map((tool) => [tool.name, tool]));
    assert.ok(!("separate_party" in single.book_appointment.inputSchema.properties));
    const refused = validateToolInput(SALON, "book_appointment", { ...BOOK_INPUT, separate_party: true }, { now: NOW });
    assert.ok(!refused.ok);
    const kept = validateToolInput(RESTAURANT, "book_appointment", MEIER_GROUP, { now: NOW });
    assert.ok(kept.ok && kept.value.separate_party === true);
    const dropped = validateToolInput(RESTAURANT, "book_appointment", { ...MEIER, separate_party: false }, { now: NOW });
    assert.ok(dropped.ok && !("separate_party" in dropped.value));
    assert.ok(!validateToolInput(RESTAURANT, "book_appointment", { ...MEIER, separate_party: "yes" }, { now: NOW }).ok);
  });

  it("where one time takes one booking, another name and contact are refused as already booked", async () => {
    const ctx = makeContext();
    const first = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(first.ok);
    const other = await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, name: "Peter Meier", contact: "peter@example.ch" }));
    assert.ok(!other.ok && other.code === "conflict", other.say);
    assert.match(other.say, new RegExp(`already booked this time: .*reference ${refOf(first)}`));
    assert.match(other.say, /This time takes only one booking: for someone else, check availability and offer other times\./);
    assert.equal(ctx.counters.bookings, 1);
  });

  it("who a booking is for travels with the replay memory as hashes; an older snapshot counts as the same person", async () => {
    const ctx = makeContext(RESTAURANT);
    assert.ok((await executeTool(ctx, call("book_appointment", COLLINS))).ok);
    const snapshot = exportToolMemory(ctx.counters);
    const text = JSON.stringify(snapshot);
    assert.ok(!text.includes("Collins") && !text.includes("780000044"), "no name or number in the memory");
    // The next request of the session, with the memory restored onto new counters.
    const next = makeContext(RESTAURANT, { calendar: ctx.calendar });
    importToolMemory(next.counters, snapshot);
    assert.ok((await executeTool(next, call("book_appointment", MEIER_GROUP))).ok);
    const sameName = await executeTool(next, call("book_appointment", { ...COLLINS, contact: "+41780000046", separate_party: true }));
    assert.ok(!sameName.ok && sameName.code === "conflict", sameName.say);
    // A snapshot written before people were remembered: the safe direction, a correction.
    const old = makeContext(RESTAURANT, { calendar: ctx.calendar });
    const [[ref, booking]] = snapshot.bookings ?? [];
    importToolMemory(old.counters, { ...snapshot, bookings: [[ref, { ...booking, person: undefined }]] });
    const unknown = await executeTool(old, call("book_appointment", { ...MEIER_GROUP, name: "Lea Frei", contact: "lea@example.ch" }));
    assert.ok(!unknown.ok && unknown.code === "conflict", unknown.say);
  });
});

describe("review correttezza/F3: a repeat at the cap is not reported as not done", () => {
  it("a repeated booking at the booking cap answers with the booking", async () => {
    const ctx = makeContext(SALON, { limits: { ...DEFAULT_VOICE_LIMITS, bookingsPerSession: 1 } });
    const first = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    const again = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(first.ok && again.ok, again.say);
    assert.equal(again.data?.reference, first.data?.reference);
    // A genuinely new booking is still capped.
    const other = await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, start: "2026-12-03T15:30:00+01:00" }));
    assert.ok(!other.ok && other.code === "limit_reached");
  });

  it("two bookings, then a repeat of the first, with the default cap of two", async () => {
    const ctx = makeContext(SALON, { limits: { ...DEFAULT_VOICE_LIMITS, bookingsPerSession: 2 } });
    const first = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok((await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, start: "2026-12-03T15:30:00+01:00" }))).ok);
    const repeat = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(repeat.ok, repeat.say);
    assert.equal(refOf(repeat), refOf(first));
  });

  it("a repeated lead at the lead cap answers with the first answer, and the sink holds it once", async () => {
    const ctx = makeContext(SALON, { limits: { ...DEFAULT_VOICE_LIMITS, leadsPerSession: 1 } });
    const first = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    const again = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    assert.ok(first.ok);
    assert.deepEqual(again, first);
    assert.equal(ctx.memorySinks.leads.length, 1);
  });

  it("with the caps in a store, a failed action gives its unit back", async () => {
    const taken: string[] = [];
    const given: string[] = [];
    const caps = {
      async take(kind: string) {
        taken.push(kind);
        return true;
      },
      async giveBack(kind: string) {
        given.push(kind);
      },
    };
    const sinks: ToolSinks = { ...createMemorySinks(), lead: async () => ({ ok: false, ref: "" }) };
    const ctx = makeContext(SALON, { caps, sinks });
    assert.equal((await executeTool(ctx, call("create_lead", LEAD_INPUT))).ok, false);
    assert.deepEqual(taken, ["toolCalls", "leads"]);
    assert.deepEqual(given, ["leads"]);
  });
});

describe("review correttezza/F4: moves are recorded as moves, always with the latest time", () => {
  it("book, move away and move back: one booking and two moves, the last at the real time", async () => {
    const ctx = makeContext(RESTAURANT);
    const booked = await executeTool(ctx, call("book_appointment", { service: "table", start: "2026-12-15T13:30:00+01:00", name: "Sarah Collins", contact: "+41780000044", party_size: 4 }));
    const ref = refOf(booked);
    const away = await executeTool(ctx, call("reschedule_appointment", { reference: ref, name: "Sarah Collins", new_start: "2026-12-16T13:30:00+01:00" }));
    const back = await executeTool(ctx, call("reschedule_appointment", { reference: ref, name: "Sarah Collins", new_start: "2026-12-15T13:30:00+01:00" }));
    assert.ok(away.ok && back.ok, back.say);
    assert.deepEqual(
      ctx.outcomes.map((outcome) => (outcome.kind === "booking" || outcome.kind === "reschedule" ? [outcome.kind, outcome.booking.ref, outcome.booking.start] : [outcome.kind])),
      [
        ["booking", ref, "2026-12-15T13:30:00+01:00"],
        ["reschedule", ref, "2026-12-16T13:30:00+01:00"],
        ["reschedule", ref, "2026-12-15T13:30:00+01:00"],
      ],
    );
    // A repeat of the last move changes nothing and records nothing.
    await executeTool(ctx, call("reschedule_appointment", { reference: ref, name: "Sarah Collins", new_start: "2026-12-15T13:30:00+01:00" }));
    assert.equal(ctx.outcomes.length, 3);
  });

  it("a booking moved to a time of its own conversation cannot be booked twice there", async () => {
    const ctx = makeContext();
    const booked = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    const ref = refOf(booked);
    assert.ok((await executeTool(ctx, call("reschedule_appointment", { reference: ref, name: "Anna Muster", new_start: "2026-12-04T10:00:00+01:00" }))).ok);
    const again = await executeTool(ctx, call("book_appointment", { ...BOOK_INPUT, start: "2026-12-04T10:00:00+01:00" }));
    assert.ok(!again.ok && again.code === "conflict");
    assert.match(again.say, /already booked this time/);
  });
});

describe("review correttezza/F5: a transfer target follows the tenant's holidays and special days", () => {
  const OWNER_WEEK = { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: [], sun: [] };
  const withTarget = (extra: Partial<{ onCall: boolean }> = {}, hours: BusinessHours = HOURS) =>
    makeTenant({
      hours,
      handoff: {
        ...SALON.handoff,
        transfer: { enabled: true, ringSeconds: 20, targets: [{ id: "owner", label: { de: "die Inhaberin" }, number: OWNER_NUMBER, available: OWNER_WEEK, ...extra }] },
      },
    });

  it("rings nobody on a holiday, even inside the target's own hours", async () => {
    const christmas = new Date("2026-12-25T09:00:00Z"); // a Friday, 10:00 in Zurich
    const ctx = makeContext(withTarget(), { now: christmas, sinks: createMemorySinks({ transferConnected: true }) });
    const outcome = await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Question" }));
    assert.ok(!outcome.ok && outcome.code === "not_available");
    assert.equal(ctx.memorySinks.transfers.length, 0);
  });

  it("on a day with special hours, rings only inside them", async () => {
    const shortDay: BusinessHours = { ...HOURS, exceptions: [{ date: "2026-12-24", ranges: [{ from: "09:00", to: "12:00" }] }] };
    const morning = makeContext(withTarget({}, shortDay), { now: new Date("2026-12-24T09:00:00Z"), sinks: createMemorySinks({ transferConnected: true }) });
    assert.ok((await executeTool(morning, call("transfer_call", { target: "owner", reason: "Question" }))).ok);
    const afternoon = makeContext(withTarget({}, shortDay), { now: new Date("2026-12-24T13:30:00Z"), sinks: createMemorySinks({ transferConnected: true }) });
    const late = await executeTool(afternoon, call("transfer_call", { target: "owner", reason: "Question" }));
    assert.ok(!late.ok && late.code === "not_available");
  });

  it("an on-call line follows its own hours, holidays included", async () => {
    const ctx = makeContext(withTarget({ onCall: true }), { now: new Date("2026-12-25T09:00:00Z"), sinks: createMemorySinks({ transferConnected: true }) });
    assert.ok((await executeTool(ctx, call("transfer_call", { target: "owner", reason: "Burst pipe" }))).ok);
  });
});

describe("review correttezza/F6: a foreign number written without its country code", () => {
  it("in an Italian call, a national-form number is not stored before the country is asked", async () => {
    const ctx = makeContext(SALON, { locale: "it" as const });
    const outcome = await executeTool(ctx, call("request_callback", { name: "Lucia Romano", phone: "02 1234 5678", topic: "Prezzi" }));
    assert.ok(!outcome.ok && outcome.code === "invalid_input");
    assert.match(outcome.say, /"phone" has no country code\. Ask the caller whether it is a Swiss number/);
    assert.equal(ctx.memorySinks.callbacks.length, 0);
    // Confirmed as Swiss, or given with its own country code, it goes through.
    assert.ok((await executeTool(ctx, call("request_callback", { name: "Lucia Romano", phone: "+41 21 234 56 78", topic: "Prezzi" }))).ok);
    assert.ok((await executeTool(ctx, call("request_callback", { name: "Lucia Romano", phone: "+39 02 1234 5678", topic: "Prezzi" }))).ok);
    const booked = await executeTool(ctx, call("book_appointment", BOOK_INPUT));
    assert.ok(!booked.ok && /"contact" has no country code/.test(booked.say));
  });

  it("a national-form number whose prefix is not Swiss is refused in any call", async () => {
    const ctx = makeContext();
    const outcome = await executeTool(ctx, call("request_callback", { name: "Anna Muster", phone: "035 123 45 67", topic: "Price" }));
    assert.ok(!outcome.ok && outcome.code === "invalid_input");
    assert.match(outcome.say, /"phone" is not a Swiss number\. If it is from another country, ask the caller for the country code/);
    // A German call keeps taking Swiss numbers as they are said.
    assert.ok((await executeTool(ctx, call("request_callback", { name: "Anna Muster", phone: "044 123 45 67", topic: "Price" }))).ok);
  });

  it("normalizePhone keeps only the prefixes of the Swiss numbering plan", () => {
    assert.equal(normalizePhone("035 123 45 67"), null);
    assert.equal(normalizePhone("0901 123 456"), null, "premium rate: a callback would cost the business");
    assert.equal(normalizePhone("06 1234 5678"), "+41612345678", "the shape of a Basel number: only the call's language tells");
    assert.equal(normalizePhone("0848 123 456"), "+41848123456");
    assert.equal(normalizePhone("+41 74 123 45 67"), "+41741234567", "with the country code, any Swiss number");
  });

  // Review finding S2-9: premium rate was refused only in the national form, and checkPhone's own
  // hint ("send it with +41") turned a refused 0900 into an accepted +41 900.
  it("normalizePhone refuses premium-rate numbers with the country code too", () => {
    for (const number of ["+41 900 123 456", "0041 906 123 456", "+41 901 234 567", "+41 (0)900 123 456", "+41 0900 123 456", "0900 123 456"]) {
      assert.equal(normalizePhone(number), null, number);
    }
    assert.equal(normalizePhone("+41 800 123 456"), "+41800123456", "free numbers stay");
    assert.equal(normalizePhone("+41 79 123 45 67"), "+41791234567");
  });
});

describe("review correttezza/F9, F11, F12: what a request needs", () => {
  it("a task that needs a phone or an email refuses a request with neither", async () => {
    const task: TaskDefinition = { ...GIFT_TASK, id: "one_way", contactAtLeastOne: ["phone", "email"] };
    const tenant = makeTenant({ tasks: [QUOTE_TASK, task] });
    const errors = errorsOf(validateToolInput(tenant, "create_lead", { task: "one_way", fields: { amount: "50" }, name: "Anna Muster", summary: "Gift" }));
    assert.match(errors, /"phone" or "email" is required for this task: ask the caller for one of them\./);
    assert.ok(validateToolInput(tenant, "create_lead", { task: "one_way", fields: { amount: "50" }, name: "Anna Muster", email: "anna@example.ch", summary: "Gift" }).ok);
  });

  it("a garbled detail the task does not ask for never blocks the request", () => {
    const noEmail: TaskDefinition = { ...GIFT_TASK, id: "gift_no_email", contact: { ...GIFT_TASK.contact, email: "none" } };
    const tenant = makeTenant({ tasks: [QUOTE_TASK, noEmail] });
    const value = valueOf(
      validateToolInput(tenant, "create_lead", { task: "gift_no_email", fields: { amount: "100" }, name: "Anna Muster", email: "weber at gmx", summary: "Gift" }),
    );
    assert.equal(value.email, undefined);
  });

  it("a date in the past is refused when the call's clock is known, unless the field allows it", () => {
    const past = { ...LEAD_INPUT, fields: { ...LEAD_INPUT.fields, event_date: "2025-12-18" } };
    assert.match(errorsOf(validateToolInput(SALON, "create_lead", past, { now: NOW })), /"fields\.event_date" lies in the past \(today is 2026-12-01\)/);
    assert.ok(validateToolInput(SALON, "create_lead", past).ok, "without a clock (the demo scripts) nothing is compared");
    assert.ok(validateToolInput(SALON, "create_lead", { ...past, fields: { ...past.fields, event_date: "2026-12-01" } }, { now: NOW }).ok, "today is fine");
    const accident: TaskDefinition = { ...QUOTE_TASK, fields: QUOTE_TASK.fields.map((field) => (field.id === "event_date" ? { ...field, allowPast: true } : field)) };
    assert.ok(validateToolInput(makeTenant({ tasks: [accident, GIFT_TASK] }), "create_lead", past, { now: NOW }).ok);
  });

  it("a departure before the arrival is refused", () => {
    const stay: TaskDefinition = {
      id: "room_request",
      label: { en: "Room request" },
      when: "The caller wants a room.",
      fields: [
        { id: "arrival_date", label: { en: "Arrival" }, type: "date", required: true },
        { id: "departure_date", label: { en: "Departure" }, type: "date", required: true, after: "arrival_date" },
      ],
      contact: { name: "required", phone: "required", email: "none", company: "none" },
    };
    const tenant = makeTenant({ tasks: [stay] });
    const input = (arrival: string, departure: string) => ({
      task: "room_request",
      fields: { arrival_date: arrival, departure_date: departure },
      name: "Anna Muster",
      phone: "079 123 45 67",
      summary: "Room",
    });
    assert.match(errorsOf(validateToolInput(tenant, "create_lead", input("2027-01-10", "2027-01-08"))), /"fields\.departure_date" must come after "fields\.arrival_date"/);
    assert.match(errorsOf(validateToolInput(tenant, "create_lead", input("2027-01-10", "2027-01-10"))), /must come after/);
    assert.ok(validateToolInput(tenant, "create_lead", input("2027-01-10", "2027-01-12")).ok);
  });
});

describe("review correttezza/F7: a request's follow-up in the tenant's own words", () => {
  it("uses the task's follow-up, else the written promise, else promises nothing the business information does not say", async () => {
    const withFollowUp = makeTenant({ tasks: [{ ...QUOTE_TASK, followUp: { de: "Wir melden uns am nächsten Arbeitstag.", en: "We get back to you on the next working day." } }, GIFT_TASK] });
    const ctx = makeContext(withFollowUp);
    const stored = await executeTool(ctx, call("create_lead", LEAD_INPUT));
    assert.ok(stored.ok);
    assert.match(stored.say, /About timing, say only: "Wir melden uns am nächsten Arbeitstag\."/);
    const plain = await executeTool(makeContext(), call("create_lead", LEAD_INPUT));
    assert.ok(plain.ok);
    assert.match(plain.say, /Do not promise when the business will get back, beyond what the business information states about requests\./);
  });
});

describe("review sicurezza/F11: a transfer label never carries the number", () => {
  it("the label is cleaned wherever it goes", () => {
    assert.equal(withoutPhoneNumbers("Inhaberin (052 123 45 67)"), "Inhaberin");
    assert.equal(withoutPhoneNumbers("Pikett +41 79 000 00 01"), "Pikett");
    assert.equal(withoutPhoneNumbers("Team 2"), "Team 2");
    assert.equal(hasPhoneNumber("Inhaberin (052 123 45 67)"), true);
    assert.equal(hasPhoneNumber("die Inhaberin"), false);
  });
});
