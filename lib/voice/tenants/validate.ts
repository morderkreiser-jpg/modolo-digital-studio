// Consistency checks of a voice tenant, run by the tests on every registered tenant (and usable
// by an admin tool later). Returns the problems as short English lines; [] when the tenant is
// fine. Never throws: a malformed tenant is a problem to report, not a crash.
//
// The checks encode the promises the prompt and the tools rely on: the greeting discloses the AI
// in every language, every tool the model is given can actually work, demo tenants never record,
// and no number reaches the model in a shape the telephony could misdial.
import { validateHours } from "@/lib/voice/hours";
import {
  VOICE_LOCALES,
  VOICE_PLANS,
  VOICE_SECTORS,
  isVoiceLocale,
  isVoiceToolName,
  type CalendarConfig,
  type TaskDefinition,
  type VoiceLocale,
  type VoiceTenantConfig,
  type VoiceText,
  type VoiceToolName,
} from "@/lib/voice/types";

const TENANT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TENANT_ID = 64;
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLOT_STEPS: ReadonlySet<number> = new Set([15, 30, 60]);
const CALENDAR_TOOLS: ReadonlySet<VoiceToolName> = new Set([
  "check_availability",
  "book_appointment",
  "cancel_appointment",
  "reschedule_appointment",
]);
const CONTACT_NEEDS: ReadonlySet<string> = new Set(["required", "optional", "none"]);

/**
 * Does the greeting tell the caller, in its own language, that they are talking to an AI?
 * Case-sensitive where a short word is also an ordinary word ("ai" is Italian for "to the").
 */
export function disclosesAi(text: string, locale: VoiceLocale): boolean {
  switch (locale) {
    case "de":
      return /(?<![\p{L}\p{N}])KI(?![\p{L}\p{N}])/u.test(text) || (/digital/i.test(text) && /assistent/i.test(text));
    case "it":
      return (
        /assistente/i.test(text) &&
        (/(?<![\p{L}\p{N}])AI(?![\p{L}\p{N}])/u.test(text) || /digitale|virtuale|intelligenza artificiale/i.test(text))
      );
    case "en":
      return /(?<![\p{L}\p{N}])AI(?![\p{L}\p{N}])/u.test(text) || /digital assistant|virtual assistant/i.test(text);
    case "fr":
      return (
        /assistant/i.test(text) && (/(?<![\p{L}\p{N}])IA(?![\p{L}\p{N}])/u.test(text) || /virtuel|numérique/i.test(text))
      );
  }
}

function text(value: VoiceText | undefined, locale: VoiceLocale): string {
  const found = value && typeof value === "object" && Object.hasOwn(value, locale) ? value[locale] : undefined;
  return typeof found === "string" ? found.trim() : "";
}

function isWholeNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated];
}

function checkTasks(tasks: TaskDefinition[], problems: string[]): void {
  for (const id of duplicates(tasks.map((task) => task.id))) problems.push(`task id "${id}" is used twice`);
  for (const task of tasks) {
    const where = `task "${task.id}"`;
    if (!SNAKE_CASE.test(task.id)) problems.push(`${where}: id must be snake_case`);
    if (!task.when?.trim()) problems.push(`${where}: "when" is empty`);
    for (const key of ["name", "phone", "email", "company"] as const) {
      if (!CONTACT_NEEDS.has(task.contact?.[key])) problems.push(`${where}: contact.${key} must be required, optional or none`);
    }
    for (const id of duplicates(task.fields.map((field) => field.id))) problems.push(`${where}: field id "${id}" is used twice`);
    for (const field of task.fields) {
      const at = `${where}, field "${field.id}"`;
      if (!SNAKE_CASE.test(field.id)) problems.push(`${at}: id must be snake_case`);
      if (field.type === "choice") {
        const choices = field.choices ?? [];
        if (choices.length === 0) problems.push(`${at}: a choice field needs choices`);
        if (choices.some((choice) => !choice.id?.trim())) problems.push(`${at}: a choice has no id`);
        for (const id of duplicates(choices.map((choice) => choice.id))) problems.push(`${at}: choice "${id}" is listed twice`);
      }
      if (field.maxLength !== undefined && !isWholeNumber(field.maxLength, 1, 4000)) {
        problems.push(`${at}: maxLength must be a whole number from 1 to 4000`);
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        problems.push(`${at}: min is greater than max`);
      }
    }
  }
}

