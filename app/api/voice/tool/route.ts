// POST /api/voice/tool: tool calls and session events of a realtime voice provider during a
// conversation, in OUR neutral, signed request shape (documented on handleToolRequest in
// lib/voice/server/handlers.ts; a provider adapter translates its own webhooks into it). 404 while
// VOICE_PROVIDER_WEBHOOK_SECRET is not set.
import { handleToolRequest } from "@/lib/voice/server/handlers";

export const runtime = "nodejs";
// A calendar or a sink call; a provider waiting longer than this would have hung up on the caller.
// The wait for the session's lock (TOOL_LOCK_WAIT_MS, 3 s) plus the slowest action (an email,
// EMAIL_TIMEOUT_MS, 8 s) must fit inside it, or a killed function keeps the lock: a test checks it.
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  return handleToolRequest(request);
}
