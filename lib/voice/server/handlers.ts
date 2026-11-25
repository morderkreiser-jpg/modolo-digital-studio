// The HTTP side of the voice endpoints: request bodies, JSON errors and the turn stream.
// Server-only. The route files under app/api/voice/ are thin wrappers around these handlers (they
// add the runtime, maxDuration and Next's after()), so the handlers can be called directly with
// Request objects in tests, where Next's modules are not available.
//
// Every answer carries Cache-Control: no-store. Failures are JSON VoiceApiError bodies; once the
// turn stream has started they are "error" events instead. Nothing a caller said is ever logged.
import type { KVStore } from "@/lib/assistant/server/store";
import { getCalendar } from "@/lib/voice/calendar";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { executeTool, exportToolMemory, importToolMemory, type ToolContext } from "@/lib/voice/tools/execute";
import {
  isVoiceLocale,
  isVoiceToolName,
  type TurnStreamEvent,
  type VoiceApiError,
  type VoiceErrorCode,
  type VoiceLimits,
  type VoiceLocale,
  type VoiceTenantConfig,
} from "@/lib/voice/types";
import { createAnthropicModel, runTurn, toApiMessages, turnSystem, turnTools, turnWorstCaseUsd, type BrainModel } from "./brain";
import { createMockBrain } from "./brain-mock";
import { getVoiceEnv, resolveVoiceLimits, voiceCostChfPerMinute, type VoiceEnv } from "./env";
import {
  acquireSessionLock,
  admitTurn,
  admitTurnRequest,
  confirmRealtimeCall,
  createSessionCaps,
  extendSession,
  reservationFromClaims,
  reserveTurnSpend,
  settleReportedCall,
  settleTurnSpend,
  usdToMicroChf,
  type SessionReservation,
  type SpendChange,
  type TurnSpendReservation,
} from "./limits";
import { logVoiceEvent } from "./log";
import {
  closeSession,
  createSessionSinks,
  END_GRACE_SECONDS,
  finishSession,
  isSessionClosed,
  isSessionEnding,
  loadOrRecoverState,
  openSession,
  originAllowed,
  refuse,
  alertDelivery,
  type Refusal,
  type VoiceDeps,
} from "./session";
import { reportCeilingRefusal, reportSpend } from "./alerts";
import { clearState, loadState, saveState, stateTtlSeconds, type VoiceSessionState } from "./state";
import { voiceStores } from "./stores";
import { deliverLateOutcomes } from "./summary";
import { verifySessionToken, type SessionClaims } from "./token";
import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS, seenBefore, verifyWebhook, wasSeen } from "./webhook";

export type { VoiceDeps } from "./session";

/**
 * How long a turn waits for the previous turn of its session to finish. A caller who barges in
 * sends the next turn while the aborted one still saves its state; a script firing turns in
 * parallel waits as long and is then refused ("turn_in_progress").
 */
export const TURN_LOCK_WAIT_MS = 5_000;
/**
 * The same for a tool call of a realtime provider, which may send calls side by side. Short, so
 * the wait plus the slowest action (an email: EMAIL_TIMEOUT_MS) fits in the tool route's
 * maxDuration: a function killed while it holds the lock would block the session's next calls
 * until the lock's slots run out (review finding S2-7).
 */
export const TOOL_LOCK_WAIT_MS = 3_000;
/** Longest call a provider's "ended" event may report, in seconds: anything longer is not a call. */
const MAX_REPORTED_SECONDS = 24 * 3600;

const SESSION_BODY_BYTES = 4 * 1024;
// A turn carries at most maxTurnChars (4000 at the very most) characters, up to 4 bytes each.
const TURN_BODY_BYTES = 24 * 1024;
const END_BODY_BYTES = 4 * 1024;
const TOOL_BODY_BYTES = 32 * 1024;
// A comment frame keeps the stream alive while the model thinks; decoders skip it.
const HEARTBEAT_MS = 15_000;
const HEARTBEAT_FRAME = ": ping\n\n";
const SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/** Headers of the tool webhook (our neutral names; a provider adapter maps its own onto them). */
export const TOOL_TIMESTAMP_HEADER = "x-voice-timestamp";
export const TOOL_SIGNATURE_HEADER = "x-voice-signature";
export const TOOL_DELIVERY_HEADER = "x-voice-delivery";

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// POST /api/voice/session
// ---------------------------------------------------------------------------------------------

