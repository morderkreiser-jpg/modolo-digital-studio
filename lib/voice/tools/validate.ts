// Server-side validation of tool inputs. The JSON Schemas in definitions.ts tell the model what to
// send; nothing guarantees it does, so every input is checked again here, by hand (no library), and
// normalised before anything acts on it:
//   - unknown tool, unknown property, wrong type, missing required detail: an error each;
//   - ids (service, task, target, choice) only from THIS tenant's configuration;
//   - phone numbers to E.164, emails lower-cased, start times to the tenant's ISO form, strings
//     trimmed and stripped of control characters; free text capped, identity data refused when
//     too long.
// Errors are short English sentences naming the detail, written for the model: execute.ts hands
// them back so it can ask the caller again. They never echo the caller's values.
//
// One check needs the call itself (ValidationOptions), and is skipped without it:
//   - `now`: a date a caller leaves with a request must not lie in the past (TaskField.allowPast).
//
// Phone numbers arrive as the caller said them and are completed here, never by the model: a
// number without a country code is a Swiss one when it fits the Swiss numbering plan, in every
// language. (It used to be refused outside German calls, so that the model would ask and then
// send it with +41. With the real model that cost requests when the caller left before the
// answer, and digits when the model rewrote the number: "+39 02 ..." lost its zero, "45" became
// "46". That a Milan "02 1234 5678" has the shape of a Lausanne number is now covered by the
// assistant saying "a Swiss number" while it reads the number back.)
//
// Pure: no I/O, safe to import from scripts and tests (the demo scripts are replayed through it).
import { isVoiceToolName } from "@/lib/voice/types";
import type { TaskDefinition, TaskField, VoiceTenantConfig, VoiceText } from "@/lib/voice/types";
import { isValidDate, parseIsoInstant, toZonedIso, wallTimeToEpoch, zonedParts } from "@/lib/voice/hours";
import { normalizeBookingRef } from "@/lib/voice/calendar/memory";
import {
  CONTACT_KEYS,
  DEFAULT_FIELD_MAX_LENGTH,
  MAX_PARTY_SIZE_INPUT,
  TOOL_TEXT_LIMITS,
  enabledTools,
  leadContactKeys,
  leadFieldIds,
  usesSeats,
} from "./definitions";

export type ToolValidation = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

/** What validation knows about the call (see the header). */
export interface ValidationOptions {
  /** The call's clock. */
  now?: Date;
}

type Input = Record<string, unknown>;

interface Checks {
  options: ValidationOptions;
  timezone: string;
}

/**
 * The Swiss numbering plan: the digits after the trunk zero of every number a caller can be
 * reached on. Geographic codes, 058 (company networks), 051 (railways), mobile 075 to 079, and the
 * free and shared-cost service numbers. Premium-rate numbers (090x) are left out on purpose: a
 * business calling one back would pay for it.
 */
const SWISS_PREFIXES_2 = new Set([
  "21", "22", "24", "26", "27", "31", "32", "33", "34", "41", "43", "44", "51", "52", "55", "56", "58",
  "61", "62", "71", "75", "76", "77", "78", "79", "81", "91",
]);
const SWISS_PREFIXES_3 = new Set(["800", "840", "842", "844", "848", "878"]);
/** Premium-rate numbers (0900, 0901, 0906, ...), after the trunk zero or the country code. */
const PREMIUM_RATE = /^90/;

const PART_OF_DAY = ["morning", "afternoon", "evening"] as const;
const END_REASONS = ["caller_done", "no_response", "abuse", "limit"] as const;
const YES_WORDS = new Set(["yes", "y", "true", "ja", "j", "si", "oui", "1"]);
const NO_WORDS = new Set(["no", "n", "false", "nein", "non", "0"]);
const LOCAL_START = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME_INPUT = /^(\d{1,2})[:.h](\d{2})$/;
const INTEGER_INPUT = /^[+-]?\d{1,9}$/;
const PHONE_CHARS = /^[+\d\s().\/-]+$/;
const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
const TOP_LEVEL_DOMAIN = /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;
// C0/C1 controls, zero-width characters and bidirectional overrides (they can disguise text).
const INVISIBLE = /[\p{Cc}​-‏‪-‮⁠-⁤⁦-⁩﻿]+/gu;

