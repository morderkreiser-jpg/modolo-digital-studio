// Conversation state + network protocol of the assistant widget.
//
// The browser owns the conversation: it is kept in sessionStorage (gone when the tab closes) and
// the plain-text history is sent with every question, so the server never stores content.
// Replies stream back as Server-Sent Events (lib/assistant/protocol.ts); text deltas are batched
// into at most one React update per animation frame, so a fast stream cannot flood rendering.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { ChatStreamDecoder } from "@/lib/assistant/protocol";
import {
  DEFAULT_LIMITS,
  isAssistantLocale,
  type AssistantLocale,
  type AssistantPublicConfig,
  type ChatErrorCode,
  type ChatRequestBody,
  type ChatStreamEvent,
  type ChatTurn,
  type QuoteFormAction,
} from "@/lib/assistant/types";
import { toPlainText } from "./markdown";

/** Persisted messages per tab (older ones are dropped from storage, not from the screen). */
const MAX_STORED_MESSAGES = 40;
/** Sanity bound for a message restored from storage. */
const MAX_STORED_CHARS = 8_000;
/** The server truncates assistant turns to this; trimming here keeps the size budget honest. */
const MAX_ASSISTANT_CHARS = 4_000;
/**
 * The public config does not expose the history caps, so the request stays within the defaults
 * the server validates against. Only the most recent turns reach the model anyway.
 */
const MAX_HISTORY_MESSAGES = DEFAULT_LIMITS.maxHistoryMessages;
const MAX_HISTORY_CHARS = DEFAULT_LIMITS.maxTotalChars;
/** Abort when the server has sent nothing for this long (connect, first token or a stall). */
const CLIENT_TIMEOUT_MS = 45_000;
/** Longer waits get no countdown: the visitor is pointed to the direct contacts instead. */
const MAX_RETRY_WAIT_S = 90;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MESSAGE_ID_RE = /^[\w-]{1,40}$/;

const CHAT_ERROR_CODES: ReadonlySet<string> = new Set<ChatErrorCode>([
  "bad_request",
  "too_large",
  "forbidden",
  "rate_limited",
  "session_limit",
  "budget_exhausted",
  "unavailable",
  "upstream",
  "timeout",
  "refused",
]);

export type MessageStatus = "streaming" | "done" | "truncated" | "stopped" | "interrupted";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** User messages are always "done". */
  status: MessageStatus;
  /**
   * A question the model refused: it stays on screen but is never sent again. Sent along, it
   * would be merged into the next question and the model would keep refusing.
   */
  excluded?: boolean;
}

/** Server error codes plus the failures only the browser can see. */
export type NoticeCode = ChatErrorCode | "network" | "offline" | "client_timeout";

export interface ChatNotice {
  /** Unique per notice, so a repeated error restarts its countdown. */
  id: number;
  code: NoticeCode;
  /** Seconds to wait before "try again" is enabled (Retry-After), when known. */
  retryAfter: number | null;
  retryable: boolean;
  /** Retrying cannot help (e.g. the history was rejected): offer a new conversation. */
  suggestReset: boolean;
  showContacts: boolean;
}

export interface QuoteFormState {
  /** Identity of this form instance: moving the card keeps the typed values. */
  key: number;
  /** Message the card follows in the conversation (null: right after the welcome). */
  anchorId: string | null;
  service?: string;
  summary?: string;
  /** When the card was shown; the lead API rejects instant (bot) submissions. */
  shownAt: number;
  /** Changes when the visitor asks for the form, so the panel scrolls to it and focuses it. */
  focusToken: number;
}

export interface Announcement {
  id: number;
  kind: "typing" | "reply";
  text: string;
}

export interface AssistantState {
  sessionId: string;
  /** The language picked in the widget; until then (localeChosen false) the page's language applies. */
  locale: AssistantLocale;
  /** Set by the language switch only: a language that merely followed the page is not remembered. */
  localeChosen: boolean;
  messages: ChatMessage[];
  /** waiting: request sent, nothing streamed yet (typing indicator). */
  status: "idle" | "waiting" | "streaming";
  notice: ChatNotice | null;
  /** User messages left in this session, from the last "done" event. */
  remaining: number | null;
  quoteFormShown: boolean;
  leadSubmitted: boolean;
  form: QuoteFormState | null;
  /** What the polite live region should read out (finished answers, "typing…"). */
  announcement: Announcement | null;
  /** Counter for notice / form / announcement ids. */
  seq: number;
}

