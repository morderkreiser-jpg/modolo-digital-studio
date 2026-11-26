// Store keys of a realtime call ("call" kind), all in the accounting store. Server-only.
//
//   mva:rtc:<sid>:open    counter, must be 1: one call per session (/api/voice/call)
//   mva:rtc:<sid>:ready   counter: the browser's peer connection is connected and plays
//                         (/api/voice/ready; polled by the call controller)
//   mva:rtc:<sid>:call    the provider's call id while the call runs, so that the end route can
//                         hang it up from another instance; cleared ("" with TTL 1) at the end
//
// Imported by session.ts and call.ts; it imports only types, so it closes no import cycle.
import type { KVStore } from "@/lib/assistant/server/store";
import { CALL_ID_RE } from "@/lib/voice/server/providers/types";

/**
 * Seconds between the session's admission and the browser's call request. The microphone prompt
 * comes before the session request, so the offer normally follows the grant within a second; the
 * window plus the create, control-open and read-back bounds stays inside one admission lease.
 */
export const CALL_OPEN_WINDOW_SECONDS = 30;

export function rtcOpenKey(sessionId: string): string {
  return `mva:rtc:${sessionId}:open`;
}

export function rtcReadyKey(sessionId: string): string {
  return `mva:rtc:${sessionId}:ready`;
}

export function rtcCallKey(sessionId: string): string {
  return `mva:rtc:${sessionId}:call`;
}

/** Stores the call id of a session. The result of store.set; never throws (a throw is false). */
export async function recordCallId(store: KVStore, sessionId: string, callId: string, ttlSeconds: number): Promise<boolean> {
  try {
    return await store.set(rtcCallKey(sessionId), callId, ttlSeconds);
  } catch {
    return false;
  }
}

/** The recorded call id, or null (none, cleared, not a call id, or the store failed). Never throws. */
export async function readCallId(store: KVStore, sessionId: string): Promise<string | null> {
  try {
    const value = await store.get(rtcCallKey(sessionId));
    return typeof value === "string" && CALL_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * False only when the store answered that no call id is recorded any more (somebody hung the call
 * up and cleared it). A store that fails counts as "still recorded": the hang-up is then tried
 * rather than skipped. Never throws.
 */
export async function callIdStillRecorded(store: KVStore, sessionId: string): Promise<boolean> {
  try {
    const value = await store.get(rtcCallKey(sessionId));
    return typeof value === "string" && CALL_ID_RE.test(value);
  } catch {
    return true;
  }
}

/** Forgets the call id (the store has no delete: an empty value that expires at once). Never throws. */
export async function clearCallId(store: KVStore, sessionId: string): Promise<void> {
  try {
    await store.set(rtcCallKey(sessionId), "", 1);
  } catch {
    // The key expires by itself; readCallId refuses anything that is not a call id.
  }
}
