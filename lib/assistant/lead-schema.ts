// Validation + normalization of quote requests ("leads"). Pure module, shared by the quote form
// (instant feedback in the browser) and the lead API route (the authoritative check).
import type { LeadField, LeadFieldError, LeadInput } from "./types";

export const LEAD_LIMITS = {
  nameMin: 2,
  nameMax: 100,
  companyMax: 120,
  emailMax: 254,
  phoneMax: 25,
  phoneMinDigits: 6,
  phoneMaxDigits: 20,
  descriptionMin: 10,
  descriptionMax: 2000,
  optionMax: 64,
} as const;

export interface LeadRules {
  /** Allowed service ids (empty/undefined value is accepted: the field is optional). */
  services: string[];
  /** Allowed budget ids (empty/undefined value is accepted: the field is optional). */
  budgets: string[];
  requireCompany: boolean;
  requirePhone: boolean;
}

export type LeadFieldErrors = Partial<Record<LeadField, LeadFieldError>>;

export type LeadValidation =
  | { ok: true; value: LeadInput }
  | { ok: false; fields: LeadFieldErrors };

// Pragmatic address check: one @, no whitespace/brackets/quotes/separators, a dot-separated
// domain with a TLD of 2+ letters. Real verification is the reply itself.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
const PHONE_CHARS_RE = /^[+0-9 ()./-]+$/;
// C0/C1 control characters (keeps \n only where explicitly allowed).
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Single-line field: strip control chars and newlines, collapse whitespace, trim. */
export function cleanLine(value: unknown): string {
  return str(value).replace(CONTROL_RE, " ").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Multi-line field: strip control chars, normalize newlines, max 2 consecutive blank lines. */
export function cleanText(value: unknown): string {
  return str(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isValidEmail(email: string): boolean {
  return email.length <= LEAD_LIMITS.emailMax && EMAIL_RE.test(email);
}

export function isValidPhone(phone: string): boolean {
  if (phone.length > LEAD_LIMITS.phoneMax || !PHONE_CHARS_RE.test(phone)) return false;
  const digits = phone.replace(/\D/g, "").length;
  return digits >= LEAD_LIMITS.phoneMinDigits && digits <= LEAD_LIMITS.phoneMaxDigits;
}

/**
 * Validate and normalize an untrusted lead object. Returns the cleaned value or a map of
 * field → error code (codes are translated by the UI; see i18n.ts).
 */
export function validateLead(input: unknown, rules: LeadRules): LeadValidation {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const fields: LeadFieldErrors = {};

  const name = cleanLine(raw.name);
  if (!name) fields.name = "required";
  else if (name.length < LEAD_LIMITS.nameMin) fields.name = "too_short";
  else if (name.length > LEAD_LIMITS.nameMax) fields.name = "too_long";

  const company = cleanLine(raw.company);
  if (!company && rules.requireCompany) fields.company = "required";
  else if (company.length > LEAD_LIMITS.companyMax) fields.company = "too_long";

  const email = cleanLine(raw.email).toLowerCase();
  if (!email) fields.email = "required";
  else if (!isValidEmail(email)) fields.email = "invalid_email";

  const phone = cleanLine(raw.phone);
  if (!phone && rules.requirePhone) fields.phone = "required";
  else if (phone && !isValidPhone(phone)) fields.phone = "invalid_phone";

  const service = cleanLine(raw.service);
  if (service && (service.length > LEAD_LIMITS.optionMax || !rules.services.includes(service))) {
    fields.service = "invalid_option";
  }

  const budget = cleanLine(raw.budget);
  if (budget && (budget.length > LEAD_LIMITS.optionMax || !rules.budgets.includes(budget))) {
    fields.budget = "invalid_option";
  }

  const description = cleanText(raw.description);
  if (!description) fields.description = "required";
  else if (description.length < LEAD_LIMITS.descriptionMin) fields.description = "too_short";
  else if (description.length > LEAD_LIMITS.descriptionMax) fields.description = "too_long";

  if (raw.consent !== true) fields.consent = "consent_required";

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      name,
      company: company || undefined,
      email,
      phone: phone || undefined,
      service: service || undefined,
      description,
      budget: budget || undefined,
      consent: true,
    },
  };
}