function checkCalendar(calendar: CalendarConfig, problems: string[]): void {
  if (!["memory", "google", "microsoft"].includes(calendar.provider)) problems.push("calendar: unknown provider");
  if (calendar.services.length === 0) problems.push("calendar: no services");
  for (const id of duplicates(calendar.services.map((service) => service.id))) {
    problems.push(`calendar: service id "${id}" is used twice`);
  }
  for (const service of calendar.services) {
    if (!service.id?.trim()) problems.push("calendar: a service has no id");
    if (!isWholeNumber(service.durationMinutes, 5, 480)) {
      problems.push(`calendar: service "${service.id}" duration must be 5 to 480 minutes`);
    }
    for (const buffer of [service.bufferBeforeMinutes, service.bufferAfterMinutes]) {
      if (buffer !== undefined && !isWholeNumber(buffer, 0, 240)) {
        problems.push(`calendar: service "${service.id}" buffers must be 0 to 240 minutes`);
      }
    }
  }
  const capacity = calendar.capacity;
  if (capacity.kind === "seats") {
    if (!isWholeNumber(capacity.total, 1, 10_000)) problems.push("calendar: seats.total must be at least 1");
    if (!isWholeNumber(capacity.maxPartySize, 1, Math.max(1, capacity.total))) {
      problems.push("calendar: seats.maxPartySize must be from 1 to seats.total");
    }
    if (!isWholeNumber(capacity.turnMinutes, 15, 480)) problems.push("calendar: seats.turnMinutes must be 15 to 480");
  } else if (capacity.kind !== "single") {
    problems.push("calendar: unknown capacity kind");
  }
  if (!SLOT_STEPS.has(calendar.slotStepMinutes)) problems.push("calendar: slotStepMinutes must be 15, 30 or 60");
  if (!isWholeNumber(calendar.minLeadMinutes, 0, 60 * 24 * 30)) problems.push("calendar: minLeadMinutes must be 0 to 30 days");
  if (!isWholeNumber(calendar.maxDaysAhead, 1, 365)) problems.push("calendar: maxDaysAhead must be 1 to 365");
  if (!isWholeNumber(calendar.changeMinLeadMinutes, 0, 60 * 24 * 30)) {
    problems.push("calendar: changeMinLeadMinutes must be 0 to 30 days");
  }
}

function checkTools(tenant: VoiceTenantConfig, problems: string[]): void {
  const tools = tenant.tools as unknown[];
  for (const tool of tools) if (!isVoiceToolName(tool)) problems.push(`tool "${String(tool)}" does not exist`);
  for (const tool of duplicates(tools.map(String))) problems.push(`tool "${tool}" is listed twice`);
  const listed = new Set(tools);
  for (const tool of CALENDAR_TOOLS) {
    if (listed.has(tool) && !tenant.calendar) problems.push(`tool "${tool}" needs a calendar`);
  }
  if (tenant.calendar) {
    if (listed.has("cancel_appointment") && !tenant.calendar.allowCancel) {
      problems.push('tool "cancel_appointment" needs calendar.allowCancel');
    }
    if (listed.has("reschedule_appointment") && !tenant.calendar.allowReschedule) {
      problems.push('tool "reschedule_appointment" needs calendar.allowReschedule');
    }
  }
  const { transfer, callback } = tenant.handoff;
  if (listed.has("transfer_call") && !(transfer.enabled && transfer.targets.length > 0)) {
    problems.push('tool "transfer_call" needs handoff.transfer enabled with at least one target');
  }
  if (listed.has("request_callback") && !callback.enabled) {
    problems.push('tool "request_callback" needs handoff.callback enabled');
  }
  if (listed.has("create_lead") && tenant.tasks.length === 0) problems.push('tool "create_lead" needs at least one task');
}

function checkHandoff(tenant: VoiceTenantConfig, locales: VoiceLocale[], problems: string[]): void {
  const { transfer, callback, written, emergency } = tenant.handoff;
  for (const id of duplicates(transfer.targets.map((target) => target.id))) {
    problems.push(`transfer target id "${id}" is used twice`);
  }
  for (const target of transfer.targets) {
    if (!target.id?.trim()) problems.push("a transfer target has no id");
    // Never print the number itself: problems end up in logs and test output.
    if (!E164.test(target.number)) problems.push(`transfer target "${target.id}": number is not in E.164 form (+41...)`);
  }
  if (transfer.enabled && !isWholeNumber(transfer.ringSeconds, 5, 60)) {
    problems.push("handoff.transfer.ringSeconds must be 5 to 60");
  }
  for (const [kind, promise] of [
    ["callback", callback.enabled ? callback.promise : undefined],
    ["written", written.enabled ? written.promise : undefined],
  ] as const) {
    if (!promise) continue;
    for (const locale of locales) {
      if (!text(promise, locale)) problems.push(`handoff.${kind}.promise is missing for "${locale}"`);
    }
  }
  if (!Array.isArray(emergency.triggers)) problems.push("handoff.emergency.triggers must be a list");
  for (const locale of locales) {
    if (!text(emergency.message, locale)) problems.push(`emergency message is missing for "${locale}"`);
  }
}

