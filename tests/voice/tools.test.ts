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
import { isValidEmail, normalizePhone, validateToolInput } from "@/lib/voice/tools/validate";
import { createMemorySinks, executeTool, type ToolContext, type ToolSinks } from "@/lib/voice/tools/execute";

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
    const movedOutcome = ctx.outcomes[1];
    assert.ok(movedOutcome.kind === "booking" && movedOutcome.booking.start === "2026-12-04T10:00:00+01:00");

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
    assert.deepEqual(ctx.memorySinks.leads, [
      {
        tenant: "test-salon",
        sessionId: "session-1",
        taskId: "quote_request",
        fields: { occasion: "wedding", event_date: "2027-06-12", guests: "3" },
        contact: { name: "Anna Muster", phone: "+41791234567" },
        summary: LEAD_INPUT.summary,
        locale: "de",
      },
    ]);
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