export function validateToolInput(
  tenant: VoiceTenantConfig,
  name: string,
  input: unknown,
  options: ValidationOptions = {},
): ToolValidation {
  if (!isVoiceToolName(name) || !enabledTools(tenant).includes(name)) {
    return { ok: false, errors: [`Unknown tool "${clip(String(name))}".`] };
  }
  if (!isPlainObject(input)) return { ok: false, errors: ["The input must be an object."] };

  const errors: string[] = [];
  const checks: Checks = { options, timezone: tenant.hours?.timezone ?? "Europe/Zurich" };
  let value: Record<string, unknown>;
  switch (name) {
    case "check_availability":
      value = checkAvailability(tenant, input, errors);
      break;
    case "book_appointment":
      value = bookAppointment(tenant, input, errors);
      break;
    case "cancel_appointment":
      value = cancelAppointment(input, errors);
      break;
    case "reschedule_appointment":
      value = rescheduleAppointment(tenant, input, errors);
      break;
    case "create_lead":
      value = createLead(tenant, input, errors, checks);
      break;
    case "request_callback":
      value = requestCallback(input, errors);
      break;
    case "transfer_call":
      value = transferCall(tenant, input, errors);
      break;
    case "end_call":
      value = endCall(input, errors);
      break;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

// ---------------------------------------------------------------------------------------------
// Per tool
// ---------------------------------------------------------------------------------------------

function checkAvailability(tenant: VoiceTenantConfig, input: Input, errors: string[]): Record<string, unknown> {
  const seats = usesSeats(tenant);
  onlyKeys(input, seats ? ["service", "date", "party_size", "part_of_day"] : ["service", "date", "part_of_day"], "", errors);
  const value: Record<string, unknown> = {
    service: serviceId(tenant, input, errors),
    date: dateValue(input, "date", errors),
  };
  if (seats) value.party_size = partySize(input, errors);
  const part = oneOf(input, "part_of_day", PART_OF_DAY, false, errors);
  if (part !== undefined) value.part_of_day = part;
  return value;
}

function bookAppointment(tenant: VoiceTenantConfig, input: Input, errors: string[]): Record<string, unknown> {
  const seats = usesSeats(tenant);
  const keys = ["service", "start", "name", "contact", "notes"];
  if (seats) keys.push("party_size", "separate_party");
  onlyKeys(input, keys, "", errors);
  const value: Record<string, unknown> = {
    service: serviceId(tenant, input, errors),
    start: startValue(tenant, input, "start", errors),
    name: personName(input, "name", true, errors),
    contact: contactValue(input, errors),
  };
  if (seats) value.party_size = partySize(input, errors);
  const notes = freeText(input, "notes", TOOL_TEXT_LIMITS.notes, false, errors);
  if (notes !== undefined) value.notes = notes;
  // Only "true" is kept: false and absent mean the same (execute.ts, review finding S2-11).
  if (seats && flagValue(input, "separate_party", errors) === true) value.separate_party = true;
  return value;
}

/** An optional yes/no flag: a boolean (or the words "true"/"false" some models send), else absent. */
function flagValue(input: Input, key: string, errors: string[]): boolean | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "false") return raw === "true";
  errors.push(`"${key}" must be true or false.`);
  return undefined;
}

function cancelAppointment(input: Input, errors: string[]): Record<string, unknown> {
  onlyKeys(input, ["reference", "name"], "", errors);
  return { reference: reference(input, errors), name: personName(input, "name", true, errors) };
}

function rescheduleAppointment(tenant: VoiceTenantConfig, input: Input, errors: string[]): Record<string, unknown> {
  onlyKeys(input, ["reference", "name", "new_start"], "", errors);
  return {
    reference: reference(input, errors),
    name: personName(input, "name", true, errors),
    new_start: startValue(tenant, input, "new_start", errors),
  };
}