export async function handleSessionRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  return guarded("session", async () => {
    // The switch first: a dark feature does not even read the body.
    if (!getVoiceEnv().enabled) return errorResponse(refuse(503, "unavailable"));
    const body = await readJson(request, SESSION_BODY_BYTES);
    if (!body.ok) return errorResponse(refuse(body.status, body.code));
    const outcome = await openSession(request, body.value, deps);
    return outcome.ok ? json(outcome.grant) : errorResponse(outcome);
  });
}

// ---------------------------------------------------------------------------------------------
// POST /api/voice/end
// ---------------------------------------------------------------------------------------------

/**
 * Accepts JSON whatever the Content-Type says: navigator.sendBeacon sends a Blob (application/json
 * or text/plain) and no headers worth relying on. The signed token is the only authority.
 */
export async function handleEndRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  return guarded("end", async () => {
    const body = await readJson(request, END_BODY_BYTES);
    if (!body.ok) return errorResponse(refuse(body.status, body.code));
    const outcome = await closeSession(body.value, deps);
    return outcome.ok ? json({ ok: true }) : errorResponse(outcome);
  });
}

// ---------------------------------------------------------------------------------------------
// POST /api/voice/turn
// ---------------------------------------------------------------------------------------------

/**
 * One caller turn of a "local" session, answered as Server-Sent Events ("data: <json>" frames,
 * ": ping" keep-alives). Checks before the stream: switch → token (signature, expiry, mode) →
 * tenant FROM THE TOKEN → origin → body → session not closed → requests of this session in the
 * last few seconds (429 "rate_limited" above TURN_REQUESTS_PER_WINDOW) → the session's lock (one
 * turn at a time; 409 "turn_in_progress" when another turn keeps it) → seconds left → turn cap →
 * the lease is extended → the turn's worst model cost is reserved (503 "budget_exhausted" when
 * the tenant's or everybody's month cannot pay for it). The lock is released once the state is
 * saved, before the widget reads "done".
 */
