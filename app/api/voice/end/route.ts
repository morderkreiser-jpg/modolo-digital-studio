// POST /api/voice/end: the widget reports that a conversation is over (often with
// navigator.sendBeacon while the page closes, so the body may arrive as text/plain). Answers
// { ok: true } and is idempotent: the reservation is settled and the summary sent only once.
// The work is in lib/voice/server/session.ts (closeSession). For a realtime call it also hangs up
// the recorded call (at most 1.5 s), in parallel with settling.
import { handleEndRequest } from "@/lib/voice/server/handlers";

export const runtime = "nodejs";
// Settling is a few store round trips; the summary email has an 8-second timeout; the hang-up
// runs beside them.
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  return handleEndRequest(request);
}