function createLead(tenant: VoiceTenantConfig, input: Input, errors: string[], checks: Checks): Record<string, unknown> {
  const contactKeys = leadContactKeys(tenant);
  onlyKeys(input, ["task", "fields", "summary", ...contactKeys], "", errors);

  const taskId = stringValue(input, "task", true, errors);
  const task = taskId === undefined ? undefined : tenant.tasks.find((candidate) => candidate.id === taskId);
  if (taskId !== undefined && task === undefined) {
    errors.push(`"task" must be one of: ${tenant.tasks.map((candidate) => candidate.id).join(", ")}.`);
  }

  const fieldsInput = input.fields === undefined || input.fields === null ? {} : input.fields;
  const fields: Record<string, string> = {};
  if (!isPlainObject(fieldsInput)) {
    errors.push('"fields" must be an object of texts.');
  } else {
    const knownIds = leadFieldIds(tenant);
    onlyKeys(fieldsInput, knownIds, "fields.", errors);
    if (task) collectFields(task, fieldsInput, knownIds, fields, errors, checks);
  }

  const value: Record<string, unknown> = { task: taskId, fields };
  for (const key of CONTACT_KEYS) {
    if (!contactKeys.includes(key)) continue;
    const need = task?.contact?.[key] ?? "optional";
    // Data minimisation: a detail this task does not need is dropped, not stored, and not even
    // checked, so a garbled detail nobody asked for cannot block the request.
    if (need === "none") continue;
    const given = contactDetail(input, key, errors);
    if (given === undefined) {
      if (need === "required" && task) errors.push(`"${key}" is required for this task.`);
      continue;
    }
    value[key] = given;
  }
  // Optional one by one, but not all of them: without a phone or an email nobody can answer.
  const oneOf = (task?.contactAtLeastOne ?? []).filter((key) => contactKeys.includes(key) && task?.contact?.[key] !== "none");
  if (oneOf.length > 0 && !oneOf.some((key) => value[key] !== undefined) && !oneOf.some((key) => input[key] !== undefined && input[key] !== null)) {
    errors.push(`${oneOf.map((key) => `"${key}"`).join(" or ")} is required for this task: ask the caller for one of them.`);
  }
  value.summary = freeText(input, "summary", TOOL_TEXT_LIMITS.summary, true, errors);
  return value;
}

function collectFields(
  task: TaskDefinition,
  input: Input,
  knownIds: readonly string[],
  out: Record<string, string>,
  errors: string[],
  checks: Checks,
): void {
  const own = new Set((task.fields ?? []).map((field) => field.id));
  for (const key of Object.keys(input)) {
    // A field of another task of this tenant is in the schema but not in this task. (Ids unknown
    // to the tenant were reported by onlyKeys already.) An empty value is just an unused slot.
    const empty = input[key] === undefined || input[key] === null || input[key] === "";
    if (!own.has(key) && knownIds.includes(key) && !empty) {
      errors.push(`"fields.${clip(key)}" does not belong to task "${task.id}".`);
    }
  }
  for (const field of task.fields ?? []) {
    const where = `fields.${field.id}`;
    const raw = input[field.id];
    if (raw === undefined || raw === null) {
      if (field.required) errors.push(`"${where}" (${labelOf(field.label, field.id)}) is required.`);
      continue;
    }
    if (typeof raw !== "string") {
      errors.push(`"${where}" must be a string.`);
      continue;
    }
    const text = cleanText(raw);
    if (text === "") {
      if (field.required) errors.push(`"${where}" (${labelOf(field.label, field.id)}) is required.`);
      continue;
    }
    const normalised = fieldValue(field, text, where, errors, checks);
    if (normalised !== null) out[field.id] = normalised;
  }
  // Date pairs: a departure before (or on) the arrival is a misheard date, not a stay.
  for (const field of task.fields ?? []) {
    if (field.type !== "date" || field.after === undefined) continue;
    const later = out[field.id];
    const earlier = out[field.after];
    if (later !== undefined && earlier !== undefined && !(later > earlier)) {
      errors.push(`"fields.${field.id}" must come after "fields.${clip(field.after)}". Ask the caller for both dates again.`);
      delete out[field.id];
    }
  }
}

