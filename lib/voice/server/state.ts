// Server-side state of one voice session. Server-only.
//
// WHAT THIS IS, PLAINLY: in the text-turn mode ("local") the browser sends only what the caller
// just said; everything else lives here, because the browser must not be trusted with tool
// results, counters or the history the model sees. So this state CONTAINS WHAT THE CALLER SAID
// (their words, and the names, phone numbers and addresses they gave the tools), plus what the
// assistant answered and what the tools did.
//
//   - It lives only for the length of the session plus a short margin (stateTtlSeconds()), and is
//     overwritten with an empty value when the session ends (clearState()). Nothing is archived.
//   - With the in-memory store it sits in the server's process memory. With Upstash (the shared
//     store, lib/assistant/server/store.ts) it is stored at a THIRD PARTY for that time. Before
//     this runs in production with real callers, the privacy notice must say so (provider, place,
//     duration): see the TODO in lib/voice/tenants/modolo.ts.
//   - Realtime sessions keep only the accounting part here (reservation, counters, outcomes): the
//     conversation itself runs at the voice provider.
//
// Stored as JSON under "mva:state:<session id>". The session id is 128 random bits from the signed
// token, so one session can never read or overwrite another's state. The history is capped: the
// oldest turns are dropped first (whole turns, so a tool call never loses its result).
//
// Thinking blocks of the model are never stored. They are valid only while everything sent before
// them stays byte-identical, and the per-turn part of the system prompt changes on every turn, so
// replaying them in a later turn would be rejected; within one turn the brain keeps them in memory.
import type { KVStore } from "@/lib/assistant/server/store";
import {
  isVoiceLocale,
  type CallSummary,
  type VoiceChannel,
  type VoiceLimits,
  type VoiceLocale,
  type VoiceMode,
} from "@/lib/voice/types";
import type { SessionCounters, ToolMemorySnapshot } from "@/lib/voice/tools/execute";
import { parseSessionReservation, sessionLifetimeSeconds, type SessionReservation } from "./limits";
import { isSessionId, isTenantId } from "./token";

/** One block of the stored conversation: the provider-neutral subset the brain re-sends. */
export type BrainBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface BrainMessage {
  role: "user" | "assistant";
  content: string | BrainBlock[];
}

/** One caller turn: the utterance, the assistant's tool rounds and its reply, in order. */
export interface StoredTurn {
  messages: BrainMessage[];
}

export interface VoiceSessionState {
  v: 1;
  tenantId: string;
  sessionId: string;
  mode: VoiceMode;
  channel: VoiceChannel;
  /** Language of the latest turn. */
  locale: VoiceLocale;
  /** Unix ms of the admission: the call clock and the summary start here. */
  startedAt: number;
  /** Caller turns answered so far (the greeting is not one). */
  turns: number;
  /** The greeting was spoken (opening turn). */
  greeted: boolean;
  /** Oldest first. The greeting, when spoken, is the only message of the first entry. */
  history: StoredTurn[];
  /** Per-session tool caps (execute.ts). One object per request, restored from here. */
  counters: SessionCounters;
  /** Replay memory of execute.ts, carried between requests. */
  toolMemory: ToolMemorySnapshot;
  /** What happened, in order: the call summary is built from this. */
  outcomes: CallSummary["outcomes"];
  /** What admitSession() reserved; settled when the session ends. null for "scripted". */
  reservation: SessionReservation | null;
}

/** Most caller turns kept for the model. A web conversation has 24 at most by default. */
export const MAX_STORED_TURNS = 24;
/** Largest stored state, in characters of JSON (about 100 KB of UTF-16 at worst). */
export const MAX_STATE_CHARS = 48_000;
/** Kept after the session's last possible second, so a late end report still finds it. */
export const STATE_MARGIN_SECONDS = 15 * 60;

const MAX_OUTCOMES = 100;

export function stateKey(sessionId: string): string {
  return `mva:state:${sessionId}`;
}

/** How long a session's state is kept: its whole possible life plus the margin. */
export function stateTtlSeconds(limits: Pick<VoiceLimits, "maxCallSeconds">): number {
  return sessionLifetimeSeconds(limits) + STATE_MARGIN_SECONDS;
}

export function createSessionState(args: {
  tenantId: string;
  sessionId: string;
  mode: VoiceMode;
  channel: VoiceChannel;
  locale: VoiceLocale;
  startedAt: number;
  reservation: SessionReservation | null;
}): VoiceSessionState {
  return {
    v: 1,
    tenantId: args.tenantId,
    sessionId: args.sessionId,
    mode: args.mode,
    channel: args.channel,
    locale: args.locale,
    startedAt: args.startedAt,
    turns: 0,
    greeted: false,
    history: [],
    counters: { toolCalls: 0, bookings: 0, leads: 0 },
    toolMemory: { recorded: [], replies: [] },
    outcomes: [],
    reservation: args.reservation,
  };
}