export async function handleTurnRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  return guarded("turn", async () => {
    const env = getVoiceEnv();
    const clock = deps.now ?? Date.now;
    const now = clock();
    if (!env.enabled || env.sessionSecret === null) return errorResponse(refuse(503, "unavailable"));
    const body = await readJson(request, TURN_BODY_BYTES);
    if (!body.ok) return errorResponse(refuse(body.status, body.code));
    const raw = body.value;
    if (!isRecord(raw)) return errorResponse(refuse(400, "bad_request"));

    const verified = verifySessionToken(raw.sessionToken, env.sessionSecret, now);
    if (!verified.ok) return errorResponse(tokenRefusal(verified.reason));
    const claims = verified.claims;
    // Turns exist only in the text-turn mode, and only while the server still runs it.
    if (claims.mode !== "local") return errorResponse(refuse(403, "forbidden", claims.tid));
    if (env.mode !== "local") return errorResponse(refuse(503, "unavailable", claims.tid));
    // The tenant of the token; a "tenant" in the body is never read.
    const tenant = getVoiceTenant(claims.tid);
    if (!tenant) return errorResponse(refuse(403, "forbidden", claims.tid));
    if (!originAllowed(request, tenant)) return errorResponse(refuse(403, "forbidden", tenant.id));

    const limits = resolveVoiceLimits(tenant, env);
    const opening = raw.opening === true;
    if (typeof raw.text !== "string") return errorResponse(refuse(400, "bad_request", tenant.id));
    const text = raw.text.trim();
    if (opening ? text !== "" : text === "") return errorResponse(refuse(400, "bad_request", tenant.id));
    if (text.length > limits.maxTurnChars) return errorResponse(refuse(413, "too_large", tenant.id));
    const askedLocale = raw.locale;
    const locale: VoiceLocale = isVoiceLocale(askedLocale) && tenant.locales.includes(askedLocale) ? askedLocale : claims.loc;

    const { accounting: store } = voiceStores(deps);
    if (await isSessionClosed(store, claims.sid)) return errorResponse(refuse(401, "expired", tenant.id));
    // One increment, before a request may wait for the lock: requests fired in parallel would
    // each poll the store for seconds (review finding S2-4).
    const gate = await admitTurnRequest(store, claims.sid, now);
    if (!gate.ok) return errorResponse(refuse(429, gate.code, tenant.id, gate.retryAfter));
    const lock = await acquireSessionLock(store, claims.sid, { clock, waitMs: deps.lockWaitMs ?? TURN_LOCK_WAIT_MS });
    if (lock === null) return errorResponse(refuse(409, "turn_in_progress", tenant.id));
    const prepared = await prepareTurn({ claims, tenant, limits, env, deps, store, now, opening, text, locale }).catch(
      async (error: unknown) => {
        await lock.release();
        throw error;
      },
    );
    if (!prepared.ok) {
      await lock.release();
      return errorResponse(prepared.refusal);
    }
    const { state, remainingTurns, spend } = prepared;
    // What the turn finds already done: anything after it is this turn's (persistUnlessEnded).
    const late = lateOutcomes({ state, tenant, since: state.outcomes.length, deps });

    const model = opening ? null : (deps.model ?? defaultModel(env))(tenant, locale);
    const calendar = (deps.calendar ?? getCalendar)(tenant);
    const sinks = deps.sinks
      ? deps.sinks(tenant)
      : createSessionSinks(tenant, deps.resend, { send: deps.sendEmail, session: { channel: state.channel, startedAt: state.startedAt } });
    const ttl = stateTtlSeconds(limits);
    const caps = createSessionCaps(store, claims.sid, ttl);

    // The stream: start, the turn's events, then done or error. The state is saved before the
    // widget learns that the turn is over, so its next request already builds on it.
    const cancelled = new AbortController();
    const signal = AbortSignal.any([request.signal, cancelled.signal]);
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });

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
      const send = (event: TurnStreamEvent): void => write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => write(HEARTBEAT_FRAME), HEARTBEAT_MS);
      let ended = false;
      let saved = false;
      try {
        send({ type: "start" });
        // Drained to the end even when the visitor has left: the turn stops its model call
        // (signal), but its outcomes must still be stored and its spend settled.
        for await (const event of runTurn({
          tenant,
          state,
          text,
          locale,
          opening,
          limits,
          model,
          modelId: env.model,
          maxOutputTokens: env.maxOutputTokens,
          calendar,
          sinks,
          remainingTurns,
          caps,
          ...(spend ? { settleSpend: (costUsd: number) => settleTurnSpend(store, spend, usdToMicroChf(costUsd, env.chfPerUsd)) } : {}),
          signal,
          now: clock,
        })) {
          if (event.type === "done" || event.type === "error") {
            saved = await persistUnlessEnded(store, state, ttl, late);
            // Saved: the next turn may start as soon as the widget reads this event.
            await lock.release();
            if (event.type === "done" && event.ended) ended = true;
          }
          send(event);
        }
        if (!saved) await persistUnlessEnded(store, state, ttl, late);
        await lock.release();
        // The assistant ended the call: close it here, so the summary goes out even if the
        // widget's end report never arrives.
        if (ended) await finishSession({ claims, reason: "assistant", env, deps, now: clock() });
      } catch (error) {
        logVoiceEvent({ op: "turn", tenant: tenant.id, rejected: "internal", errorName: errorName(error) });
        send({ type: "error", code: "upstream" });
      } finally {
        await lock.release();
        clearInterval(heartbeat);
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed or cancelled by the runtime.
          }
        }
        settle();
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void pump(controller);
      },
      cancel() {
        cancelled.abort();
      },
    });
    // The widget hangs up as soon as it reads "done": the platform must keep the function alive
    // until the state is saved and an ended call is closed.
    deps.keepAlive?.(settled);
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