function requestCallback(input: Input, errors: string[]): Record<string, unknown> {
  onlyKeys(input, ["name", "phone", "topic", "preferred_time"], "", errors);
  const value: Record<string, unknown> = {
    name: personName(input, "name", true, errors),
    phone: phoneValue(input, "phone", true, errors),
    topic: freeText(input, "topic", TOOL_TEXT_LIMITS.topic, true, errors),
  };
  const preferred = freeText(input, "preferred_time", TOOL_TEXT_LIMITS.preferredTime, false, errors);
  if (preferred !== undefined) value.preferred_time = preferred;
  return value;
}

function transferCall(tenant: VoiceTenantConfig, input: Input, errors: string[]): Record<string, unknown> {
  onlyKeys(input, ["target", "reason"], "", errors);
  const ids = tenant.handoff.transfer.targets.map((target) => target.id);
  return {
    target: oneOf(input, "target", ids, true, errors),
    reason: freeText(input, "reason", TOOL_TEXT_LIMITS.reason, true, errors),
  };
}

function endCall(input: Input, errors: string[]): Record<string, unknown> {
  onlyKeys(input, ["reason"], "", errors);
  return { reason: oneOf(input, "reason", END_REASONS, true, errors) };
}

// ---------------------------------------------------------------------------------------------
// Task fields
// ---------------------------------------------------------------------------------------------

function fieldValue(field: TaskField, text: string, where: string, errors: string[], checks: Checks): string | null {
  const max = field.maxLength ?? DEFAULT_FIELD_MAX_LENGTH;
  switch (field.type) {
    case "phone": {
      const phone = checkPhone(text, where);
      if (!phone.ok) errors.push(phone.error);
      return phone.ok ? phone.value : null;
    }
    case "email": {
      if (!isValidEmail(text)) {
        errors.push(`"${where}" must be an email address.`);
        return null;
      }
      return text.toLowerCase();
    }
    case "date": {
      if (!isValidDate(text)) {
        errors.push(`"${where}" must be a date as YYYY-MM-DD.`);
        return null;
      }
      const today = todayIn(checks);
      // ISO dates compare as strings.
      if (field.allowPast !== true && today !== null && text < today) {
        errors.push(`"${where}" lies in the past (today is ${today}). Ask the caller for the date again.`);
        return null;
      }
      return text;
    }
    case "time": {
      const match = TIME_INPUT.exec(text);
      const hours = match ? Number(match[1]) : -1;
      const minutes = match ? Number(match[2]) : -1;
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        errors.push(`"${where}" must be a time as HH:MM.`);
        return null;
      }
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    case "integer": {
      const number = INTEGER_INPUT.test(text) ? Number(text) : Number.NaN;
      const tooSmall = field.min !== undefined && number < field.min;
      const tooLarge = field.max !== undefined && number > field.max;
      if (!Number.isSafeInteger(number) || tooSmall || tooLarge) {
        const bounds =
          field.min !== undefined && field.max !== undefined ? ` from ${field.min} to ${field.max}` : "";
        errors.push(`"${where}" must be a whole number${bounds}, as digits.`);
        return null;
      }
      return String(number);
    }
    case "boolean": {
      const word = comparable(text);
      if (YES_WORDS.has(word)) return "yes";
      if (NO_WORDS.has(word)) return "no";
      errors.push(`"${where}" must be "yes" or "no".`);
      return null;
    }
    case "choice": {
      const wanted = comparable(text);
      const choice = (field.choices ?? []).find(
        (candidate) =>
          comparable(candidate.id) === wanted ||
          Object.values(candidate.label ?? {}).some((label) => typeof label === "string" && comparable(label) === wanted),
      );
      if (!choice) {
        errors.push(`"${where}" must be one of: ${(field.choices ?? []).map((candidate) => candidate.id).join(", ")}.`);
        return null;
      }
      return choice.id;
    }
    case "name":
      if (!/\p{L}/u.test(text)) {
        errors.push(`"${where}" must be a name.`);
        return null;
      }
      return withinLength(text, max, where, errors);
    default:
      // text, address, locality
      return withinLength(text, max, where, errors);
  }
}

