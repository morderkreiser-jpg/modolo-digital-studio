// The tools the model may call, as provider-neutral JSON Schema: the ONLY actions it can take.
//
// A tool exists for a tenant when it is listed in tenant.tools AND the tenant's configuration can
// carry it out (no calendar, no calendar tools; transfer off, no transfer_call...). The model never
// learns about the others, and validate.ts / execute.ts refuse them all the same.
//
// toolDefinitions() is deterministic: the same tenant always gives byte-identical output, because
// it becomes part of a cached prompt prefix. No clock, no randomness, no object-key order that
// depends on anything but the tenant data. Descriptions are English (they are for the model) and
// never contain transfer numbers, only the labels of the targets.
import { VOICE_LOCALES, VOICE_TOOLS } from "@/lib/voice/types";
import type {
  TaskDefinition,
  TaskField,
  VoiceLocale,
  VoiceTenantConfig,
  VoiceText,
  VoiceToolDefinition,
  VoiceToolName,
} from "@/lib/voice/types";

/** Longest accepted values of the free-text inputs (characters). validate.ts enforces the same. */
export const TOOL_TEXT_LIMITS = {
  name: 100,
  contact: 120,
  company: 120,
  notes: 500,
  summary: 1000,
  topic: 300,
  preferredTime: 100,
  reason: 200,
  reference: 20,
} as const;

/** Largest party the schemas accept at all; the calendar's maxPartySize is the real limit. */
export const MAX_PARTY_SIZE_INPUT = 100;
/** Default longest value of a task field, as in the TaskField contract. */
export const DEFAULT_FIELD_MAX_LENGTH = 200;

export const CONTACT_KEYS = ["name", "phone", "email", "company"] as const;
export type ContactKey = (typeof CONTACT_KEYS)[number];

const LANGUAGE_NAMES: Record<VoiceLocale, string> = { de: "German", it: "Italian", en: "English", fr: "French" };

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

// ---------------------------------------------------------------------------------------------
// Which tools exist for a tenant
// ---------------------------------------------------------------------------------------------

/** Whether the tenant's configuration can carry out this tool (regardless of tenant.tools). */
export function isToolUsable(tenant: VoiceTenantConfig, name: VoiceToolName): boolean {
  const calendar = tenant.calendar;
  const hasServices = !!calendar && Array.isArray(calendar.services) && calendar.services.length > 0;
  switch (name) {
    case "check_availability":
    case "book_appointment":
      return hasServices;
    case "cancel_appointment":
      return hasServices && calendar.allowCancel;
    case "reschedule_appointment":
      return hasServices && calendar.allowReschedule;
    case "create_lead":
      return Array.isArray(tenant.tasks) && tenant.tasks.length > 0;
    case "request_callback":
      return tenant.handoff.callback.enabled;
    case "transfer_call":
      return tenant.handoff.transfer.enabled && tenant.handoff.transfer.targets.length > 0;
    case "end_call":
      return true;
    default:
      return false;
  }
}

/** The tools this tenant offers the model, in the fixed order of VOICE_TOOLS. */
export function enabledTools(tenant: VoiceTenantConfig): VoiceToolName[] {
  const listed = new Set<string>(Array.isArray(tenant.tools) ? tenant.tools : []);
  return VOICE_TOOLS.filter((name) => listed.has(name) && isToolUsable(tenant, name));
}

/** True when the tenant's calendar shares seats between bookings (a restaurant): party_size matters. */
export function usesSeats(tenant: VoiceTenantConfig): boolean {
  return tenant.calendar?.capacity.kind === "seats";
}

/**
 * Contact keys create_lead accepts: those at least one task asks for. A key no task needs is not
 * in the schema, so the model is not tempted to collect it.
 */
export function leadContactKeys(tenant: VoiceTenantConfig): ContactKey[] {
  const tasks = Array.isArray(tenant.tasks) ? tenant.tasks : [];
  return CONTACT_KEYS.filter((key) => tasks.some((task) => task.contact?.[key] !== "none"));
}

/** Every field id of the tenant's tasks, in order of first appearance. */
export function leadFieldIds(tenant: VoiceTenantConfig): string[] {
  const ids: string[] = [];
  for (const task of tenant.tasks ?? []) {
    for (const field of task.fields ?? []) if (!ids.includes(field.id)) ids.push(field.id);
  }
  return ids;
}