type PreparedTurn =
  | { ok: true; state: VoiceSessionState; remainingTurns: number; spend: TurnSpendReservation | null }
  | { ok: false; refusal: Refusal };

/**
 * The checks and reservations of a turn that need the session's lock: the state, the time left,
 * the turn cap, the lease of minutes and the model's worst case. Nothing here is undone when a
 * later check refuses: a refused turn still counts, so hammering a spent session frees nothing.
 */
async function prepareTurn(args: {
  claims: SessionClaims;
  tenant: VoiceTenantConfig;
  limits: VoiceLimits;
  env: VoiceEnv;
  deps: VoiceDeps;
  store: KVStore;
  now: number;
  opening: boolean;
  text: string;
  locale: VoiceLocale;
}): Promise<PreparedTurn> {
  const { claims, tenant, limits, env, store, now } = args;
  // Again under the lock: an end report may have closed the session while this turn waited.
  if (await isSessionClosed(store, claims.sid)) return { ok: false, refusal: refuse(401, "expired", tenant.id) };
  const state = await loadOrRecoverState(store, claims);
  const callEndsAt = state.startedAt + limits.maxCallSeconds * 1000;
  if (now >= callEndsAt) return { ok: false, refusal: refuse(429, "session_limit", tenant.id) };

  let remainingTurns: number;
  if (args.opening) {
    // The greeting once; a repeat (a retried request) is answered again without a new turn.
    if (state.turns > 0) return { ok: false, refusal: refuse(400, "bad_request", tenant.id) };
    remainingTurns = Math.max(0, limits.maxTurnsPerSession - state.turns);
    // A repeat costs nothing and must not keep the session alive either: free requests that
    // extended the lease filled the day's minutes for no model call (review finding S2-2).
    if (state.greeted) return { ok: true, state, remainingTurns, spend: null };
  } else {
    const turn = await admitTurn({ store, sessionId: claims.sid, limits, now });
    if (!turn.ok) return { ok: false, refusal: refuse(429, "session_limit", tenant.id) };
    remainingTurns = turn.remainingTurns;
  }

  // A sign of life (the first greeting, or a turn within the turn cap): the session's lease and
  // its running slot follow it (limits.ts).
  const reservation = state.reservation ?? reservationFromClaims(claims, voiceCostChfPerMinute(env, claims.mode));
  if (reservation) {
    const extended = await extendSession({ store, reservation, limits, global: env.global, now });
    if (!extended.ok) return { ok: false, refusal: refuse(503, "budget_exhausted", tenant.id, extended.retryAfter) };
  }
  if (args.opening) return { ok: true, state, remainingTurns, spend: null };

  // The model's worst case, reserved before it is called: the spend ceiling holds whatever a
  // script sends, and a model switched to a dearer one is priced as such.
  const worstUsd = turnWorstCaseUsd({
    modelId: env.model,
    maxOutputTokens: env.maxOutputTokens,
    system: turnSystem({
      tenant,
      state,
      locale: args.locale,
      now: new Date(now),
      remainingSeconds: Math.max(0, Math.floor((callEndsAt - now) / 1000)),
    }),
    tools: turnTools(tenant),
    messages: [...toApiMessages(state.history), { role: "user", content: args.text }],
  });
  const worstMicro = usdToMicroChf(worstUsd, env.chfPerUsd);
  const reserved = await reserveTurnSpend({
    store,
    tenantId: tenant.id,
    sessionId: claims.sid,
    limits,
    global: env.global,
    micro: worstMicro,
    now,
  });
  if (!reserved.ok) {
    // The turn that would pass a ceiling is refused before it counts: the 100% line may never be
    // crossed, so the refusal reports it (alerts.ts).
    await reportCeilingRefusal({
      store,
      tenantId: tenant.id,
      roomChf: worstMicro / 1e6,
      budgetChf: limits.budgetChfPerMonth,
      globalBudgetChf: env.global.budgetChfPerMonth,
      now,
      delivery: alertDelivery(env, args.deps),
    });
    return { ok: false, refusal: refuse(503, "budget_exhausted", tenant.id, reserved.retryAfter) };
  }
  await reportSpend({
    store,
    tenantId: tenant.id,
    month: reserved.reservation.month,
    spend: reserved.spend,
    budgetChf: limits.budgetChfPerMonth,
    globalSpend: reserved.globalSpend,
    globalBudgetChf: env.global.budgetChfPerMonth,
    delivery: alertDelivery(env, args.deps),
  });
  return { ok: true, state, remainingTurns, spend: reserved.reservation };
}