function withinLength(text: string, max: number, where: string, errors: string[]): string | null {
  if (Array.from(text).length > max) {
    errors.push(`"${where}" is too long (at most ${max} characters).`);
    return null;
  }
  return text;
}

// ---------------------------------------------------------------------------------------------
// Single values
// ---------------------------------------------------------------------------------------------

/** Reports every key outside `allowed`; `prefix` locates nested objects ("fields."). */
function onlyKeys(input: Input, allowed: readonly string[], prefix: string, errors: string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) errors.push(`Unknown property "${prefix}${clip(key)}".`);
  }
}

/** A cleaned string, or undefined when absent (null counts as absent: models send it for "none"). */
function stringValue(input: Input, key: string, required: boolean, errors: string[]): string | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) {
    if (required) errors.push(`"${key}" is required.`);
    return undefined;
  }
  if (typeof raw !== "string") {
    errors.push(`"${key}" must be a string.`);
    return undefined;
  }
  const text = cleanText(raw);
  if (text === "") {
    if (required) errors.push(`"${key}" is required.`);
    return undefined;
  }
  return text;
}

/** Free text: capped at `max` characters instead of refused. */
function freeText(input: Input, key: string, max: number, required: boolean, errors: string[]): string | undefined {
  const text = stringValue(input, key, required, errors);
  return text === undefined ? undefined : capText(text, max);
}

function personName(input: Input, key: string, required: boolean, errors: string[]): string | undefined {
  const text = stringValue(input, key, required, errors);
  if (text === undefined) return undefined;
  if (!/\p{L}/u.test(text)) {
    errors.push(`"${key}" must be a name.`);
    return undefined;
  }
  if (Array.from(text).length > TOOL_TEXT_LIMITS.name) {
    errors.push(`"${key}" is too long (at most ${TOOL_TEXT_LIMITS.name} characters).`);
    return undefined;
  }
  return text;
}

function oneOf<T extends string>(
  input: Input,
  key: string,
  allowed: readonly T[],
  required: boolean,
  errors: string[],
): T | undefined {
  const text = stringValue(input, key, required, errors);
  if (text === undefined) return undefined;
  const match = allowed.find((candidate) => candidate === text);
  if (match === undefined) errors.push(`"${key}" must be one of: ${allowed.join(", ")}.`);
  return match;
}

function serviceId(tenant: VoiceTenantConfig, input: Input, errors: string[]): string | undefined {
  const ids = (tenant.calendar?.services ?? []).map((service) => service.id);
  return oneOf(input, "service", ids, true, errors);
}

function dateValue(input: Input, key: string, errors: string[]): string | undefined {
  const text = stringValue(input, key, true, errors);
  if (text === undefined) return undefined;
  if (!isValidDate(text)) {
    errors.push(`"${key}" must be a date as YYYY-MM-DD.`);
    return undefined;
  }
  return text;
}

function partySize(input: Input, errors: string[]): number | undefined {
  const raw = input.party_size;
  if (raw === undefined || raw === null) {
    errors.push('"party_size" is required.');
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > MAX_PARTY_SIZE_INPUT) {
    errors.push(`"party_size" must be a whole number from 1 to ${MAX_PARTY_SIZE_INPUT}.`);
    return undefined;
  }
  return raw;
}

/**
 * A start time as the tenant's canonical ISO string. Accepts ISO with an offset (any offset, the
 * instant counts) and, because models drop offsets, a local "YYYY-MM-DDTHH:MM" read in the
 * tenant's zone (a time inside the spring gap is refused, an ambiguous one is the earlier).
 */
function startValue(tenant: VoiceTenantConfig, input: Input, key: string, errors: string[]): string | undefined {
  const text = stringValue(input, key, true, errors);
  if (text === undefined) return undefined;
  const epoch = parseStart(text, tenant.hours.timezone);
  if (epoch === null) {
    errors.push(`"${key}" must be a start time returned by check_availability, like 2026-12-03T14:30:00+01:00.`);
    return undefined;
  }
  return toZonedIso(new Date(epoch), tenant.hours.timezone);
}