type Action =
  | { type: "send"; message: ChatMessage }
  | { type: "retry" }
  | { type: "delta"; id: string; text: string }
  | { type: "action"; id: string; action: QuoteFormAction; at: number; enabled: boolean }
  | { type: "done"; id: string; truncated: boolean; remaining: number | null }
  | { type: "fail"; id: string; code: NoticeCode; retryAfter: number | null }
  | { type: "stopped"; id: string }
  | { type: "reset" }
  | { type: "locale"; locale: AssistantLocale }
  | { type: "openForm"; at: number }
  | { type: "closeForm" }
  | { type: "leadSubmitted" }
  | { type: "dismissNotice" };

// ---------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(data);
  else for (let i = 0; i < bytes; i += 1) data[i] = Math.floor(Math.random() * 256);
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Per-tab session id, [A-Za-z0-9_-]{16,64}. randomUUID is missing outside secure contexts. */
function newSessionId(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : "";
  const id = uuid.replace(/[^A-Za-z0-9_-]/g, "");
  return id.length >= 16 ? id.slice(0, 64) : randomHex(16);
}

function newMessageId(): string {
  return `m${randomHex(8)}`;
}

// ---------------------------------------------------------------------------------------------
// Persistence (sessionStorage; every access guarded: private modes and blocked storage throw)
// ---------------------------------------------------------------------------------------------

interface SavedState {
  sessionId: string;
  messages: ChatMessage[];
  locale: AssistantLocale | null;
  quoteFormShown: boolean;
  leadSubmitted: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function restoreMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  for (const item of value.slice(-MAX_STORED_MESSAGES)) {
    if (!isRecord(item)) continue;
    const { id, role, text, status, excluded } = item;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string" || !text.trim()) continue;
    const safeId = typeof id === "string" && MESSAGE_ID_RE.test(id) && !seen.has(id) ? id : newMessageId();
    seen.add(safeId);
    const restored: MessageStatus =
      role === "assistant" && (status === "truncated" || status === "stopped" || status === "interrupted")
        ? status
        : "done";
    messages.push({
      id: safeId,
      role,
      text: text.slice(0, MAX_STORED_CHARS),
      status: restored,
      // A reload must not bring a refused question back into the requests.
      ...(role === "user" && excluded === true ? { excluded: true } : {}),
    });
  }
  return messages;
}

function readSaved(key: string, locales: AssistantLocale[]): SavedState | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || typeof data.sessionId !== "string" || !SESSION_ID_RE.test(data.sessionId)) return null;
    return {
      sessionId: data.sessionId,
      messages: restoreMessages(data.messages),
      locale: isAssistantLocale(data.locale) && locales.includes(data.locale) ? data.locale : null,
      quoteFormShown: data.quoteFormShown === true,
      leadSubmitted: data.leadSubmitted === true,
    };
  } catch {
    return null;
  }
}

function writeSaved(key: string, state: AssistantState): void {
  const saved = {
    sessionId: state.sessionId,
    messages: state.messages
      .filter((message) => message.text.trim())
      .slice(-MAX_STORED_MESSAGES)
      .map(({ id, role, text, status, excluded }) => ({
        id,
        role,
        text,
        status: status === "streaming" ? "interrupted" : status,
        ...(excluded ? { excluded: true } : {}),
      })),
    // Only an explicit choice is remembered: otherwise the widget follows the page's language,
    // also after the visitor switches the site to another language in this tab.
    locale: state.localeChosen ? state.locale : null,
    quoteFormShown: state.quoteFormShown,
    leadSubmitted: state.leadSubmitted,
  };
  try {
    window.sessionStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the conversation keeps working, it just won't survive a reload.
  }
}

function storageKey(tenant: string): string {
  return `mda:${tenant}:v1`;
}

