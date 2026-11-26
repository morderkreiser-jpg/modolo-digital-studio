// The realtime call endpoints of a provider of the "call" kind (OpenAI): our server creates the
// call from the browser's SDP offer, answers with an event stream, and holds the call's control
// connection for its whole life (realtime/controller.ts). Server-only. The route files
// app/api/voice/call and app/api/voice/ready are thin wrappers around these handlers.
//
// POST /api/voice/call, in order:
//   switch + secret + realtime mode → body → token (no grace) → realtime session → tenant FROM
//   THE TOKEN + origin → a call provider → the open window (CALL_OPEN_WINDOW_SECONDS after
//   admission) → session not closed → the offer (realtime/sdp.ts) → once per session (409) →
//   the session is registered as running for its whole life (holdRealtimeCall) → the call is
//   created (behind the breaker, bounded) → the call id is recorded → the stream.
//
// THE MONEY, in order (limits.ts): admission charged nothing; the call is held as running before
// it is created, so the concurrency cap counts it; a failed create gives the slot back
// (settleReportedCall with 0 seconds); the call is charged at the confirmation point (the
// greeting, or the first response of any origin: the controller decides, confirm() charges);
// at the end it is settled to the seconds measured from that point. The money is counted with
// the call length our server can hold (callSecondsFor), never the tenant's longer one. Every end
// path hangs up or knows that somebody else did: the controller always calls the hang-up hook
// (which skips the hang-up when the end route already hung up and cleared the id, and is retried
// by the controller when it fails), a failed or late create hangs up a half-created call, the end
// route hangs up the recorded call id (session.ts), and SIGTERM hangs up what it can.
//
// The end, after the controller has hung up and closed its socket: the running tool and the
// hang-up's retries are drained together (at most TOOL_DRAIN_MS), the call is settled, its id
// cleared once a hang-up succeeded (otherwise it stays recorded, so a later end report can still
// hang up; its own lifetime ends it), the session finished (summary included), one call_end line
// written, the stream closed. Each step on its own: a failing one never skips the next. None of
// them receives the request's signal: on some platforms it fires when the browser drops the
// stream after reading "ended".
//
// Nothing a caller said is stored or logged here: the captions only travel to the visitor's own
// browser, and the log lines carry numbers and codes (never the call id, the SDP or a text).
import type { KVStore } from "@/lib/assistant/server/store";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import {
  isVoiceToolName,
  VOICE_REALTIME_CALL_MAX_SECONDS,
  type CallStreamEvent,
  type ToolCall,
  type ToolOutcome,
  type VoiceLimits,
  type VoiceLocale,
} from "@/lib/voice/types";
import { handoffOf, toolResultText, turnSystem } from "./brain";
import { isOpen, recordFailure, recordSuccess } from "./breaker";
import { getVoiceEnv, resolveVoiceLimits, voiceCostChfPerMinute } from "./env";
import {
  errorResponse,
  guarded,
  HEARTBEAT_FRAME,
  HEARTBEAT_MS,
  json,
  readJsonBody,
  reportCharge,
  runToolCall,
  SSE_CONTENT_TYPE,
  TOOL_LOCK_WAIT_MS,
  tokenRefusal,
} from "./handlers";
import {
  acquireSessionLock,
  confirmRealtimeCall,
  holdRealtimeCall,
  reservationFromClaims,
  sessionLifetimeSeconds,
  settleReportedCall,
  type SessionLock,
} from "./limits";
import { logVoiceEvent } from "./log";
import { buildOpenAiSession, greetingInstructions } from "./providers/openai-session";
import {
  CALL_ID_RE,
  getVoiceProvider,
  isCallProvider,
  type ControllerClock,
  type CreateCallArgs,
  type CreateCallResult,
  type RealtimeCallProvider,
} from "./providers";
import { CONTROL_OPEN_TIMEOUT_MS, runCallController, TOOL_DRAIN_MS, type CallEndReport, type HangUpResult } from "./realtime/controller";
import { CALL_OPEN_WINDOW_SECONDS, callIdStillRecorded, clearCallId, recordCallId, rtcOpenKey, rtcReadyKey } from "./realtime/keys";
import { isAnswerSdp, validateOffer } from "./realtime/sdp";
import { finishSession, isSessionClosed, loadOrRecoverState, originAllowed, refuse, type VoiceDeps } from "./session";
import { stateTtlSeconds } from "./state";
import { voiceStores } from "./stores";
import { verifySessionToken } from "./token";