function parseStart(text: string, timezone: string): number | null {
  const instant = parseIsoInstant(text);
  if (instant !== null) return instant;
  const match = LOCAL_START.exec(text);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = match[4] === undefined ? 0 : Number(match[4]);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const epoch = wallTimeToEpoch(match[1], hours * 60 + minutes, timezone, "null");
  return epoch === null ? null : epoch + seconds * 1000;
}

function reference(input: Input, errors: string[]): string | undefined {
  const text = stringValue(input, "reference", true, errors);
  if (text === undefined) return undefined;
  const ref = text.length <= TOOL_TEXT_LIMITS.reference ? normalizeBookingRef(text) : null;
  if (ref === null) errors.push('"reference" must be a booking reference like MV-7K2Q.');
  return ref ?? undefined;
}

/** book_appointment's contact: an email when it has an "@", else a phone number. */
function contactValue(input: Input, errors: string[]): string | undefined {
  const text = stringValue(input, "contact", true, errors);
  if (text === undefined) return undefined;
  if (text.includes("@")) {
    if (isValidEmail(text)) return text.toLowerCase();
    errors.push('"contact" must be a phone number with area code (e.g. 079 123 45 67) or an email address.');
    return undefined;
  }
  const phone = checkPhone(text, "contact");
  if (phone.ok) return phone.value;
  errors.push(phone.error);
  return undefined;
}

function phoneValue(input: Input, key: string, required: boolean, errors: string[]): string | undefined {
  const text = stringValue(input, key, required, errors);
  if (text === undefined) return undefined;
  const phone = checkPhone(text, key);
  if (!phone.ok) errors.push(phone.error);
  return phone.ok ? phone.value : undefined;
}

/**
 * A phone number given by the caller. A number in the Swiss national form ("079 ...", "044 ...")
 * is taken as Swiss when its prefix exists in the Swiss numbering plan; one that does not fit is
 * refused, with the question to ask (see the header for why the call's language no longer counts).
 */
function checkPhone(text: string, key: string): { ok: true; value: string } | { ok: false; error: string } {
  const phone = normalizePhone(text);
  const national = isNationalForm(text);
  if (phone === null) {
    if (national && /^0\d{9}$/.test(text.replace(/\D/g, ""))) {
      return {
        ok: false,
        error: `"${key}" is not a Swiss number. If it is from another country, ask the caller for the country code and send the number with it (for example +39 or +49 in front).`,
      };
    }
    if (key === "contact") {
      return { ok: false, error: '"contact" must be a phone number with area code (e.g. 079 123 45 67) or an email address.' };
    }
    return { ok: false, error: `"${key}" must be a phone number with area code, e.g. 079 123 45 67.` };
  }
  return { ok: true, value: phone };
}

/** "079 ...", "(044) ...": one trunk zero, no "+" and no "00" country prefix. */
function isNationalForm(text: string): boolean {
  if (text.includes("+")) return false;
  const digits = text.replace(/\D/g, "");
  return digits.startsWith("0") && !digits.startsWith("00");
}

/** Today in the tenant's zone, or null when the call's clock is unknown. */
function todayIn(checks: Checks): string | null {
  const now = checks.options.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  try {
    return zonedParts(now, checks.timezone).date;
  } catch {
    return null;
  }
}

/** create_lead's name / phone / email / company, validated by kind. */
function contactDetail(input: Input, key: (typeof CONTACT_KEYS)[number], errors: string[]): string | undefined {
  if (key === "name") return personName(input, key, false, errors);
  if (key === "phone") return phoneValue(input, key, false, errors);
  if (key === "email") {
    const text = stringValue(input, key, false, errors);
    if (text === undefined) return undefined;
    if (!isValidEmail(text)) {
      errors.push('"email" must be an email address.');
      return undefined;
    }
    return text.toLowerCase();
  }
  const company = stringValue(input, key, false, errors);
  if (company !== undefined && Array.from(company).length > TOOL_TEXT_LIMITS.company) {
    errors.push(`"company" is too long (at most ${TOOL_TEXT_LIMITS.company} characters).`);
    return undefined;
  }
  return company;
}

// ---------------------------------------------------------------------------------------------
// Phone, email, text
// ---------------------------------------------------------------------------------------------