function checkUnsafe(tenant: VoiceTenantConfig): string[] {
  const problems: string[] = [];

  if (typeof tenant.id !== "string" || tenant.id.length > MAX_TENANT_ID || !TENANT_ID.test(tenant.id)) {
    problems.push("id must be lowercase letters, digits and single dashes (at most 64 characters)");
  }
  const demoId = typeof tenant.id === "string" && tenant.id.startsWith("demo-");
  if (tenant.kind !== "live" && tenant.kind !== "demo") problems.push('kind must be "live" or "demo"');
  if (demoId && tenant.kind !== "demo") problems.push('an id starting with "demo-" needs kind "demo"');
  if (tenant.kind === "demo" && !demoId) problems.push('a demo tenant\'s id must start with "demo-"');
  if (tenant.kind === "demo" && tenant.notifyEmail) problems.push("a demo tenant has no notifyEmail");
  if (tenant.notifyEmail !== undefined && !EMAIL.test(tenant.notifyEmail)) problems.push("notifyEmail is not an email address");
  if (!tenant.business?.name?.trim()) problems.push("business.name is empty");
  if (!(VOICE_SECTORS as readonly string[]).includes(tenant.business?.sector)) problems.push("business.sector is unknown");
  if (!(VOICE_PLANS as readonly string[]).includes(tenant.plan)) problems.push("plan is unknown");

  const locales = Array.isArray(tenant.locales) ? tenant.locales.filter(isVoiceLocale) : [];
  if (!Array.isArray(tenant.locales) || tenant.locales.length === 0) problems.push("locales is empty");
  else if (locales.length !== tenant.locales.length) problems.push("locales contains an unknown locale");
  for (const locale of duplicates(locales)) problems.push(`locale "${locale}" is listed twice`);
  if (!locales.includes(tenant.defaultLocale)) problems.push("defaultLocale is not one of locales");

  for (const locale of locales) {
    const greeting = text(tenant.greeting, locale);
    if (!greeting) problems.push(`greeting is missing for "${locale}"`);
    else if (!disclosesAi(greeting, locale)) problems.push(`greeting for "${locale}" does not say that this is an AI assistant`);
  }

  checkTools(tenant, problems);
  checkTasks(tenant.tasks, problems);
  if (tenant.calendar) checkCalendar(tenant.calendar, problems);
  checkHandoff(tenant, locales, problems);

  // Recording needs a legal check and a paid plan's agreement; a demo can never record.
  if (tenant.privacy.recordAudio && (tenant.plan === "demo" || tenant.kind === "demo")) {
    problems.push("privacy.recordAudio must be false on a demo tenant or plan");
  }
  if (!isWholeNumber(tenant.privacy.transcriptRetentionDays, 0, 3650)) {
    problems.push("privacy.transcriptRetentionDays must be a whole number of days");
  }
  if (!isWholeNumber(tenant.privacy.summaryRetentionDays, 0, 3650)) {
    problems.push("privacy.summaryRetentionDays must be a whole number of days");
  }
  if (!VOICE_LOCALES.some((locale) => text(tenant.privacy.noticeUrl, locale))) problems.push("privacy.noticeUrl is empty");
  for (const locale of VOICE_LOCALES) {
    const url = text(tenant.privacy.noticeUrl, locale);
    if (url && !url.startsWith("/") && !url.startsWith("https://")) {
      problems.push(`privacy.noticeUrl for "${locale}" must be a site path or an https URL`);
    }
  }

  for (const [key, value] of Object.entries(tenant.limits ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) problems.push(`limits.${key} must be a number >= 0`);
  }

  const hourProblems: unknown = validateHours(tenant.hours);
  if (Array.isArray(hourProblems)) for (const problem of hourProblems) problems.push(`hours: ${String(problem)}`);
  return problems;
}

/** Problems of a tenant configuration; [] when it is fine. Never throws. */
export function validateVoiceTenant(tenant: VoiceTenantConfig): string[] {
  try {
    return checkUnsafe(tenant);
  } catch (error) {
    return [`tenant is malformed: ${error instanceof Error ? error.message : "unknown error"}`];
  }
}
