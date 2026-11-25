// POST /api/voice/turn: one caller utterance of a "local" session, answered as Server-Sent Events
// (TurnStreamEvent frames, ": ping" keep-alives). The checks and the stream are in
// lib/voice/server/handlers.ts (handleTurnRequest); the turn itself in lib/voice/server/brain.ts.
import { handleTurnRequest } from "@/lib/voice/server/handlers";
import { routeKeepAlive } from "@/lib/voice/server/keep-alive";

export const runtime = "nodejs";
// A turn ends within 20 seconds (brain.ts TURN_DEADLINE_MS); the rest covers saving the state and,
// when the assistant ended the call, the summary email.
export const maxDuration = 35;

// The widget hangs up as soon as it reads the last event: what runs after it (the summary of a
// call the assistant ended, a spend alert) is kept alive by after() (keep-alive.ts).
const keepAlive = routeKeepAlive("turn");

export async function POST(request: Request): Promise<Response> {
  return handleTurnRequest(request, { keepAlive });
}