/** Must equal the literal maxDuration of app/api/voice/call/route.ts (a test checks it). */
export const CALL_ROUTE_MAX_DURATION_SECONDS = 300;
/** Setup before the answer: body, checks, create timeout 10 s, margin. */
export const CALL_SETUP_RESERVE_SECONDS = 12;
/**
 * The end sequence: tail 0.4 s + hang-up ≤ 3 s + tool drain ≤ 13 s + settlement ≤ 3 s +
 * finishSession (lock ≤ 4 s + e-mail ≤ 8 s + store round trips ≤ 2 s) + margin.
 */
export const CALL_END_RESERVE_SECONDS = 36;
export const CALL_CREATE_TIMEOUT_MS = 10_000;
export const HANGUP_TIMEOUT_MS = 3_000;
export { CALL_OPEN_WINDOW_SECONDS } from "./realtime/keys";
const CALL_BODY_BYTES = 16 * 1024;
const READY_BODY_BYTES = 2 * 1024;
const MAX_READY_SIGNALS = 5;
/** Retry-After of a ready signal over MAX_READY_SIGNALS. */
const READY_RETRY_AFTER_SECONDS = 10;
/** Shortest call a grant promises, whatever the tenant's limits say. */
const MIN_CALL_SECONDS = 30;
/** The call ends this long before the session token expires: every tool call stays inside its life. */
const TOKEN_MARGIN_MS = 5_000;
/** A provider's Retry-After is kept within 1..300 seconds. */
const MAX_RETRY_AFTER_SECONDS = 300;

/** What the model hears when a tool cannot run (the lock stays taken, the session is closed). */
const TOOL_UNAVAILABLE: ToolOutcome = {
  ok: false,
  code: "unavailable",
  say: "The action could not be done right now. Say so plainly and offer to try once more.",
};

const encoder = new TextEncoder();

/** Seconds a call may last: max(30, min(limits.maxCallSeconds, VOICE_REALTIME_CALL_MAX_SECONDS)). */
export function callSecondsFor(limits: Pick<VoiceLimits, "maxCallSeconds">): number {
  return Math.max(MIN_CALL_SECONDS, Math.min(limits.maxCallSeconds, VOICE_REALTIME_CALL_MAX_SECONDS));
}

// ---------------------------------------------------------------------------------------------
// POST /api/voice/call
// ---------------------------------------------------------------------------------------------

/**
 * Creates the realtime call of a session from the browser's SDP offer and answers with a
 * `text/event-stream` of CallStreamEvent frames: "answer" first, then the call's events, then
 * "ended" or "error". Refusals before the stream are JSON VoiceApiError bodies.
 */
