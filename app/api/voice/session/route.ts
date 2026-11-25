// POST /api/voice/session: opens a voice conversation and answers with a SessionGrant (a signed,
// short-lived session token, the mode the server grants and the limits), or a JSON VoiceApiError.
// The work, in the order of its checks, is in lib/voice/server/session.ts (openSession).
import { handleSessionRequest } from "@/lib/voice/server/handlers";

export const runtime = "nodejs";
// A realtime provider gets at most 8 seconds to mint its token (providers/index.ts).
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  return handleSessionRequest(request);
}
