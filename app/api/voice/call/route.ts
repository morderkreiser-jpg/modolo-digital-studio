// POST /api/voice/call: the browser's SDP offer of a realtime session in, the provider's answer and
// the call's events out, as Server-Sent Events (CallStreamEvent frames, ": ping" keep-alives). Our
// server creates the call and holds its control connection until the end. The checks, the stream
// and the end are in lib/voice/server/call.ts (handleCallRequest).
import { handleCallRequest } from "@/lib/voice/server/call";
import { routeKeepAlive } from "@/lib/voice/server/keep-alive";

export const runtime = "nodejs";
// One whole call: the setup, at most VOICE_REALTIME_CALL_MAX_SECONDS of conversation and the end
// sequence. Must equal CALL_ROUTE_MAX_DURATION_SECONDS in call.ts: a test checks it.
export const maxDuration = 300;

// The end of a call (the tool drain, the settlement, the summary) runs past the moment the
// browser stops reading: it is kept alive by after() (keep-alive.ts).
const keepAlive = routeKeepAlive("call");

export async function POST(request: Request): Promise<Response> {
  return handleCallRequest(request, { keepAlive });
}