function defaultModel(env: VoiceEnv): (tenant: VoiceTenantConfig, locale: VoiceLocale) => BrainModel | null {
  return (tenant, locale) => {
    if (env.brain === "mock") return createMockBrain({ tenant, locale });
    return env.anthropicApiKey === null ? null : createAnthropicModel(env.anthropicApiKey);
  };
}

/**
 * Saves the state, unless the end of the session no longer waits for this request: an end report
 * that stopped waiting for a slow turn makes the summary from the stored state and removes it,
 * and saving it again would keep what the caller said for another stateTtlSeconds (review
 * finding S2-6). Checked after the save as well, since the end may begin between the check and
 * the save; it marks the session as ending before it reads the state, so whichever way they
 * interleave, one of the two checks sees it or the end reads (and removes) what was saved. A
 * session that is closed but still waits for this turn is saved as usual: its summary needs it.
 *
 * Found ending at the first check, this request saved nothing, so the summary was made without
 * what it did: `late` sends that as an addendum (deliverLateOutcomes). The stored state is left to
 * the end, which removes it once it has read it: removing it here could come first and leave the
 * summary with nothing at all. Found ending only after the save, the end may or may not have read
 * what was saved, so no addendum is sent (a race of one store round trip).
 */
async function persistUnlessEnded(
  store: KVStore,
  state: VoiceSessionState,
  ttl: number,
  late?: () => Promise<void>,
): Promise<boolean> {
  if (await isSessionEnding(store, state.sessionId)) {
    await late?.();
    return true;
  }
  const ok = await saveState(store, state.sessionId, state, ttl);
  if (!ok) logVoiceEvent({ warn: "voice_state_not_saved", tenant: state.tenantId });
  if (await isSessionEnding(store, state.sessionId)) await clearState(store, state.sessionId);
  return ok;
}

/**
 * The `late` step of persistUnlessEnded: what a request did beyond the first `since` outcomes of
 * the state it loaded, as an addendum to the summary. Never throws.
 */
function lateOutcomes(args: {
  state: VoiceSessionState;
  tenant: VoiceTenantConfig;
  since: number;
  deps: VoiceDeps;
}): () => Promise<void> {
  return async () => {
    try {
      const delivery = await deliverLateOutcomes({
        state: args.state,
        tenant: args.tenant,
        since: args.since,
        resend: args.deps.resend,
        send: args.deps.sendEmail,
        now: (args.deps.now ?? Date.now)(),
      });
      if (delivery === null) return;
      logVoiceEvent({ op: "late_outcomes", tenant: args.tenant.id, delivery: delivery.sent ? "sent" : delivery.reason });
    } catch (error) {
      logVoiceEvent({ warn: "voice_late_outcomes_failed", tenant: args.tenant.id, errorName: errorName(error) });
    }
  };
}

// ---------------------------------------------------------------------------------------------
// POST /api/voice/tool
// ---------------------------------------------------------------------------------------------

