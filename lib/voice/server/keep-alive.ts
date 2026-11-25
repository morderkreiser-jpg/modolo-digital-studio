// The keepAlive the voice routes hand to their handlers (VoiceDeps.keepAlive). Server-only.
//
// A serverless function may be frozen or ended once its response is sent. Work that runs past the
// response (a spend alert email started by a session or tool request, alerts.ts; the summary of a
// turn that ended the call, handlers.ts) is therefore handed to Next's after(), which keeps the
// function alive until it is done. Every route that can start such work passes this (review
// finding alerts-no-keepalive): app/api/voice/session, tool and turn.
//
// after() throws outside a request scope. The keepAlive then answers false, so the caller waits
// for the work itself where it can (alerts.ts), and the first occurrence per route is logged.
import { after } from "next/server";
import { logVoiceEvent } from "./log";

const unavailableLogged = new Set<string>();

/** The keepAlive of the route `op` ("session", "tool", "turn"): true when after() took the work. */
export function routeKeepAlive(op: string): (work: Promise<unknown>) => boolean {
  return (work) => {
    try {
      after(() => work);
      return true;
    } catch (error) {
      if (!unavailableLogged.has(op)) {
        unavailableLogged.add(op);
        logVoiceEvent({ op, warn: "after_unavailable", errorName: error instanceof Error ? error.name : typeof error });
      }
      return false;
    }
  };
}