/** The stored state of a session, or null when there is none (never written, expired, cleared, broken). */
export async function loadState(store: KVStore, sessionId: string): Promise<VoiceSessionState | null> {
  if (!isSessionId(sessionId)) return null;
  let raw: string | null;
  try {
    raw = await store.get(stateKey(sessionId));
  } catch {
    return null;
  }
  if (raw === null || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const state = parseState(value);
  // A state filed under another session's key is not this session's.
  return state !== null && state.sessionId === sessionId ? state : null;
}

/**
 * Stores the state with the oldest turns dropped beyond the caps. False when the store could not
 * keep it (the shared store refuses rather than fall back to process memory). Never throws.
 */
export async function saveState(
  store: KVStore,
  sessionId: string,
  state: VoiceSessionState,
  ttlSeconds: number,
): Promise<boolean> {
  if (!isSessionId(sessionId) || state.sessionId !== sessionId) return false;
  try {
    return await store.set(stateKey(sessionId), serializeState(state), ttlSeconds);
  } catch {
    return false;
  }
}

/** The store has no delete: an empty value that expires at once stands in for it. Never throws. */
export async function clearState(store: KVStore, sessionId: string): Promise<void> {
  if (!isSessionId(sessionId)) return;
  try {
    await store.set(stateKey(sessionId), "", 1);
  } catch {
    // It expires with its TTL anyway.
  }
}

/** JSON of the state within the caps: at most MAX_STORED_TURNS turns and MAX_STATE_CHARS characters. */
export function serializeState(state: VoiceSessionState): string {
  let history = state.history.slice(-MAX_STORED_TURNS);
  const outcomes = state.outcomes.slice(-MAX_OUTCOMES);
  let json = JSON.stringify({ ...state, history, outcomes });
  // Whole turns, oldest first; the latest turn always stays.
  while (json.length > MAX_STATE_CHARS && history.length > 1) {
    history = history.slice(1);
    json = JSON.stringify({ ...state, history, outcomes });
  }
  return json;
}

// ---------------------------------------------------------------------------------------------
// Parsing (the state comes back from storage: checked, not trusted blindly)
// ---------------------------------------------------------------------------------------------

const MODES: readonly VoiceMode[] = ["scripted", "local", "realtime"];
const CHANNELS: readonly VoiceChannel[] = ["web", "phone"];

function parseState(value: unknown): VoiceSessionState | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const { tenantId, sessionId, mode, channel, locale, startedAt, turns, greeted } = value;
  if (!isTenantId(tenantId) || !isSessionId(sessionId)) return null;
  if (!MODES.includes(mode as VoiceMode) || !CHANNELS.includes(channel as VoiceChannel)) return null;
  if (!isVoiceLocale(locale)) return null;
  if (!isCount(startedAt) || !isCount(turns) || typeof greeted !== "boolean") return null;

  const history = Array.isArray(value.history) ? value.history.filter(isStoredTurn) : [];
  const counters: Record<string, unknown> = isRecord(value.counters) ? value.counters : {};
  const reservation = value.reservation === null ? null : parseSessionReservation(value.reservation);
  if (value.reservation !== null && reservation === null) return null;
  // Settlement trusts the reservation: it must belong to this very session.
  if (reservation !== null && (reservation.sessionId !== sessionId || reservation.tenantId !== tenantId)) return null;

  return {
    v: 1,
    tenantId,
    sessionId,
    mode: mode as VoiceMode,
    channel: channel as VoiceChannel,
    locale,
    startedAt,
    turns,
    greeted,
    history,
    counters: {
      toolCalls: isCount(counters.toolCalls) ? counters.toolCalls : 0,
      bookings: isCount(counters.bookings) ? counters.bookings : 0,
      leads: isCount(counters.leads) ? counters.leads : 0,
    },
    toolMemory: parseToolMemory(value.toolMemory),
    outcomes: Array.isArray(value.outcomes)
      ? (value.outcomes.filter((outcome) => isRecord(outcome) && typeof outcome.kind === "string") as CallSummary["outcomes"])
      : [],
    reservation,
  };
}

function parseToolMemory(value: unknown): ToolMemorySnapshot {
  if (!isRecord(value)) return { recorded: [], replies: [] };
  return {
    recorded: Array.isArray(value.recorded) ? value.recorded.filter((key): key is string => typeof key === "string") : [],
    // Checked entry by entry by importToolMemory().
    replies: Array.isArray(value.replies) ? (value.replies as ToolMemorySnapshot["replies"]) : [],
  };
}

function isStoredTurn(value: unknown): value is StoredTurn {
  return isRecord(value) && Array.isArray(value.messages) && value.messages.length > 0 && value.messages.every(isBrainMessage);
}

function isBrainMessage(value: unknown): value is BrainMessage {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant")) return false;
  if (typeof value.content === "string") return true;
  return Array.isArray(value.content) && value.content.every(isBrainBlock);
}

function isBrainBlock(value: unknown): value is BrainBlock {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "text":
      return typeof value.text === "string";
    case "tool_use":
      return typeof value.id === "string" && typeof value.name === "string";
    case "tool_result":
      return typeof value.tool_use_id === "string" && typeof value.content === "string";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
