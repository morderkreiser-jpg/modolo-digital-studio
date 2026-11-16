// Quote-request validation (lib/assistant/lead-schema.ts): every field rule, normalization and
// hostile input. This module is the authoritative server-side check of /api/assistant/lead.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEAD_LIMITS,
  cleanLine,
  cleanText,
  isValidEmail,
  isValidPhone,
  validateLead,
} from "@/lib/assistant/lead-schema";
import type { LeadRules } from "@/lib/assistant/lead-schema";
import { LEAD_FIELDS } from "@/lib/assistant/types";
import type { LeadField, LeadFieldError } from "@/lib/assistant/types";

const RULES: LeadRules = { services: ["website", "booking"], budgets: ["small", "large"], requireCompany: false, requirePhone: false };
const BASE = {
  name: "Anna Muster",
  email: "anna.muster@example.ch",
  description: "Vorrei un sito per il mio salone.",
  consent: true,
};

/** The field error for `field` when `patch` is applied to a valid lead (undefined when valid). */
function fieldError(patch: Record<string, unknown>, field: LeadField, rules: LeadRules = RULES): LeadFieldError | undefined {
  const result = validateLead({ ...BASE, ...patch }, rules);
  return result.ok ? undefined : result.fields[field];
}

function valid(patch: Record<string, unknown> = {}, rules: LeadRules = RULES) {
  const result = validateLead({ ...BASE, ...patch }, rules);
  assert.ok(result.ok, `expected valid, got ${JSON.stringify(result.ok ? null : result.fields)}`);
  return result.value;
}

describe("validateLead: happy path and normalization", () => {
  it("accepts a minimal lead and leaves optional fields undefined", () => {
    assert.deepEqual(valid(), {
      name: "Anna Muster",
      company: undefined,
      email: "anna.muster@example.ch",
      phone: undefined,
      service: undefined,
      description: "Vorrei un sito per il mio salone.",
      budget: undefined,
      consent: true,
    });
  });

  it("cleans every field: whitespace, control characters, newlines and email case", () => {
    const value = valid({
      name: "  Anna\n\u0000  Muster\t ",
      company: " Salone\r\nAnna  GmbH ",
      email: "  Anna.Muster@Example.CH ",
      phone: " +41 79 123 45 67 ",
      service: " website ",
      budget: "large",
      description: "Riga uno\r\nRiga\tdue\u0007\n\n\n\n\nFine.  ",
    });
    assert.equal(value.name, "Anna Muster");
    assert.equal(value.company, "Salone Anna GmbH");
    assert.equal(value.email, "anna.muster@example.ch");
    assert.equal(value.phone, "+41 79 123 45 67");
    assert.equal(value.service, "website");
    assert.equal(value.budget, "large");
    assert.equal(value.description, "Riga uno\nRiga due\n\nFine.");
  });

  it("returns only the known lead fields (extra input properties are dropped)", () => {
    const value = valid({ isAdmin: true, notifyEmail: "attacker@example.com" });
    for (const key of Object.keys(value)) assert.ok((LEAD_FIELDS as readonly string[]).includes(key), key);
  });
});

