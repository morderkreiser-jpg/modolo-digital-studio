// Structured logs of the voice module. Server-only.
//
// One JSON line per event, through the chat assistant's logEvent (same channel, same format), with
// route "voice". Callers pass ids, codes, counts, timings and costs only.
//
// A guard sits between the caller and the log: a conversation produces transcripts, names, phone
// numbers and addresses, and one careless `logVoiceEvent({ ...session })` would write them to the
// function logs, which are kept for days and readable by anyone with access to the project. So:
//   - fields whose NAME suggests content, personal data or a secret are dropped (see below);
//   - only strings, finite-or-not numbers, booleans and null pass: objects and arrays could carry
//     anything and are dropped whole;
//   - strings are cut to MAX_STRING_CHARS, so a "reason" cannot smuggle a paragraph.
// The number of dropped fields is logged (never their names or values), so a careless call shows
// up in the logs as `dropped: n` and can be fixed.
//
// Consequence for callers: name counters without these words ("inTok", "turns", "chars"), not
// "inputTokens", "messages" or "textLength".
import { logEvent } from "@/lib/assistant/server/usage";

export type VoiceLogValue = string | number | boolean | null | undefined;

const MAX_STRING_CHARS = 200;

/** Dropped when the lowercased field name CONTAINS one of these ("callerName", "phone_number"). */
const DENIED_SUBSTRINGS = [
  "text",
  "transcript",
  "name",
  "phone",
  "email",
  "contact",
  "message",
  "input",
  "content",
  "prompt",
  "utterance",
  "address",
  "secret",
  "password",
  "cookie",
  "authorization",
  "iban",
];

/**
 * Dropped when one WORD of the name (camelCase, snake_case, kebab-case) is one of these. Short
 * words would match far too much as substrings ("ip" is in "description", "key" in "monkey").
 */
const DENIED_WORDS = new Set(["ip", "ips", "key", "keys", "token", "body", "audio"]);

/** Reviewed exceptions: these names carry a class or tool name, never a person's. */
const ALLOWED_FIELDS = new Set(["errorName", "toolName"]);

/** Fields the logger sets itself; a caller cannot overwrite them. */
const RESERVED_FIELDS = new Set(["evt", "ts", "route", "dropped"]);

/** True when a field of this name must never reach the log. */
export function isSensitiveLogField(name: string): boolean {
  if (ALLOWED_FIELDS.has(name)) return false;
  const lower = name.toLowerCase();
  if (DENIED_SUBSTRINGS.some((part) => lower.includes(part))) return true;
  return splitWords(name).some((word) => DENIED_WORDS.has(word));
}

/**
 * The fields that may be logged, with the guard applied. `dropped` counts what was removed (only
 * present when something was). Exported for tests.
 */
export function sanitizeVoiceLogFields(fields: Record<string, unknown>): Record<string, VoiceLogValue> {
  const clean: Record<string, VoiceLogValue> = {};
  let dropped = 0;
  for (const [name, value] of Object.entries(fields)) {
    if (RESERVED_FIELDS.has(name)) continue;
    if (isSensitiveLogField(name)) {
      dropped += 1;
      continue;
    }
    if (value === undefined) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      clean[name] = value;
    } else if (typeof value === "string") {
      clean[name] = value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}…` : value;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) clean.dropped = dropped;
  return clean;
}

/** Writes one voice event. Never throws: a log line must not break a conversation. */
export function logVoiceEvent(fields: Record<string, unknown>): void {
  try {
    logEvent({ route: "voice", ...sanitizeVoiceLogFields(fields) });
  } catch {
    // Nothing sensible to do: logging is best effort.
  }
}

function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}