/**
 * Tool calls and session events of a realtime voice provider, during a conversation. OUR neutral
 * request shape: a provider adapter translates its own webhook into it (and its header names
 * onto ours).
 *
 *   POST /api/voice/tool
 *   x-voice-timestamp: <unix seconds>
 *   x-voice-signature: <hex HMAC-SHA256 of "<timestamp>.<raw body>" with VOICE_PROVIDER_WEBHOOK_SECRET>
 *   x-voice-delivery:  <the provider's unique id of this delivery>
 *   { "sessionToken": "<the token our session route issued>",
 *     "call": { "id": "<provider's tool call id>", "name": "<tool name>", "input": { ... } } }
 *   200 { "ok": true, "callId": "<id>", "result": ToolOutcome }
 *
 *   { "sessionToken": "...", "event": { "type": "started" } }                 the call connected
 *   { "sessionToken": "...", "event": { "type": "ended", "seconds": 73.4 } }  billed length
 *   200 { "ok": true }
 *
 * Without VOICE_PROVIDER_WEBHOOK_SECRET the route does not exist (404). The signature is checked
 * on the raw body before anything is parsed; a delivery id is accepted once (a replay gets 409).
 * The session token inside the body decides the tenant, and only realtime sessions may call.
 *
 * A tool call: calls of one session run one at a time (409 "turn_in_progress" after
 * TOOL_LOCK_WAIT_MS), and the per-session caps are counted atomically in the store. A signed call
 * proves the call is connected, so it charges the whole call if nothing did yet
 * (confirmRealtimeCall). Its delivery id is marked as seen once the action is done, not before:
 * a function killed in between leaves the provider's retry free to run it (the actions are
 * idempotent: the calendar's key, the email's Idempotency-Key), instead of refusing a call
 * whose result nobody received (review finding S2-7).
 *
 * The events (sent only by an adapter with RealtimeProvider.confirmsCalls): "started" charges
 * the whole call, "ended" settles it to the seconds the provider bills and closes the session
 * like an end report (summary included), even when the browser never sent one. Both are accepted
 * for END_GRACE_SECONDS after the token expired, and even after the browser's end report: the
 * provider's word on what it bills counts more than the browser's.
 */
