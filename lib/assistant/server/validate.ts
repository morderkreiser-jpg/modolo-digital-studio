// Validation of the chat request body. The browser is untrusted: everything is checked, cleaned
// and bounded here before it can reach the prompt or the model. Pure module.
import { cleanText } from "@/lib/assistant/lead-schema";
import {
  isAssistantLocale,
  type AssistantLimits,
  type ChatRequestBody,
  type ChatTurn,
  type TenantConfig,
} from "@/lib/assistant/types";

export type ChatBodyResult =
  | { ok: true; body: ChatRequestBody }
  | { ok: false; code: "bad_request" | "forbidden" };

const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const PAGE_MAX_CHARS = 200;
// Characters a browser can put in a pathname (+ query), per RFC 3986. The page is shown to the
// model as context, so free text (spaces, quotes, newlines) is rejected rather than injected.
const PAGE_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;
const ASSISTANT_TURN_MAX_CHARS = 4000;

const BAD_REQUEST: ChatBodyResult = { ok: false, code: "bad_request" };
const FORBIDDEN: ChatBodyResult = { ok: false, code: "forbidden" };

export function validateChatBody(
  raw: unknown,
  tenant: TenantConfig,
  limits: AssistantLimits,
): ChatBodyResult {
  if (!isRecord(raw) || raw.tenant !== tenant.id) return BAD_REQUEST;
  // Honeypot: a hidden field that only bots fill in.
  if (isFilled(raw.hp)) return FORBIDDEN;

  const sessionId = raw.sessionId;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return BAD_REQUEST;

  const messages = readMessages(raw.messages, limits);
  if (messages === null) return BAD_REQUEST;

  const locale =
    isAssistantLocale(raw.locale) && tenant.locales.includes(raw.locale)
      ? raw.locale
      : tenant.defaultLocale;
  const page = readPage(raw.page);
  const state = isRecord(raw.state) ? raw.state : {};

  return {
    ok: true,
    body: {
      tenant: tenant.id,
      sessionId,
      locale,
      ...(page !== null ? { page } : {}),
      messages,
      state: {
        quoteFormShown: state.quoteFormShown === true,
        leadSubmitted: state.leadSubmitted === true,
      },
    },
  };
}

// Hard ceiling on the array the server will even look at, whatever the limits say. Beyond the
// configured history length the oldest turns are simply forgotten (like the character budget
// below): the browser does not know this tenant's limit, so refusing would trap the visitor.
const MAX_ARRAY_SCAN = 200;

function readMessages(value: unknown, limits: AssistantLimits): ChatTurn[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARRAY_SCAN) return null;

  const turns: ChatTurn[] = [];
  for (const item of value.slice(-Math.max(1, limits.maxHistoryMessages))) {
    if (!isRecord(item) || typeof item.content !== "string") return null;
    // toWellFormed: a lone surrogate (valid in JSON, invalid UTF-8) would make the API reject the
    // request, which would read as a provider misconfiguration in the logs.
    const content = cleanText(item.content.toWellFormed());
    if (item.role === "user") {
      if (content.length < 1 || content.length > limits.maxMessageChars) return null;
      turns.push({ role: "user", content });
    } else if (item.role === "assistant") {
      // An empty assistant turn (e.g. an answer stopped before its first word) carries nothing and
      // would be rejected by the API as an empty text block.
      if (content) turns.push({ role: "assistant", content: truncate(content, ASSISTANT_TURN_MAX_CHARS) });
    } else {
      return null;
    }
  }

  // Fit the history into the character budget by forgetting the oldest turns. The browser does not
  // know this budget, so refusing the request would trap a long conversation in a permanent error;
  // only the most recent turns are sent to the model anyway.
  let total = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  let start = 0;
  while (start < turns.length - 1 && (total > limits.maxTotalChars || turns[start].role === "assistant")) {
    total -= turns[start].content.length;
    start += 1;
  }
  // The loop leaves a user turn first unless only the last turn remains, so checking the last turn
  // covers "starts with user" too.
  const kept = turns.slice(start);
  const last = kept[kept.length - 1];
  if (!last || last.role !== "user" || total > limits.maxTotalChars) return null;
  return kept;
}

function readPage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > PAGE_MAX_CHARS || !PAGE_PATH.test(value)) return null;
  return value;
}

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim() !== "";
}

// Never cut a surrogate pair in half.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