export async function handleCallRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  return guarded("call", async () => {
    const env = getVoiceEnv();
    const clock = deps.now ?? Date.now;
    const requestStartedAt = clock();
    if (!env.enabled || env.sessionSecret === null || env.mode !== "realtime") return errorResponse(refuse(503, "unavailable"));
    const body = await readJsonBody(request, CALL_BODY_BYTES);
    if (!body.ok) return errorResponse(refuse(body.status, body.code));
    const raw = body.value;
    if (!isRecord(raw)) return errorResponse(refuse(400, "bad_request"));

    const verified = verifySessionToken(raw.sessionToken, env.sessionSecret, requestStartedAt);
    if (!verified.ok) return errorResponse(tokenRefusal(verified.reason));
    const claims = verified.claims;
    if (claims.mode !== "realtime") return errorResponse(refuse(403, "forbidden", claims.tid));
    // The tenant of the token; a "tenant" in the body is never read.
    const tenant = getVoiceTenant(claims.tid);
    if (!tenant) return errorResponse(refuse(403, "forbidden", claims.tid));
    if (!originAllowed(request, tenant)) return errorResponse(refuse(403, "forbidden", tenant.id));
    const configured = deps.provider !== undefined ? deps.provider : getVoiceProvider(env);
    if (!isCallProvider(configured)) return errorResponse(refuse(503, "unavailable", tenant.id));
    const provider = configured;
    // The offer follows the grant within a second or two: an old token is not a call any more.
    if (requestStartedAt - claims.iat * 1000 > CALL_OPEN_WINDOW_SECONDS * 1000) return errorResponse(refuse(401, "expired", tenant.id));

    const { shared, accounting: store } = voiceStores(deps);
    const sid = claims.sid;
    if (await isSessionClosed(store, sid)) return errorResponse(refuse(401, "expired", tenant.id));
    const model = env.openai.model;
    const offer = validateOffer(raw.sdp);
    if (!offer.ok) {
      logVoiceEvent({ op: "call_open", tenant: tenant.id, provider: provider.id, model, outcome: "bad_request", ms: 0, code: offer.rule });
      return errorResponse(refuse(offer.status, offer.code, tenant.id));
    }
    const limits = resolveVoiceLimits(tenant, env);
    // What the call is held, charged and settled with: the call length our server can hold.
    const callLimits: VoiceLimits = { ...limits, maxCallSeconds: callSecondsFor(limits) };
    // One call per session: a retry needs a new session (and passes admission again).
    if ((await store.incrBy(rtcOpenKey(sid), 1, stateTtlSeconds(limits))) !== 1) return errorResponse(refuse(409, "refused", tenant.id));

    // 1-2. Registered as running for the session's whole life BEFORE the call exists.
    const state = await loadOrRecoverState(store, claims);
    const reservation = state.reservation ?? reservationFromClaims(claims, voiceCostChfPerMinute(env, "realtime"));
    if (reservation) {
      try {
        await holdRealtimeCall({ store, reservation, limits: callLimits, now: requestStartedAt });
      } catch (error) {
        logVoiceEvent({ warn: "call_step_failed", tenant: tenant.id, kind: "record", errorName: errorName(error) });
      }
    }

    // 3-5. The session: the prompt variant for speech, the tenant's tools, its languages.
    const callSeconds = callLimits.maxCallSeconds;
    let outcomes = state.outcomes;
    const instructionsAt = (remainingSeconds: number): string =>
      turnSystem({
        tenant,
        state: { channel: claims.ch, outcomes },
        locale: claims.loc,
        now: new Date(clock()),
        remainingSeconds,
        realtime: true,
      })
        .map((block) => block.text)
        .join("\n\n");
    const instructions = instructionsAt(callSeconds);
    // For the speech model: no example phone number in the texts (it may say it aloud).
    const tools = toolDefinitions(tenant, { speech: true });
    const locales: VoiceLocale[] = [claims.loc, ...tenant.locales.filter((locale) => locale !== claims.loc)];
    const session = buildOpenAiSession({ settings: env.openai, instructions, tools, locale: claims.loc, locales, transport: "webrtc" });

    // A failure from here on frees the slot again and charges nothing.
    const giveBack = async (): Promise<void> => {
      if (!reservation) return;
      try {
        await settleReportedCall({ store, reservation, reportedSeconds: 0, limits: callLimits, now: clock() });
      } catch (error) {
        logVoiceEvent({ warn: "call_step_failed", tenant: tenant.id, kind: "settle", errorName: errorName(error) });
      }
    };

    // A call that exists although the request goes no further: hung up, not waited for, and kept
    // alive past the response (on some platforms work left behind is frozen with the function).
    const hangUpInBackground = (work: Promise<string | undefined>): void => {
      const hanging = work
        .then((id) => (id === undefined ? undefined : provider.hangUp(id, { timeoutMs: HANGUP_TIMEOUT_MS })))
        .catch(() => undefined);
      deps.keepAlive?.(hanging);
    };

    // 6-8. The call, behind the breaker and the create timeout.
    const opened = await openCall({
      provider,
      store: shared,
      model,
      now: requestStartedAt,
      signal: request.signal,
      timeoutMs: deps.createTimeoutMs ?? CALL_CREATE_TIMEOUT_MS,
      // The route stopped waiting (the caller left, or the timeout fired): a call the provider
      // still creates afterwards is hung up from its late answer.
      onLate: (late) => hangUpInBackground(late.then((result) => result.callId)),
      args: { tenantId: tenant.id, sessionId: sid, locale: claims.loc, session, offerSdp: offer.sdp },
    });
    if (!opened.ok) {
      // A failed create may still have created a call: it is hung up.
      if (opened.callId) hangUpInBackground(Promise.resolve(opened.callId));
      await giveBack();
      const status = opened.code === "bad_request" ? 400 : opened.code === "upstream" ? 502 : opened.code === "timeout" ? 504 : 503;
      return errorResponse(refuse(status, opened.code, tenant.id, opened.code === "busy" ? opened.retryAfter : undefined));
    }
    const { callId, answerSdp } = opened;

    // 9. The end route hangs the call up from this id (it may run on another instance).
    const idRecorded = await recordCallId(store, sid, callId, sessionLifetimeSeconds(limits) + 60);
    if (!idRecorded) {
      logVoiceEvent({ warn: "call_step_failed", tenant: tenant.id, kind: "record", errorName: "store" });
    }

    // The controller's hang-up hook. A recorded id that is gone means the end route hung the call
    // up and cleared it: nothing to do (and no wait for a call that no longer exists). A successful
    // hang-up clears the id; a failed one leaves it, unless it is gone by now.
    let hungUp = false;
    const hangUpCall = async (): Promise<HangUpResult> => {
      if (idRecorded && !(await callIdStillRecorded(store, sid))) {
        hungUp = true;
        return { ok: true, skipped: true };
      }
      const result = await provider.hangUp(callId, { timeoutMs: HANGUP_TIMEOUT_MS });
      if (result?.ok === true) {
        hungUp = true;
        await clearCallId(store, sid);
        return result;
      }
      if (idRecorded && !(await callIdStillRecorded(store, sid))) {
        hungUp = true;
        return { ok: true, skipped: true };
      }
      return { ok: false, ...(typeof result?.httpStatus === "number" ? { httpStatus: result.httpStatus } : {}) };
    };

    // 10. The deadline: the call's length, the route's maxDuration minus the end, the token's life.
    const answerAt = clock();
    const deadlineAt = Math.min(
      answerAt + callSeconds * 1000,
      requestStartedAt + (CALL_ROUTE_MAX_DURATION_SECONDS - CALL_END_RESERVE_SECONDS) * 1000,
      claims.exp * 1000 - TOKEN_MARGIN_MS,
    );
    const maxSeconds = Math.max(1, Math.floor((deadlineAt - answerAt) / 1000));

    const timers: ControllerClock = deps.timers ?? {
      now: clock,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const greeting = pickVoiceText(tenant.greeting, claims.loc, tenant.defaultLocale);

    // 12. The tools run through the webhook's code path, one at a time, under the session lock.
    const runRealtimeTool = async (call: ToolCall): Promise<ToolOutcome> => {
      let lock: SessionLock | null = null;
      try {
        lock = await acquireSessionLock(store, sid, { clock, waitMs: deps.lockWaitMs ?? TOOL_LOCK_WAIT_MS });
        if (lock === null) return TOOL_UNAVAILABLE;
        if (await isSessionClosed(store, sid)) return TOOL_UNAVAILABLE;
        const run = await runToolCall({ claims, tenant, env, deps, store, now: clock(), call, callLimits });
        outcomes = run.state.outcomes;
        logVoiceEvent({
          op: "tool",
          tenant: tenant.id,
          toolName: isVoiceToolName(call.name) ? call.name : "unknown",
          ok: run.result.ok,
          code: run.result.ok ? undefined : run.result.code,
        });
        return run.result;
      } catch (error) {
        logVoiceEvent({ warn: "call_step_failed", tenant: tenant.id, kind: "tool", errorName: errorName(error) });
        return TOOL_UNAVAILABLE;
      } finally {
        await lock?.release();
      }
    };

    // The charge at the confirmation point, kept so that the end settles only after it.
    let confirming: Promise<void> | null = null;
    const confirm = (): Promise<void> => {
      confirming = (async () => {
        if (!reservation) return;
        const spend = await confirmRealtimeCall({ store, reservation, limits: callLimits, now: clock() });
        await reportCharge({ store, tenantId: tenant.id, spend, limits, env, deps });
      })();
      return confirming;
    };

    // 11. The stream.
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal]);
    const done = Promise.withResolvers<void>();

    const pump = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
      let open = true;
      const write = (frame: string): void => {
        if (!open || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          open = false;
        }
      };
      const send = (event: CallStreamEvent): void => write(`data: ${JSON.stringify(event)}\n\n`);
      let heartbeat: unknown = null;
      const beat = (): void => {
        write(HEARTBEAT_FRAME);
        heartbeat = timers.setTimeout(beat, HEARTBEAT_MS);
      };
      heartbeat = timers.setTimeout(beat, HEARTBEAT_MS);
      const untrack = trackLiveCall(() => void provider.hangUp(callId, { timeoutMs: HANGUP_TIMEOUT_MS }));
      let report: CallEndReport | null = null;
      try {
        send({ type: "answer", sdp: answerSdp, maxSeconds });
        try {
          report = await runCallController({
            tenantId: tenant.id,
            locale: claims.loc,
            greetingText: greetingInstructions(greeting, claims.loc),
            expected: { instructionsChars: instructions.length, toolCount: tools.length },
            limits,
            answerAt,
            deadlineAt,
            maxResponses: env.openai.maxResponses,
            maxCallUsd: env.openai.maxCallUsd,
            model,
            host: env.openai.host,
            transcribeModel: env.openai.transcribe,
            clock: timers,
            signal,
            openControl: () => provider.openControl(callId, { signal, timeoutMs: CONTROL_OPEN_TIMEOUT_MS }),
            hangUp: hangUpCall,
            pollReady: async () => Number.parseInt((await store.get(rtcReadyKey(sid))) ?? "0", 10) > 0,
            pollClosed: () => isSessionClosed(store, sid),
            confirm,
            runTool: runRealtimeTool,
            instructionsAt,
            toolOutput: toolResultText,
            handoffOf: (name, outcome) => handoffOf(name, outcome, tenant, claims.loc),
            emit: send,
            log: (fields) => logVoiceEvent({ ...fields, tenant: tenant.id }),
          });
        } catch (error) {
          // The controller never throws; should it, the call is still hung up and settled below.
          logVoiceEvent({ warn: "call_step_failed", tenant: tenant.id, kind: "controller", errorName: errorName(error) });
          await hangUpCall().catch(() => undefined);
        }
        untrack();
        await endCall(report);
      } finally {
        untrack();
        if (heartbeat !== null) timers.clearTimeout(heartbeat);
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed or cancelled by the runtime.
          }
        }
        done.resolve();
      }
    };

    /** Steps (f)-(j) of the end; the caller closes the stream (k). Never throws. */
    const endCall = async (report: CallEndReport | null): Promise<void> => {
      const loggedSteps = new Set<string>();
      const stepFailed = (kind: string, error: unknown): void => {
        if (loggedSteps.has(kind)) return;
        loggedSteps.add(kind);
        logVoiceEvent({ warn: "call_step_failed", tenant: tenant.id, kind, errorName: errorName(error) });
      };
      // (f) The running tool (its e-mail and state must finish), a charge still in flight and the
      // hang-up's retries, together inside one bound.
      try {
        await waitAtMost(timers, Promise.all([report?.toolDone, confirming, report?.hangUpDone]), TOOL_DRAIN_MS);
      } catch {
        // waitAtMost never rejects.
      }
      // (g) Settled to the seconds measured from the confirmation point. Without a report the
      // length is unknown: everything charged is kept (a non-finite report), the slot is freed.
      const measured = report === null ? Number.NaN : report.confirmedAt === null ? 0 : Math.max(0, (report.endedAt - report.confirmedAt) / 1000);
      try {
        if (reservation) {
          const spend = await settleReportedCall({ store, reservation, reportedSeconds: measured, limits: callLimits, now: clock() });
          await reportCharge({ store, tenantId: tenant.id, spend, limits, env, deps });
        }
      } catch (error) {
        stepFailed("settle", error);
      }
      const seconds = Number.isFinite(measured) ? measured : 0;
      const brakeChf = round6((Math.ceil(seconds) / 60) * voiceCostChfPerMinute(env, "realtime"));
      const usdHigh = round6(report?.usd.usdHigh ?? 0);
      const usdEst = round6(report?.usd.usdEst ?? 0);
      // The minute brake against what the tokens cost: the estimate is the figure it is compared with.
      if (usdEst * env.chfPerUsd > brakeChf) logVoiceEvent({ warn: "call_cost_above_brake", tenant: tenant.id, model, usdHigh, usdEst, brakeChf });
      // (h) The id is no longer needed by the end route once a hang-up succeeded. When none did,
      // it stays recorded (its own lifetime ends it): a later end report can still hang up.
      if (hungUp) {
        try {
          await clearCallId(store, sid);
        } catch (error) {
          stepFailed("clear", error);
        }
      }
      // (i) The session ends (summary included), unless the end report did it already.
      let finished = false;
      try {
        finished = await finishSession({ claims, reason: report?.reason ?? "error", env, deps, now: clock() });
      } catch (error) {
        stepFailed("finish", error);
      }
      // (j) One line with numbers and codes only.
      const usage = report?.usage;
      logVoiceEvent({
        op: "call_end",
        tenant: tenant.id,
        provider: provider.id,
        model,
        reason: report?.reason ?? "error",
        seconds: round6(seconds),
        confirmed: report !== null && report.confirmedAt !== null,
        responses: report?.responses ?? 0,
        foreign: report?.foreign ?? 0,
        turns: report?.turns ?? 0,
        tools: report?.tools ?? 0,
        sidebandMs: report?.sidebandMs ?? -1,
        readyMs: report?.readyMs ?? -1,
        greetMs: report?.greetMs ?? -1,
        greetings: report?.greetings ?? 0,
        inTok: usage?.inTok ?? 0,
        inCachedTok: usage?.inCachedTok ?? 0,
        inAuTok: usage?.inAuTok ?? 0,
        inCachedAuTok: usage?.inCachedAuTok ?? 0,
        outTok: usage?.outTok ?? 0,
        outAuTok: usage?.outAuTok ?? 0,
        reasonTok: usage?.reasonTok ?? 0,
        transcribeSec: round6(usage?.transcribeSec ?? 0),
        transcribeInTok: usage?.transcribeInTok ?? 0,
        transcribeOutTok: usage?.transcribeOutTok ?? 0,
        usdHigh,
        usdEst,
        brakeChf,
        minTokLeft: report?.minTokLeft ?? -1,
        errors: report?.errors ?? 0,
        duplicates: report?.duplicates ?? 0,
        delivery: finished ? "done" : "closed_before",
      });
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void pump(controller);
      },
      cancel() {
        cancelled.abort();
      },
    });
    // The function must stay alive until the end sequence is done (the tool drain included),
    // whenever the browser stops reading.
    deps.keepAlive?.(done.promise);
    return new Response(stream, {
      headers: {
        "Content-Type": SSE_CONTENT_TYPE,
        // no-transform: compression by a proxy would buffer the stream.
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// POST /api/voice/ready
// ---------------------------------------------------------------------------------------------

/**
 * The browser's word that the peer connection of its call is connected and plays: the controller
 * (which may run on another instance) polls the counter and greets. Counted through the store;
 * more than MAX_READY_SIGNALS per session are refused. Its worst effect is an early greeting.
 */
export async function handleReadyRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  return guarded("ready", async () => {
    const env = getVoiceEnv();
    const now = (deps.now ?? Date.now)();
    if (!env.enabled || env.sessionSecret === null) return errorResponse(refuse(503, "unavailable"));
    const body = await readJsonBody(request, READY_BODY_BYTES);
    if (!body.ok) return errorResponse(refuse(body.status, body.code));
    const raw = body.value;
    if (!isRecord(raw)) return errorResponse(refuse(400, "bad_request"));
    const verified = verifySessionToken(raw.sessionToken, env.sessionSecret, now);
    if (!verified.ok) return errorResponse(tokenRefusal(verified.reason));
    const claims = verified.claims;
    if (claims.mode !== "realtime") return errorResponse(refuse(403, "forbidden", claims.tid));
    const tenant = getVoiceTenant(claims.tid);
    if (!tenant) return errorResponse(refuse(403, "forbidden", claims.tid));
    if (!originAllowed(request, tenant)) return errorResponse(refuse(403, "forbidden", tenant.id));
    const { accounting: store } = voiceStores(deps);
    if (await isSessionClosed(store, claims.sid)) return errorResponse(refuse(401, "expired", tenant.id));
    const limits = resolveVoiceLimits(tenant, env);
    const count = await store.incrBy(rtcReadyKey(claims.sid), 1, stateTtlSeconds(limits));
    if (count > MAX_READY_SIGNALS) return errorResponse(refuse(429, "rate_limited", tenant.id, READY_RETRY_AFTER_SECONDS));
    return json({ ok: true });
  });
}

// ---------------------------------------------------------------------------------------------
// Creating the call
// ---------------------------------------------------------------------------------------------

/**
 * Asks the provider for the call, with every safeguard around it (as openProviderSession does for
 * the token kind): breaker open → "unavailable" without a call; the adapter gets only the create
 * timeout as its signal, so a caller who leaves does not cut a create that may already have made
 * the call; the route waits until the answer, the timeout or the caller's leaving, whichever
 * comes first, and hands a later answer to `onLate` (it may carry a call id to hang up). An
 * adapter that throws or answers with a malformed result (no call id, no answer SDP) counts as
 * "upstream". The breaker counts only what looks like an outage: a timeout, a failure without an
 * HTTP status (the network, a broken adapter) and an HTTP 5xx, never when the CALLER left. A 4xx
 * is a refusal of this request, not an outage: a refused offer is "bad_request", and any other 4xx
 * names its status and the provider's error code in the call_open line, so a session setting of
 * ours that the provider refuses stays visible. One call_open line. Never throws.
 */
async function openCall(args: {
  provider: RealtimeCallProvider;
  store: KVStore;
  model: string;
  now: number;
  signal: AbortSignal;
  timeoutMs: number;
  onLate: (late: Promise<CreateCallResult>) => void;
  args: Omit<CreateCallArgs, "signal">;
}): Promise<CreateCallResult> {
  const { provider, store, model, now } = args;
  const tenantId = args.args.tenantId;
  const startedAt = Date.now();
  const line = (result: CheckedCreate, extra: Record<string, unknown> = {}): void =>
    logVoiceEvent({
      op: "call_open",
      tenant: tenantId,
      provider: provider.id,
      model,
      outcome: result.ok ? "ok" : result.code,
      ms: Date.now() - startedAt,
      httpStatus: result.ok ? undefined : result.httpStatus,
      // The provider's own error code of a refused request (the log's code field).
      ...(!result.ok && result.providerCode !== undefined ? { code: result.providerCode } : {}),
      ...extra,
    });
  if (await isOpen(store, tenantId, provider.id, now)) {
    const refused: CreateCallResult = { ok: false, code: "unavailable" };
    line(refused, { stop: "breaker_open" });
    return refused;
  }

  const timeout = AbortSignal.timeout(args.timeoutMs);
  const creating = Promise.resolve()
    .then(() => provider.createCall({ ...args.args, signal: timeout }))
    .then(checkCreateResult, (): CheckedCreate => ({ ok: false, code: "upstream" }));
  const answered = await raceAbort(creating, AbortSignal.any([args.signal, timeout]));
  if (answered === null) args.onLate(creating);
  const result: CheckedCreate = answered ?? { ok: false, code: "timeout" };

  const callerGone = args.signal.aborted && !timeout.aborted;
  let breakerOpened = false;
  if (result.ok) {
    await recordSuccess(store, tenantId, provider.id, now);
  } else if (!callerGone && looksLikeOutage(result)) {
    breakerOpened = await recordFailure(store, tenantId, provider.id, now);
  }
  line(result, callerGone ? { callerGone: true } : {});
  if (breakerOpened) logVoiceEvent({ warn: "breaker_opened", tenant: tenantId, provider: provider.id });
  if (result.ok) return result;
  // The provider's code was for the log line only.
  const { providerCode: _logged, ...failed } = result;
  void _logged;
  return failed;
}

/** A create result as checked here: a refusal may name the provider's error code, for the log. */
type CheckedCreate = CreateCallResult;

/** A failure the breaker counts: a timeout, an upstream failure without an HTTP status, an HTTP 5xx. */
function looksLikeOutage(result: Extract<CreateCallResult, { ok: false }>): boolean {
  if (result.code === "timeout") return true;
  if (result.code !== "upstream") return false;
  return result.httpStatus === undefined || result.httpStatus >= 500;
}

/** What a provider's error code may look like to be logged (the log's value pattern). */
const PROVIDER_CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** The adapter's answer, or "upstream" when it does not have the promised shape. */
function checkCreateResult(value: unknown): CheckedCreate {
  if (!isRecord(value)) return { ok: false, code: "upstream" };
  const callId = typeof value.callId === "string" && CALL_ID_RE.test(value.callId) ? value.callId : undefined;
  const httpStatus = typeof value.httpStatus === "number" && Number.isInteger(value.httpStatus) ? value.httpStatus : undefined;
  if (value.ok === true) {
    // A created call without a usable answer is hung up by the caller (it has its id).
    if (callId === undefined) return { ok: false, code: "upstream" };
    if (typeof value.answerSdp !== "string" || !isAnswerSdp(value.answerSdp)) return { ok: false, code: "upstream", callId };
    return { ok: true, callId, answerSdp: value.answerSdp };
  }
  const code = value.code;
  const known = code === "unavailable" || code === "upstream" || code === "timeout" || code === "busy" || code === "bad_request";
  const retryAfter =
    typeof value.retryAfter === "number" && Number.isFinite(value.retryAfter)
      ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.round(value.retryAfter)))
      : undefined;
  const providerCode =
    httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && typeof value.providerCode === "string" && PROVIDER_CODE_RE.test(value.providerCode)
      ? value.providerCode
      : undefined;
  return {
    ok: false,
    code: known ? code : "upstream",
    ...(callId !== undefined ? { callId } : {}),
    ...(code === "busy" ? { retryAfter: retryAfter ?? 30 } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
  };
}

/** `work`, or null as soon as `signal` aborts, whichever comes first. */
async function raceAbort(work: Promise<CheckedCreate>, signal: AbortSignal): Promise<CheckedCreate | null> {
  if (signal.aborted) return null;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------------------------
// SIGTERM: a best-effort hang-up of the calls of a dying instance
// ---------------------------------------------------------------------------------------------

// Vercel sends SIGTERM before it scales an instance down (not at the maxDuration cut) and allows
// about 500 ms after it: the hang-ups are fired, never awaited. Installed on Vercel only, never in
// tests or in development.
const liveCalls = new Set<() => void>();
let sigtermInstalled = false;

/** Registers a live call's hang-up for SIGTERM; returns the function that removes it (idempotent). */
function trackLiveCall(hangUp: () => void): () => void {
  if (process.env.VERCEL !== "1") return () => undefined;
  if (!sigtermInstalled) {
    sigtermInstalled = true;
    process.once("SIGTERM", () => {
      for (const entry of liveCalls) {
        try {
          entry();
        } catch {
          // Best effort: the next one still gets its hang-up.
        }
      }
    });
  }
  liveCalls.add(hangUp);
  return () => {
    liveCalls.delete(hangUp);
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Waits for `work` (its rejection counts as done), at most `ms` on the call's clock. Never rejects. */
async function waitAtMost(clock: ControllerClock, work: Promise<unknown>, ms: number): Promise<void> {
  let handle: unknown = null;
  const timeout = new Promise<void>((resolve) => {
    try {
      handle = clock.setTimeout(resolve, ms);
    } catch {
      resolve();
    }
  });
  try {
    await Promise.race([work.then(noop, noop), timeout]);
  } finally {
    if (handle !== null) {
      try {
        clock.clearTimeout(handle);
      } catch {
        // Already fired.
      }
    }
  }
}

function noop(): void {
  // Nothing to do.
}

/** Six decimals, as the call_end line carries them. */
function round6(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