export async function handleToolRequest(request: Request, deps: VoiceDeps = {}): Promise<Response> {
  return guarded("tool", async () => {
    const env = getVoiceEnv();
    const clock = deps.now ?? Date.now;
    const now = clock();
    if (env.providerWebhookSecret === null) return errorResponse({ ok: false, status: 404, error: "unavailable" });
    if (!env.enabled || env.sessionSecret === null) return errorResponse(refuse(503, "unavailable"));

    const body = await readText(request, TOOL_BODY_BYTES);
    if (!body.ok) return errorResponse(refuse(body.status, body.code));
    const verified = verifyWebhook({
      secret: env.providerWebhookSecret,
      timestampHeader: request.headers.get(TOOL_TIMESTAMP_HEADER),
      signatureHeader: request.headers.get(TOOL_SIGNATURE_HEADER),
      rawBody: body.text,
      now,
    });
    if (!verified.ok) return errorResponse(refuse(401, "forbidden"));
    const { shared, accounting: store } = voiceStores(deps);
    const delivery = request.headers.get(TOOL_DELIVERY_HEADER)?.trim() ?? "";

    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch {
      return errorResponse(refuse(400, "bad_request"));
    }
    if (!isRecord(raw)) return errorResponse(refuse(400, "bad_request"));
    if (isRecord(raw.event)) {
      const event = parseProviderEvent(raw.event);
      if (event === null) return errorResponse(refuse(400, "bad_request"));
      const eventToken = verifySessionToken(raw.sessionToken, env.sessionSecret, now, { acceptExpiredForSeconds: END_GRACE_SECONDS });
      if (!eventToken.ok) return errorResponse(tokenRefusal(eventToken.reason));
      const claims = eventToken.claims;
      if (claims.mode !== "realtime") return errorResponse(refuse(403, "forbidden", claims.tid));
      const tenant = getVoiceTenant(claims.tid);
      if (!tenant) return errorResponse(refuse(403, "forbidden", claims.tid));
      // Only after the signature: otherwise a forger could burn real ids in advance. Both events
      // are idempotent on their own (limits.ts markers), so the id may be marked first.
      if (await seenBefore(shared, `event:${delivery}`, 2 * DEFAULT_WEBHOOK_TOLERANCE_SECONDS)) {
        return errorResponse(refuse(409, "bad_request"));
      }
      const limits = resolveVoiceLimits(tenant, env);
      const reservation = await realtimeReservation(store, claims, env);
      if (event.type === "started") {
        const spend = reservation ? await confirmRealtimeCall({ store, reservation, limits, now }) : null;
        await reportCharge({ store, tenantId: tenant.id, spend, limits, env, deps });
      } else {
        const spend = reservation ? await settleReportedCall({ store, reservation, reportedSeconds: event.seconds, limits, now }) : null;
        await reportCharge({ store, tenantId: tenant.id, spend, limits, env, deps });
        await finishSession({ claims, reason: "provider", env, deps, now });
      }
      logVoiceEvent({ op: "provider_event", tenant: tenant.id, kind: event.type });
      return json({ ok: true });
    }

    if (!isRecord(raw.call)) return errorResponse(refuse(400, "bad_request"));
    const call = raw.call;
    if (typeof call.id !== "string" || call.id === "" || call.id.length > 200 || typeof call.name !== "string") {
      return errorResponse(refuse(400, "bad_request"));
    }
    const token = verifySessionToken(raw.sessionToken, env.sessionSecret, now);
    if (!token.ok) return errorResponse(tokenRefusal(token.reason));
    const claims = token.claims;
    if (claims.mode !== "realtime") return errorResponse(refuse(403, "forbidden", claims.tid));
    const tenant = getVoiceTenant(claims.tid);
    if (!tenant) return errorResponse(refuse(403, "forbidden", claims.tid));
    if (await isSessionClosed(store, claims.sid)) return errorResponse(refuse(401, "expired", tenant.id));

    // One call at a time per session: a provider may send calls side by side, and each loads,
    // changes and saves the session state. Taken before the delivery id is looked at, so a call
    // refused here can be delivered again.
    const lock = await acquireSessionLock(store, claims.sid, { clock, waitMs: deps.lockWaitMs ?? TOOL_LOCK_WAIT_MS });
    if (lock === null) return errorResponse(refuse(409, "turn_in_progress", tenant.id));
    try {
      if (await isSessionClosed(store, claims.sid)) return errorResponse(refuse(401, "expired", tenant.id));
      // Only after the signature: otherwise a forger could burn real ids in advance. A delivery
      // of the same id that ran before this one held the lock has marked it by now.
      const deliveryKey = `tool:${delivery}`;
      if (await wasSeen(shared, deliveryKey)) return errorResponse(refuse(409, "bad_request"));

      const limits = resolveVoiceLimits(tenant, env);
      const ttl = stateTtlSeconds(limits);
      const state = await loadOrRecoverState(store, claims);
      const late = lateOutcomes({ state, tenant, since: state.outcomes.length, deps });
      // A call the provider signed is a connected call.
      const reservation = state.reservation ?? reservationFromClaims(claims, voiceCostChfPerMinute(env, "realtime"));
      const spend = reservation ? await confirmRealtimeCall({ store, reservation, limits, now }) : null;
      await reportCharge({ store, tenantId: tenant.id, spend, limits, env, deps });
      const counters = state.counters;
      importToolMemory(counters, state.toolMemory);
      const ctx: ToolContext = {
        tenant,
        sessionId: claims.sid,
        locale: claims.loc,
        channel: claims.ch,
        now: new Date(now),
        limits,
        counters,
        caps: createSessionCaps(store, claims.sid, ttl),
        calendar: (deps.calendar ?? getCalendar)(tenant),
        sinks: deps.sinks
          ? deps.sinks(tenant)
          : createSessionSinks(tenant, deps.resend, { send: deps.sendEmail, session: { channel: claims.ch, startedAt: state.startedAt } }),
        record: (outcome) => {
          state.outcomes.push(outcome);
        },
      };
      const result = await executeTool(ctx, { id: call.id, name: call.name, input: call.input });
      state.toolMemory = exportToolMemory(counters);
      await persistUnlessEnded(store, state, ttl, late);
      // Done: from now on this delivery is a replay.
      await seenBefore(shared, deliveryKey, 2 * DEFAULT_WEBHOOK_TOLERANCE_SECONDS);
      logVoiceEvent({
        op: "tool",
        tenant: tenant.id,
        toolName: isVoiceToolName(call.name) ? call.name : "unknown",
        ok: result.ok,
        code: result.ok ? undefined : result.code,
      });
      return json({ ok: true, callId: call.id, result });
    } finally {
      await lock.release();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type ProviderEvent = { type: "started" } | { type: "ended"; seconds: number };

/** A session event of the neutral webhook shape, or null when it is not one. */
function parseProviderEvent(event: Record<string, unknown>): ProviderEvent | null {
  if (event.type === "started") return { type: "started" };
  if (event.type !== "ended") return null;
  const seconds = event.seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > MAX_REPORTED_SECONDS) return null;
  return { type: "ended", seconds };
}

/** The spend alerts of a realtime charge (alerts.ts), when it charged anything. */
async function reportCharge(args: {
  store: KVStore;
  tenantId: string;
  spend: SpendChange | null;
  limits: VoiceLimits;
  env: VoiceEnv;
  deps: VoiceDeps;
}): Promise<void> {
  const { spend, env } = args;
  if (spend === null) return;
  await reportSpend({
    store: args.store,
    tenantId: args.tenantId,
    month: spend.month,
    spend,
    budgetChf: args.limits.budgetChfPerMonth,
    globalSpend: spend.globalSpend,
    globalBudgetChf: env.global.budgetChfPerMonth,
    delivery: alertDelivery(env, args.deps),
  });
}

/**
 * A realtime session's reservation: the one in its state, or one rebuilt from its token when the
 * state is gone (the end report removed it, or it expired). The amounts come from the ledger.
 */
async function realtimeReservation(store: KVStore, claims: SessionClaims, env: VoiceEnv): Promise<SessionReservation | null> {
  const state = await loadState(store, claims.sid);
  if (state !== null && state.tenantId === claims.tid && state.reservation) return state.reservation;
  return reservationFromClaims(claims, voiceCostChfPerMinute(env, "realtime"));
}

/** A bug in our own code or data becomes a 500 "unavailable"; only the error's name is logged. */
async function guarded(op: string, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    logVoiceEvent({ op, rejected: "internal", errorName: errorName(error) });
    return errorResponse({ ok: false, status: 500, error: "unavailable" });
  }
}

function tokenRefusal(reason: "malformed" | "bad_signature" | "expired" | "not_yet_valid"): Refusal {
  return reason === "expired" ? refuse(401, "expired") : refuse(403, "forbidden");
}

type BodyText = { ok: true; text: string } | { ok: false; status: 400 | 413; code: VoiceErrorCode };
type BodyJson = { ok: true; value: unknown } | { ok: false; status: 400 | 413; code: VoiceErrorCode };

/** Reads at most `maxBytes`, whatever the client declared, and stops at the first byte over. */
async function readText(request: Request, maxBytes: number): Promise<BodyText> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return { ok: false, status: 413, code: "too_large" };
  if (request.body === null) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, code: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "bad_request" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

async function readJson(request: Request, maxBytes: number): Promise<BodyJson> {
  const body = await readText(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, status: 400, code: "bad_request" };
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(refusal: Refusal): Response {
  const body: VoiceApiError =
    refusal.retryAfter === undefined ? { ok: false, error: refusal.error } : { ok: false, error: refusal.error, retryAfter: refusal.retryAfter };
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (refusal.retryAfter !== undefined) headers.set("Retry-After", String(refusal.retryAfter));
  return Response.json(body, { status: refusal.status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
