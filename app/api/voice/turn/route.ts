// POST /api/voice/turn: one caller utterance of a "local" session, answered as Server-Sent Events
// (TurnStreamEvent frames, ": ping" keep-alives). The checks and the stream are in
// lib/voice/server/handlers.ts (handleTurnRequest); the turn itself in lib/voice/server/brain.ts.
import { after } from "next/server";
import { handleTurnRequest } from "@/lib/voice/server/handlers";
import { logVoiceEvent } from "@/lib/voice/server/log";

export const runtime = "nodejs";
// A turn ends within 20 seconds (brain.ts TURN_DEADLINE_MS); the rest covers saving the state and,
// when the assistant ended the call, the summary email.
export const maxDuration = 35;

export async function POST(request: Request): Promise<Response> {
  return handleTurnRequest(request, { keepAlive });
}

let afterUnavailableLogged = false;

/**
 * Has the platform keep the function alive until `work` is done: the widget hangs up as soon as it
 * reads the last event. after() throws outside a request scope; the turn then works without that
 * guarantee, and the first occurrence is logged.
 */
function keepAlive(work: Promise<unknown>): void {
  try {
    after(() => work);
  } catch (error) {
    if (afterUnavailableLogged) return;
    afterUnavailableLogged = true;
    logVoiceEvent({ op: "turn", warn: "after_unavailable", errorName: error instanceof Error ? error.name : typeof error });
  }
}
