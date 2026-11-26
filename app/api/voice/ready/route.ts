// POST /api/voice/ready: the browser's word that the peer connection of its realtime call is
// connected and plays, so the call's controller (possibly on another instance) greets. Answers
// { ok: true }. The work is in lib/voice/server/call.ts (handleReadyRequest).
import { handleReadyRequest } from "@/lib/voice/server/call";

export const runtime = "nodejs";
// A token check and one store increment.
export const maxDuration = 10;

export async function POST(request: Request): Promise<Response> {
  return handleReadyRequest(request);
}
