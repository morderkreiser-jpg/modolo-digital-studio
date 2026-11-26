// POST /api/voice/session: opens a voice conversation and answers with a SessionGrant (a signed,
// short-lived session token, the mode the server grants and the limits), or a JSON VoiceApiError.
// The work, in the order of its checks, is in lib/voice/server/session.ts (openSession).
import { handleSessionRequest } from "@/lib/voice/server/handlers";
import { routeKeepAlive } from "@/lib/voice/server/keep-alive";

export const runtime = "nodejs";
// A realtime provider gets at most 8 seconds to mint its token (providers/index.ts).
export const maxDuration = 15;

// An admission (or its refusal at the spend ceiling) may cross an alert threshold: the alert email
// runs past the response and is kept alive by after() (keep-alive.ts, alerts.ts).
const keepAlive = routeKeepAlive("session");

export async function POST(request: Request): Promise<Response> {
  return handleSessionRequest(request, { keepAlive });
}
