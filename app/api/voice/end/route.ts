// POST /api/voice/end: the widget reports that a conversation is over (often with
// navigator.sendBeacon while the page closes, so the body may arrive as text/plain). Answers
// { ok: true } and is idempotent: the reservation is settled and the summary sent only once.
// The work is in lib/voice/server/session.ts (closeSession).
import { handleEndRequest } from "@/lib/voice/server/handlers";

export const runtime = "nodejs";
// Settling is a few store round trips; the summary email has an 8-second timeout.
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  return handleEndRequest(request);
}