/** A VoiceText in English if possible, else the tenant's default language, else the first one there. */
export function englishText(text: VoiceText | undefined, fallback: VoiceLocale): string {
  if (!text) return "";
  if (text.en) return text.en;
  if (text[fallback]) return text[fallback] as string;
  for (const locale of VOICE_LOCALES) if (text[locale]) return text[locale] as string;
  return "";
}

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

export function toolDefinitions(tenant: VoiceTenantConfig): VoiceToolDefinition[] {
  return enabledTools(tenant).map((name) => define(tenant, name));
}

function define(tenant: VoiceTenantConfig, name: VoiceToolName): VoiceToolDefinition {
  switch (name) {
    case "check_availability":
      return checkAvailability(tenant);
    case "book_appointment":
      return bookAppointment(tenant);
    case "cancel_appointment":
      return cancelAppointment();
    case "reschedule_appointment":
      return rescheduleAppointment();
    case "create_lead":
      return createLead(tenant);
    case "request_callback":
      return requestCallback();
    case "transfer_call":
      return transferCall(tenant);
    case "end_call":
      return endCall();
  }
}

function tool(
  name: VoiceToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): VoiceToolDefinition {
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

function text(description: string, maxLength: number): Record<string, unknown> {
  return { type: "string", description, minLength: 1, maxLength };
}

function serviceProperty(tenant: VoiceTenantConfig): Record<string, unknown> {
  const services = tenant.calendar?.services ?? [];
  const list = services
    .map((service) => `${service.id} (${englishText(service.label, tenant.defaultLocale)}, ${service.durationMinutes} min)`)
    .join("; ");
  return {
    type: "string",
    enum: services.map((service) => service.id),
    description: `The service id: ${list}.`,
  };
}

function partySizeProperty(tenant: VoiceTenantConfig): Record<string, unknown> {
  const capacity = tenant.calendar?.capacity;
  const max = capacity?.kind === "seats" ? capacity.maxPartySize : MAX_PARTY_SIZE_INPUT;
  return {
    type: "integer",
    minimum: 1,
    maximum: MAX_PARTY_SIZE_INPUT,
    description: `Number of people. Groups larger than ${max} cannot be booked here.`,
  };
}

function personName(description: string): Record<string, unknown> {
  return text(description, TOOL_TEXT_LIMITS.name);
}

function checkAvailability(tenant: VoiceTenantConfig): VoiceToolDefinition {
  const seats = usesSeats(tenant);
  const properties: Record<string, unknown> = {
    service: serviceProperty(tenant),
    date: {
      type: "string",
      pattern: DATE_PATTERN,
      description:
        "The day, YYYY-MM-DD, in the business's time zone. Work out words like \"tomorrow\" or \"next Tuesday\" from today's date.",
    },
  };
  if (seats) properties.party_size = partySizeProperty(tenant);
  properties.part_of_day = {
    type: "string",
    enum: ["morning", "afternoon", "evening"],
    description: "Only when the caller named one: morning is before 12:00, afternoon 12:00 to 17:00, evening from 17:00.",
  };
  return tool(
    "check_availability",
    "Looks up the free start times for one service on one day. Call it before offering or booking any time: " +
      "never guess or promise availability. Offer the caller two or three of the times it returns, not the whole list." +
      (seats ? " Ask how many people first." : ""),
    properties,
    seats ? ["service", "date", "party_size"] : ["service", "date"],
  );
}

function bookAppointment(tenant: VoiceTenantConfig): VoiceToolDefinition {
  const seats = usesSeats(tenant);
  const properties: Record<string, unknown> = {
    service: serviceProperty(tenant),
    start: {
      type: "string",
      description: "The exact start value of a free time that check_availability returned in this conversation.",
    },
    name: personName("The caller's first and last name."),
    contact: text(
      "A phone number (e.g. 079 123 45 67 or +41 79 123 45 67; a number from another country always with its country code, e.g. +39 ...) or an email address where the business can reach the caller.",
      TOOL_TEXT_LIMITS.contact,
    ),
  };
  if (seats) properties.party_size = partySizeProperty(tenant);
  properties.notes = {
    type: "string",
    maxLength: TOOL_TEXT_LIMITS.notes,
    description: "Anything the caller wants the business to know for this appointment. Optional.",
  };
  return tool(
    "book_appointment",
    "Books one appointment. Use only a start time that check_availability returned in this conversation. " +
      "Before calling, read back the service, the day and time, " +
      (seats ? "the number of people, " : "") +
      "the name and the contact details, and wait for the caller's yes. " +
      "Never say the appointment is booked unless this tool answered ok; then give the caller the reference it returned.",
    properties,
    seats ? ["service", "start", "name", "contact", "party_size"] : ["service", "start", "name", "contact"],
  );
}

function referenceProperty(): Record<string, unknown> {
  return text("The booking reference the caller was given, like MV-7K2Q.", TOOL_TEXT_LIMITS.reference);
}

function cancelAppointment(): VoiceToolDefinition {
  return tool(
    "cancel_appointment",
    "Cancels an existing appointment. Needs the booking reference and the name the booking was made under. " +
      "Before calling, say which appointment will be cancelled and wait for the caller's yes. " +
      "Never say it is cancelled unless this tool answered ok.",
    { reference: referenceProperty(), name: personName("The name the booking was made under.") },
    ["reference", "name"],
  );
}

function rescheduleAppointment(): VoiceToolDefinition {
  return tool(
    "reschedule_appointment",
    "Moves an existing appointment to a new start time. First call check_availability for the new day and use one of " +
      "the times it returned. Needs the booking reference and the name the booking was made under. Before calling, read " +
      "back the new day and time and wait for the caller's yes. Never say the appointment was moved unless this tool " +
      "answered ok; when it fails, the appointment stays as it was.",
    {
      reference: referenceProperty(),
      name: personName("The name the booking was made under."),
      new_start: {
        type: "string",
        description: "The exact start value of a free time that check_availability returned in this conversation.",
      },
    },
    ["reference", "name", "new_start"],
  );
}

function createLead(tenant: VoiceTenantConfig): VoiceToolDefinition {
  const tasks = tenant.tasks;
  const fallback = tenant.defaultLocale;
  const taskLines = tasks.map((task) => `- ${task.id}: ${task.when} ${describeTask(task, fallback)}`).join("\n");

  const fieldProperties: Record<string, unknown> = {};
  for (const id of leadFieldIds(tenant)) {
    const uses = tasks.flatMap((task) =>
      (task.fields ?? []).filter((field) => field.id === id).map((field) => ({ task, field })),
    );
    const maxLength = Math.max(...uses.map(({ field }) => field.maxLength ?? DEFAULT_FIELD_MAX_LENGTH));
    const description =
      uses.length === 1
        ? describeField(uses[0].field, fallback)
        : uses.map(({ task, field }) => `For ${task.id}: ${describeField(field, fallback)}`).join(" ");
    fieldProperties[id] = { type: "string", maxLength, description };
  }

  const properties: Record<string, unknown> = {
    task: {
      type: "string",
      enum: tasks.map((task) => task.id),
      description: "The task that matches what the caller wants.",
    },
    fields: {
      type: "object",
      description: "The details of the chosen task, by field id, all as text. Only fields of that task.",
      properties: fieldProperties,
      additionalProperties: false,
    },
  };
  const contactDescriptions: Record<ContactKey, Record<string, unknown>> = {
    name: personName("The caller's first and last name."),
    phone: text("The caller's phone number, e.g. 079 123 45 67 or +41 79 123 45 67; a number from another country always with its country code.", 40),
    email: text("The caller's email address.", 254),
    company: text("The caller's company, if they call for one.", TOOL_TEXT_LIMITS.company),
  };
  for (const key of leadContactKeys(tenant)) properties[key] = contactDescriptions[key];
  properties.summary = text(
    `Two or three sentences for the team about what the caller wants, written in ${LANGUAGE_NAMES[tenant.defaultLocale]}.`,
    TOOL_TEXT_LIMITS.summary,
  );

  return tool(
    "create_lead",
    "Stores a request and passes it on to the team in writing. Tasks:\n" +
      taskLines +
      "\nAsk only for the details the task needs. Before calling, read the details back and wait for the caller's yes. " +
      "Never say the request was stored or passed on unless this tool answered ok.",
    properties,
    ["task", "summary"],
  );
}

function describeTask(task: TaskDefinition, fallback: VoiceLocale): string {
  const fields = task.fields ?? [];
  const required = fields.filter((field) => field.required).map((field) => field.id);
  const optional = fields.filter((field) => !field.required).map((field) => field.id);
  const contact = CONTACT_KEYS.filter((key) => task.contact?.[key] !== "none")
    .map((key) => `${key} ${task.contact[key]}`)
    .join(", ");
  const parts = [
    `(${englishText(task.label, fallback)})`,
    `Required fields: ${required.length > 0 ? required.join(", ") : "none"}.`,
  ];
  if (optional.length > 0) parts.push(`Optional fields: ${optional.join(", ")}.`);
  parts.push(`Contact: ${contact === "" ? "none needed" : contact}.`);
  return parts.join(" ");
}

function describeField(field: TaskField, fallback: VoiceLocale): string {
  const label = englishText(field.label, fallback) || field.id;
  const confirm = field.confirm ? " Read it back and get a yes." : "";
  return `${label}. ${typeHint(field, fallback)}${confirm}`;
}

function typeHint(field: TaskField, fallback: VoiceLocale): string {
  switch (field.type) {
    case "text":
      return "Free text.";
    case "name":
      return "A person's name.";
    case "phone":
      return "A phone number, e.g. 079 123 45 67; a number from another country always with its country code.";
    case "email":
      return "An email address.";
    case "date":
      return "A date as YYYY-MM-DD.";
    case "time":
      return "A time as HH:MM, 24-hour clock.";
    case "integer": {
      const bounds =
        field.min !== undefined && field.max !== undefined
          ? ` from ${field.min} to ${field.max}`
          : field.min !== undefined
            ? ` of at least ${field.min}`
            : field.max !== undefined
              ? ` of at most ${field.max}`
              : "";
      return `A whole number${bounds}, as digits.`;
    }
    case "boolean":
      return 'Either "yes" or "no".';
    case "choice": {
      const choices = (field.choices ?? [])
        .map((choice) => `${choice.id} (${englishText(choice.label, fallback)})`)
        .join(", ");
      return `One of these ids: ${choices}.`;
    }
    case "address":
      return "Street and number, postcode and town.";
    case "locality":
      return "Postcode and town.";
    default:
      return "Text.";
  }
}

function requestCallback(): VoiceToolDefinition {
  return tool(
    "request_callback",
    "Asks a person from the business to call the caller back: when the caller wants a person and no transfer is " +
      "possible, or for a question you cannot answer. Before calling, read back the name and the number and wait for " +
      "the caller's yes. Never say the callback request was passed on unless this tool answered ok, and promise no " +
      "time beyond the wording this tool gives you.",
    {
      name: personName("The caller's first and last name."),
      phone: text("The number to call back, e.g. 079 123 45 67 or +41 79 123 45 67; a number from another country always with its country code.", 40),
      topic: text("What the call back is about, in a few words.", TOOL_TEXT_LIMITS.topic),
      preferred_time: {
        type: "string",
        maxLength: TOOL_TEXT_LIMITS.preferredTime,
        description: "When the caller would like to be called, in their words (e.g. \"tomorrow morning\"). Optional.",
      },
    },
    ["name", "phone", "topic"],
  );
}

function transferCall(tenant: VoiceTenantConfig): VoiceToolDefinition {
  const targets = tenant.handoff.transfer.targets;
  const list = targets.map((target) => `${target.id} (${englishText(target.label, tenant.defaultLocale)})`).join("; ");
  return tool(
    "transfer_call",
    "Puts a phone caller through to a person now. Only on phone calls, and only when the caller asks for a person or " +
      "the situation needs one. Tell the caller you are connecting them before calling. If this tool does not answer " +
      "ok, the caller was not put through: offer what the tool suggests instead.",
    {
      target: { type: "string", enum: targets.map((target) => target.id), description: `Who to put the caller through to: ${list}.` },
      reason: text("Why the caller needs a person, in a few words.", TOOL_TEXT_LIMITS.reason),
    },
    ["target", "reason"],
  );
}

function endCall(): VoiceToolDefinition {
  return tool(
    "end_call",
    "Ends the conversation. Call it after your goodbye when the caller has nothing more (caller_done), after the " +
      "caller stayed silent several times (no_response), after repeated abuse (abuse), or when the time limit is " +
      "reached (limit).",
    { reason: { type: "string", enum: ["caller_done", "no_response", "abuse", "limit"], description: "Why the conversation ends." } },
    ["reason"],
  );
}