/** The page's language (as far as the widget speaks it). */
function pageLocale(config: AssistantPublicConfig): AssistantLocale {
  return config.locales.includes(config.locale) ? config.locale : (config.locales[0] ?? config.locale);
}

function initState(config: AssistantPublicConfig): AssistantState {
  const saved = readSaved(storageKey(config.tenant), config.locales);
  return {
    sessionId: saved?.sessionId ?? newSessionId(),
    locale: saved?.locale ?? pageLocale(config),
    localeChosen: saved?.locale != null,
    messages: saved?.messages ?? [],
    status: "idle",
    notice: null,
    remaining: null,
    quoteFormShown: saved?.quoteFormShown ?? false,
    leadSubmitted: saved?.leadSubmitted ?? false,
    form: null,
    announcement: null,
    seq: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------

/** What the visitor can do about each failure. */
function noticeFor(id: number, code: NoticeCode, retryAfter: number | null): ChatNotice {
  const wait = retryAfter !== null && retryAfter > 0 ? Math.ceil(retryAfter) : null;
  const shortWait = wait === null || wait <= MAX_RETRY_WAIT_S;
  const base = { id, code, retryAfter: wait, retryable: false, suggestReset: false, showContacts: false };
  switch (code) {
    case "rate_limited":
      return { ...base, retryable: shortWait, showContacts: !shortWait };
    case "budget_exhausted":
      return { ...base, retryable: wait !== null && wait <= MAX_RETRY_WAIT_S, showContacts: true };
    case "unavailable":
      return { ...base, retryable: shortWait, showContacts: true };
    case "session_limit":
    case "forbidden":
      return { ...base, showContacts: true };
    case "bad_request":
    case "too_large":
      return { ...base, suggestReset: true };
    case "refused":
      // The question is left out of later requests, so the chat can go on; a fresh start is offered too.
      return { ...base, suggestReset: true };
    case "upstream":
    case "timeout":
    case "client_timeout":
    case "network":
    case "offline":
      return { ...base, retryable: shortWait, showContacts: !shortWait };
  }
}

/** Drop the partial answer of a failed attempt, so a retry asks the same question again. */
function withoutPartialReply(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && last.status === "interrupted" ? messages.slice(0, -1) : messages;
}

/** Mark the newest question (the one an answer was refused for) as never to be sent again. */
function excludeLastQuestion(messages: ChatMessage[]): ChatMessage[] {
  let index = messages.length - 1;
  while (index >= 0 && messages[index].role !== "user") index -= 1;
  return index === -1
    ? messages
    : messages.map((message, i) => (i === index ? { ...message, excluded: true } : message));
}

function reducer(state: AssistantState, action: Action): AssistantState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        messages: [...state.messages, action.message],
        status: "waiting",
        notice: null,
        seq: state.seq + 1,
        announcement: { id: state.seq + 1, kind: "typing", text: "" },
      };
    case "retry":
      return {
        ...state,
        messages: withoutPartialReply(state.messages),
        status: "waiting",
        notice: null,
        seq: state.seq + 1,
        announcement: { id: state.seq + 1, kind: "typing", text: "" },
      };
    case "delta": {
      // A late chunk after stop/reset has no conversation to go into.
      if (state.status === "idle") return state;
      const index = state.messages.findIndex((message) => message.id === action.id);
      const messages =
        index === -1
          ? [...state.messages, { id: action.id, role: "assistant" as const, text: action.text, status: "streaming" as const }]
          : state.messages.map((message, i) => (i === index ? { ...message, text: message.text + action.text } : message));
      return { ...state, messages, status: "streaming" };
    }
    case "action": {
      if (!action.enabled) return state;
      if (state.leadSubmitted) return { ...state, quoteFormShown: true };
      const anchorId = state.messages.some((message) => message.id === action.id)
        ? action.id
        : (state.messages[state.messages.length - 1]?.id ?? null);
      // A form that is already on screen moves under the newest offer and keeps what was typed.
      const form: QuoteFormState = state.form
        ? { ...state.form, anchorId }
        : {
            key: state.seq + 1,
            anchorId,
            service: action.action.service,
            summary: action.action.summary,
            shownAt: action.at,
            focusToken: 0,
          };
      return { ...state, form, quoteFormShown: true, seq: state.seq + 1 };
    }
    case "done": {
      const reply = state.messages.find((message) => message.id === action.id);
      return {
        ...state,
        status: "idle",
        remaining: action.remaining ?? state.remaining,
        messages: state.messages.map((message) =>
          message.id === action.id ? { ...message, status: action.truncated ? "truncated" : "done" } : message,
        ),
        seq: state.seq + 1,
        // No text (e.g. only the form was offered): "typing…" must not linger in the live region.
        announcement: reply?.text.trim() ? { id: state.seq + 1, kind: "reply", text: toPlainText(reply.text) } : null,
      };
    }
    case "fail": {
      // A refusal can cut in after some text has streamed: that partial answer goes, and so does
      // the question, from every later request (it stays on screen, marked).
      const refused = action.code === "refused";
      const messages = state.messages.flatMap((message) => {
        if (message.id !== action.id) return [message];
        return !refused && message.text.trim() ? [{ ...message, status: "interrupted" as const }] : [];
      });
      return {
        ...state,
        status: "idle",
        remaining: action.code === "session_limit" ? 0 : state.remaining,
        messages: refused ? excludeLastQuestion(messages) : messages,
        notice: noticeFor(state.seq + 1, action.code, action.retryAfter),
        seq: state.seq + 1,
        // The notice (role="alert") speaks for itself; a stale "typing…" must not.
        announcement: null,
      };
    }
    case "stopped":
      return {
        ...state,
        status: "idle",
        messages: state.messages.flatMap((message) => {
          if (message.id !== action.id) return [message];
          return message.text.trim() ? [{ ...message, status: "stopped" as const }] : [];
        }),
        announcement: null,
      };
    case "reset":
      // Same session id on purpose: the per-session message cap must not reset with a click.
      return {
        ...state,
        messages: [],
        status: "idle",
        notice: null,
        form: null,
        quoteFormShown: false,
        announcement: null,
      };
    case "locale":
      // The live region's text is translated: switching would read the last announcement again.
      return { ...state, locale: action.locale, localeChosen: true, announcement: null };
    case "openForm": {
      const focusToken = state.seq + 1;
      if (state.form) return { ...state, form: { ...state.form, focusToken }, seq: focusToken };
      return {
        ...state,
        form: {
          key: focusToken,
          anchorId: state.messages[state.messages.length - 1]?.id ?? null,
          shownAt: action.at,
          focusToken,
        },
        quoteFormShown: true,
        seq: focusToken,
      };
    }
    case "closeForm":
      return { ...state, form: null };
    case "leadSubmitted":
      return { ...state, leadSubmitted: true, quoteFormShown: true };
    case "dismissNotice":
      return { ...state, notice: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------------------------

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === "string" && CHAT_ERROR_CODES.has(value);
}

function positiveSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/** Retry-After as seconds or as an HTTP date. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.ceil(seconds) : null;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

function codeForStatus(status: number): ChatErrorCode {
  if (status === 400) return "bad_request";
  if (status === 403) return "forbidden";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  if (status === 504) return "timeout";
  return "upstream";
}

async function readFailure(response: Response): Promise<{ code: ChatErrorCode; retryAfter: number | null }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy page, an empty body): the status code decides.
  }
  const error = isRecord(body) ? body.error : undefined;
  return {
    code: isChatErrorCode(error) ? error : codeForStatus(response.status),
    retryAfter:
      (isRecord(body) ? positiveSeconds(body.retryAfter) : null) ?? parseRetryAfter(response.headers.get("Retry-After")),
  };
}

/** The decoder only checks the event type; the payload is still untrusted. */
function toQuoteAction(value: unknown): QuoteFormAction | null {
  if (!isRecord(value) || value.kind !== "quote_form") return null;
  return {
    kind: "quote_form",
    service: typeof value.service === "string" ? value.service.slice(0, 64) : undefined,
    summary: typeof value.summary === "string" ? value.summary.slice(0, 600) : undefined,
  };
}

function toRemaining(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/** History sent to the server: newest turns that fit the caps, starting with a user turn. */
function toHistory(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && turns.length < MAX_HISTORY_MESSAGES; i -= 1) {
    const message = messages[i];
    if (message.excluded) continue;
    const content = (message.role === "assistant" ? message.text.slice(0, MAX_ASSISTANT_CHARS) : message.text).trim();
    if (!content) continue;
    if (turns.length > 0 && total + content.length > MAX_HISTORY_CHARS) break;
    total += content.length;
    turns.push({ role: message.role, content });
  }
  turns.reverse();
  while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
  return turns;
}

/** A function, not an inline check: connectivity changes while a request is in flight. */
function isOffline(): boolean {
  return navigator.onLine === false;
}

function currentPage(): string | undefined {
  const path = window.location.pathname;
  return path.startsWith("/") && path.length <= 200 ? path : undefined;
}

type AbortReason = "stop" | "timeout" | "reset" | "unmount";

interface StreamRun {
  controller: AbortController;
  reason: AbortReason | null;
}

function abortRun(run: StreamRun | null, reason: AbortReason): void {
  if (!run || run.reason) return;
  run.reason = reason;
  run.controller.abort();
}

// ---------------------------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------------------------

export function useAssistant(config: AssistantPublicConfig) {
  const [state, dispatch] = useReducer(reducer, config, initState);
  const key = storageKey(config.tenant);
  // Until the visitor picks a language in the widget, it speaks the page's: derived rather than
  // stored, so it also follows a language switch of the site while the panel stays mounted.
  const locale = state.localeChosen ? state.locale : pageLocale(config);
  const runRef = useRef<StreamRun | null>(null);
  const pendingRef = useRef({ id: "", text: "" });
  const frameRef = useRef(0);

  // Save whenever something persistent changed, except mid-stream (every frame would write).
  useEffect(() => {
    if (state.status !== "streaming") writeSaved(key, state);
  }, [key, state]);

  const flushText = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const { id, text } = pendingRef.current;
    if (!text) return;
    pendingRef.current = { id, text: "" };
    dispatch({ type: "delta", id, text });
  }, []);

  const queueText = useCallback(
    (id: string, text: string) => {
      const pending = pendingRef.current;
      pendingRef.current = { id, text: pending.id === id ? pending.text + text : text };
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        flushText();
      });
    },
    [flushText],
  );

  const discardStream = useCallback((reason: AbortReason) => {
    abortRun(runRef.current, reason);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    pendingRef.current = { id: "", text: "" };
  }, []);

  // Closing the panel keeps it mounted; this runs only when the widget itself goes away.
  useEffect(() => () => discardStream("unmount"), [discardStream]);

  const leadsEnabled = config.leads.enabled;
  const chatEndpoint = config.endpoints.chat;

  const streamReply = useCallback(
    async (body: ChatRequestBody) => {
      const replyId = newMessageId();
      const run: StreamRun = { controller: new AbortController(), reason: null };
      runRef.current = run;
      const fail = (code: NoticeCode, retryAfter: number | null = null) => {
        flushText();
        dispatch({ type: "fail", id: replyId, code, retryAfter });
      };

      if (isOffline()) {
        runRef.current = null;
        fail("offline");
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const armTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => abortRun(run, "timeout"), CLIENT_TIMEOUT_MS);
      };
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let settled = false;
      let answered = false;

      const handle = (event: ChatStreamEvent) => {
        switch (event.type) {
          case "start":
            // Accepted by the server; the typing indicator stays until the first text arrives.
            return;
          case "delta":
            if (typeof event.text === "string" && event.text) {
              answered = true;
              queueText(replyId, event.text);
            }
            return;
          case "action": {
            const action = toQuoteAction(event.action);
            if (!action) return;
            answered = true;
            flushText();
            dispatch({ type: "action", id: replyId, action, at: Date.now(), enabled: leadsEnabled });
            return;
          }
          case "done":
            settled = true;
            if (!answered) {
              // An empty answer helps nobody: show it as a failed attempt the visitor can retry.
              fail("upstream");
              return;
            }
            flushText();
            dispatch({
              type: "done",
              id: replyId,
              truncated: event.stop === "max_tokens",
              remaining: toRemaining(event.remaining),
            });
            return;
          case "error":
            settled = true;
            fail(isChatErrorCode(event.code) ? event.code : "upstream", positiveSeconds(event.retryAfter));
            return;
        }
      };

      armTimeout();
      try {
        const response = await fetch(chatEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: run.controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          const failure = await readFailure(response);
          if (run.reason) throw new Error(run.reason);
          settled = true;
          fail(failure.code, failure.retryAfter);
          return;
        }
        if (!response.body || !(response.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
          settled = true;
          fail("upstream");
          return;
        }

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const sse = new ChatStreamDecoder();
        while (!settled) {
          const { value, done } = await reader.read();
          if (done) break;
          armTimeout();
          for (const event of sse.push(decoder.decode(value, { stream: true }))) {
            handle(event);
            if (settled) break;
          }
        }
        if (!settled) {
          for (const event of [...sse.push(decoder.decode()), ...sse.flush()]) {
            handle(event);
            if (settled) break;
          }
        }
        // The stream ended without "done" or "error": the connection was cut mid-answer.
        if (!settled) fail("network");
      } catch {
        if (run.reason === "stop") {
          flushText();
          dispatch({ type: "stopped", id: replyId });
        } else if (run.reason === "timeout") {
          fail("client_timeout");
        } else if (run.reason === null) {
          fail(isOffline() ? "offline" : "network");
        }
        // "reset" / "unmount": that conversation is gone, there is nothing left to update.
      } finally {
        clearTimeout(timer);
        if (runRef.current === run) runRef.current = null;
        // Finished early (done/error before EOF): release the connection right away.
        if (reader && settled) reader.cancel().catch(() => undefined);
      }
    },
    [chatEndpoint, leadsEnabled, flushText, queueText],
  );

  const buildBody = (messages: ChatMessage[], honeypot: string): ChatRequestBody => ({
    tenant: config.tenant,
    sessionId: state.sessionId,
    locale,
    page: currentPage(),
    messages: toHistory(messages),
    state: { quoteFormShown: state.quoteFormShown, leadSubmitted: state.leadSubmitted },
    ...(honeypot ? { hp: honeypot } : {}),
  });

  const busy = state.status !== "idle";
  const exhausted = state.remaining === 0;

  /** Send a visitor message. `honeypot` is the hidden field's value (empty for humans). */
  const send = (text: string, honeypot = "") => {
    const content = text.trim().slice(0, config.limits.maxMessageChars);
    if (!content || busy || exhausted) return;
    const message: ChatMessage = { id: newMessageId(), role: "user", text: content, status: "done" };
    dispatch({ type: "send", message });
    void streamReply(buildBody([...state.messages, message], honeypot));
  };

  /** Ask the last question again after a failure. */
  const retry = () => {
    if (busy || exhausted) return;
    const messages = withoutPartialReply(state.messages);
    const last = messages[messages.length - 1];
    if (last?.role !== "user" || last.excluded) return;
    dispatch({ type: "retry" });
    void streamReply(buildBody(messages, ""));
  };

  const stop = useCallback(() => abortRun(runRef.current, "stop"), []);

  const reset = useCallback(() => {
    discardStream("reset");
    dispatch({ type: "reset" });
  }, [discardStream]);

  const setLocale = useCallback((locale: AssistantLocale) => dispatch({ type: "locale", locale }), []);
  const openForm = useCallback(() => dispatch({ type: "openForm", at: Date.now() }), []);
  const closeForm = useCallback(() => dispatch({ type: "closeForm" }), []);
  const markLeadSubmitted = useCallback(() => dispatch({ type: "leadSubmitted" }), []);
  const dismissNotice = useCallback(() => dispatch({ type: "dismissNotice" }), []);

  return {
    state,
    /** The language in effect (use this, not state.locale). */
    locale,
    busy,
    exhausted,
    send,
    retry,
    stop,
    reset,
    setLocale,
    openForm,
    closeForm,
    markLeadSubmitted,
    dismissNotice,
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;

/** The pure parts of the hook, exported for the unit tests (tests/assistant/use-assistant.test.ts). */
export type AssistantAction = Action;
export {
  reducer as assistantReducer,
  initState as initAssistantState,
  writeSaved as saveAssistantState,
  storageKey as assistantStorageKey,
  toHistory,
};