describe("validateLead: field rules", () => {
  it("name: required, 2..100 characters after cleaning", () => {
    assert.equal(fieldError({ name: undefined }, "name"), "required");
    assert.equal(fieldError({ name: " \n\t " }, "name"), "required");
    assert.equal(fieldError({ name: "A" }, "name"), "too_short");
    assert.equal(fieldError({ name: "Al" }, "name"), undefined);
    assert.equal(fieldError({ name: "a".repeat(LEAD_LIMITS.nameMax) }, "name"), undefined);
    assert.equal(fieldError({ name: "a".repeat(LEAD_LIMITS.nameMax + 1) }, "name"), "too_long");
  });

  it("company: optional unless required, at most 120 characters", () => {
    assert.equal(fieldError({ company: undefined }, "company"), undefined);
    assert.equal(fieldError({ company: "" }, "company", { ...RULES, requireCompany: true }), "required");
    assert.equal(fieldError({ company: "ACME" }, "company", { ...RULES, requireCompany: true }), undefined);
    assert.equal(fieldError({ company: "c".repeat(LEAD_LIMITS.companyMax) }, "company"), undefined);
    assert.equal(fieldError({ company: "c".repeat(LEAD_LIMITS.companyMax + 1) }, "company"), "too_long");
  });

  it("email: required and syntactically valid", () => {
    assert.equal(fieldError({ email: "" }, "email"), "required");
    for (const bad of ["not-an-email", "a@b", "a@b.c", "a b@example.ch", "<a@example.ch>", '"a"@example.ch', "a@@example.ch", "anna@bücher.ch", "a@example.ch,b@example.ch"]) {
      assert.equal(fieldError({ email: bad }, "email"), "invalid_email", bad);
    }
    for (const good of ["first.last+tag@sub.example.co.uk", "anna@xn--bcher-kva.ch", "A_B-C@EXAMPLE.CH"]) {
      assert.equal(fieldError({ email: good }, "email"), undefined, good);
    }
    const local = "a".repeat(64);
    const longest = `${local}@${"b".repeat(LEAD_LIMITS.emailMax - local.length - "@".length - ".com".length)}.com`;
    assert.equal(longest.length, LEAD_LIMITS.emailMax);
    assert.equal(fieldError({ email: longest }, "email"), undefined);
    assert.equal(fieldError({ email: `a${longest}` }, "email"), "invalid_email");
  });

  it("email: header-injection attempts are rejected, not smuggled through", () => {
    assert.equal(fieldError({ email: "victim@example.com\r\nBcc: list@example.com" }, "email"), "invalid_email");
    assert.equal(fieldError({ email: "victim@example.com\nCc:x@example.com" }, "email"), "invalid_email");
  });

  it("phone: optional unless required, 6..20 digits, phone characters only, at most 25 characters", () => {
    assert.equal(fieldError({ phone: "" }, "phone"), undefined);
    assert.equal(fieldError({ phone: "" }, "phone", { ...RULES, requirePhone: true }), "required");
    for (const good of ["+41 79 123 45 67", "079/123.45.67", "(044) 123-45-67", "123456", "+39 333 1234567"]) {
      assert.equal(fieldError({ phone: good }, "phone"), undefined, good);
    }
    for (const bad of ["12345", "+41 79 abc 45 67", "1".repeat(21), "+41 79 123 45 67 ext 9", "1 2 3 4 5 6 7 8 9 0 1 2 3 4"]) {
      assert.equal(fieldError({ phone: bad }, "phone"), "invalid_phone", bad);
    }
  });

  it("service and budget: optional, must be one of the allowed ids", () => {
    assert.equal(fieldError({ service: "" }, "service"), undefined);
    assert.equal(fieldError({ service: "booking" }, "service"), undefined);
    assert.equal(fieldError({ service: "hacking" }, "service"), "invalid_option");
    assert.equal(fieldError({ service: "w".repeat(LEAD_LIMITS.optionMax + 1) }, "service", { ...RULES, services: ["w".repeat(65)] }), "invalid_option");
    assert.equal(fieldError({ budget: "small" }, "budget"), undefined);
    assert.equal(fieldError({ budget: "huge" }, "budget"), "invalid_option");
    assert.equal(fieldError({ budget: "website" }, "budget"), "invalid_option");
  });

  it("description: required, 10..2000 characters measured after cleaning", () => {
    assert.equal(fieldError({ description: "" }, "description"), "required");
    assert.equal(fieldError({ description: "short" }, "description"), "too_short");
    assert.equal(fieldError({ description: `    x${" ".repeat(20)}` }, "description"), "too_short");
    assert.equal(fieldError({ description: "0123456789" }, "description"), undefined);
    assert.equal(fieldError({ description: "d".repeat(LEAD_LIMITS.descriptionMax) }, "description"), undefined);
    assert.equal(fieldError({ description: "d".repeat(LEAD_LIMITS.descriptionMax + 1) }, "description"), "too_long");
  });

  it("consent: only the boolean true counts", () => {
    for (const consent of [undefined, false, "true", 1, "yes", {}]) {
      assert.equal(fieldError({ consent }, "consent"), "consent_required", String(consent));
    }
    assert.equal(fieldError({ consent: true }, "consent"), undefined);
  });

  it("reports every invalid field at once", () => {
    const result = validateLead({ name: "A", email: "bad", phone: "x", service: "nope", budget: "nope", description: "short" }, RULES);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.fields, {
      name: "too_short",
      email: "invalid_email",
      phone: "invalid_phone",
      service: "invalid_option",
      budget: "invalid_option",
      description: "too_short",
      consent: "consent_required",
    });
  });
});

describe("validateLead: hostile input", () => {
  it("never throws on non-objects and reports the required fields", () => {
    for (const input of [null, undefined, "lead", 42, true, [], [BASE]]) {
      const result = validateLead(input, RULES);
      assert.equal(result.ok, false, JSON.stringify(input));
      if (result.ok) continue;
      assert.equal(result.fields.name, "required");
      assert.equal(result.fields.email, "required");
      assert.equal(result.fields.description, "required");
      assert.equal(result.fields.consent, "consent_required");
    }
  });

  it("treats non-string field values as empty instead of coercing them", () => {
    const result = validateLead(
      { name: 12345, email: ["a@example.ch"], description: { toString: () => "a long enough description" }, consent: true },
      RULES,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.fields.name, "required");
    assert.equal(result.fields.email, "required");
    assert.equal(result.fields.description, "required");
  });

  it("ignores a JSON `__proto__` key (no prototype tricks)", () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"consent":true,"name":"Proto Name"},"email":"a@example.ch","description":"0123456789"}');
    const result = validateLead(parsed, RULES);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.fields.consent, "consent_required");
    assert.equal(result.fields.name, "required");
  });

  it("only ever reports known fields and known error codes", () => {
    const codes = new Set(["required", "too_short", "too_long", "invalid_email", "invalid_phone", "invalid_option", "consent_required"]);
    const result = validateLead({ name: "\u0000", email: "\u0007", phone: "\u0000\u0000", description: "\u0000", consent: "x" }, RULES);
    assert.equal(result.ok, false);
    if (result.ok) return;
    for (const [field, code] of Object.entries(result.fields)) {
      assert.ok((LEAD_FIELDS as readonly string[]).includes(field), field);
      assert.ok(codes.has(String(code)), String(code));
    }
  });
});

describe("lead-schema helpers", () => {
  it("cleanLine collapses whitespace, removes control characters and newlines", () => {
    assert.equal(cleanLine(" a\u0000b\r\nc\t\td  "), "a b c d");
    assert.equal(cleanLine(undefined), "");
    assert.equal(cleanLine(7), "");
  });

  it("cleanText keeps single blank lines, removes control characters and normalizes newlines", () => {
    assert.equal(cleanText("a\r\nb\rc\u0007\n\n\n\nd\t"), "a\nb\nc\n\nd");
    assert.equal(cleanText(null), "");
  });

  it("isValidEmail and isValidPhone match the field rules", () => {
    assert.equal(isValidEmail("info@modolodigitalstudio.ch"), true);
    assert.equal(isValidEmail("info@modolodigitalstudio"), false);
    assert.equal(isValidPhone("+41 77 223 79 00"), true);
    assert.equal(isValidPhone("+41"), false);
  });
});