/**
 * A phone number in E.164 ("+41791234567"), or null when it is not one.
 *   Swiss national forms: "079 123 45 67", "0791234567", "044 123 45 67"   -> +41 and 9 digits,
 *     and only with a prefix of the Swiss numbering plan (SWISS_PREFIXES): "035 ..." or "0171 ..."
 *     are numbers of another country written without their country code, not Swiss ones.
 *   International: "+41 79 123 45 67", "0041 79 ...", "+41 (0)79 ...", "+41 079 ..." -> +41791234567;
 *     premium rate ("+41 900 ...") is refused like "0900 ...".
 *   Other countries must start with + or 00; their digits are kept as given (7 to 15 in all).
 * Separators allowed: spaces, dots, dashes, slashes, brackets. Letters ("ext. 12") refuse it.
 * A national form is read as Swiss when its prefix exists in the Swiss numbering plan: see checkPhone().
 */
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (text === "" || text.length > 40) return null;
  // "+41 (0)79 ...": the trunk zero some people write in brackets after the country code.
  text = text.replace(/^(\+|00)\s*(\d{1,3})\s*\(\s*0\s*\)/, "$1$2");
  if (!PHONE_CHARS.test(text)) return null;
  const plus = text.indexOf("+");
  if (plus > 0 || text.lastIndexOf("+") !== plus) return null;

  let digits = text.replace(/\D/g, "");
  if (plus === 0) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    const national = digits.slice(1);
    return SWISS_PREFIXES_2.has(national.slice(0, 2)) || SWISS_PREFIXES_3.has(national.slice(0, 3)) ? swiss(national) : null;
  } else {
    return null;
  }
  if (digits.startsWith("41")) {
    const national = digits.slice(2);
    // "+41 079 ...": the national trunk zero kept by mistake.
    return swiss(national.startsWith("0") ? national.slice(1) : national);
  }
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

/**
 * Swiss numbers have 9 digits after the trunk zero / country code, the first one not 0. Premium
 * rate (090x) is refused in every form: "+41 900 ..." and "0041 906 ..." used to pass where
 * "0900 ..." did not (review finding S2-9). With the country code any other Swiss prefix is
 * fine: there it cannot be another country's number.
 */
function swiss(national: string): string | null {
  return /^[1-9]\d{8}$/.test(national) && !PREMIUM_RATE.test(national) ? `+41${national}` : null;
}

/**
 * A pragmatic email check: one "@", an ASCII local part (dots not doubled or at the ends), a
 * domain of at least two labels (letters of any script allowed, as in "müller.ch") and a
 * top-level domain of two or more letters. Length limits of RFC 5321.
 */
export function isValidEmail(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const email = raw.trim();
  if (email.length === 0 || email.length > 254) return false;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !EMAIL_LOCAL.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return TOP_LEVEL_DOMAIN.test(labels[labels.length - 1]);
}

/** A run that could be a phone number: digits with the separators people type between them. */
const PHONE_LIKE_RUN = /\+?\d[\d\s().\/-]{4,}\d/g;

/**
 * `text` without anything that could be a phone number, for labels the model or the browser get
 * (a transfer target written as "Inhaberin (052 123 45 67)" must not hand out the private line).
 */
export function withoutPhoneNumbers(text: string): string {
  return text
    .replace(PHONE_LIKE_RUN, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** True when `text` holds something that could be a phone number. */
export function hasPhoneNumber(text: string): boolean {
  return withoutPhoneNumbers(text) !== text.replace(/\s{2,}/g, " ").trim();
}

/** Single-line text: control and invisible characters removed, whitespace collapsed, trimmed. */
export function cleanText(raw: string): string {
  return raw.normalize("NFC").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

function capText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}

/** For matching words: lower case, no accents, single spaces. */
function comparable(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function labelOf(label: VoiceText | undefined, fallback: string): string {
  return label?.en ?? label?.de ?? label?.it ?? label?.fr ?? fallback;
}

function isPlainObject(value: unknown): value is Input {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Echoes at most 40 characters of a model-chosen name in an error. */
function clip(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}
