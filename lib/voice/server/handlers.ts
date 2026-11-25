// The HTTP side of the voice endpoints: request bodies, JSON errors and the turn stream.
// Server-only. The route files under app/api/voice/ are thin wrappers around these handlers (they
// add the runtime, maxDuration and Next's after()), so the handlers can be called directly with
// Request objects in tests, where Next's modules are not available.
//
// Every answer carries Cache-Control: no-store. Failures are JSON VoiceApiError bodies; once the
// turn stream has started they are "error" events instead. Nothing a caller said is ever logged.
import { getStore, type KVStore } from "@/lib/assistant/server/store";
import { getCalendar } from "@/lib/voice/calendar";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { executeTool, exportToolMemory, importToolMemory, type ToolContext } from "@/lib/voice/tools/execute";
import {
  isVoiceLocale,
  isVoiceToolName,
  type TurnStreamEvent,
  type VoiceApiError,
  type VoiceErrorCode,
  type VoiceLocale,
  type VoiceTenantConfig,
} from "@/lib/voice/types";
import { createAnthropicModel, runTurn, type BrainModel } from "./brain";
import { createMockBrain } from "./brain-mock";
import { getVoiceEnv, resolveVoiceLimits, type VoiceEnv } from "./env";
import { admitTurn } from "./limits";
import { logVoiceEvent } from "./log";
import {
  closeSession,
  createSessionSinks,
  finishSession,
  isSessionClosed,
  loadOrRecoverState,
  openSession,
  originAllowed,
  refuse,
  type Refusal,
  type VoiceDeps,
} from "./session";
import { saveState, stateTtlSeconds, type VoiceSessionState } from "./state";
import { verifySessionToken } from "./token";
import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS, seenBefore, verifyWebhook } from "./webhook";

export type { VoiceDeps } from "./session";

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
 * tenant FROM THE TOKEN → origin → body → session not closed → seconds left → turn cap.
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

    const store = deps.store ?? getStore();
    if (await isSessionClosed(store, claims.sid)) return errorResponse(refuse(401, "expired", tenant.id));
    const state = await loadOrRecoverState(store, claims);
    if (now >= state.startedAt + limits.maxCallSeconds * 1000) return errorResponse(refuse(429, "session_limit", tenant.id));

    let remainingTurns: number;
    if (opening) {
      // The greeting once; a repeat (a retried request) is answered again without a new turn.
      if (state.turns > 0) return errorResponse(refuse(400, "bad_request", tenant.id));
      remainingTurns = Math.max(0, limits.maxTurnsPerSession - state.turns);
    } else {
      const turn = await admitTurn({ store, sessionId: claims.sid, limits, now });
      if (!turn.ok) return errorResponse(refuse(429, "session_limit", tenant.id));
      remainingTurns = turn.remainingTurns;
    }

    const model = opening ? null : (deps.model ?? defaultModel(env))(tenant, locale);
    const calendar = (deps.calendar ?? getCalendar)(tenant);
    const sinks = deps.sinks ? deps.sinks(tenant) : createSessionSinks(tenant, deps.resend);
    const ttl = stateTtlSeconds(limits);

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
        // (signal), but its outcomes must still be stored.
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
          signal,
          now: clock,
        })) {
          if (event.type === "done" || event.type === "error") {
            saved = await persist(store, state, ttl);
            if (event.type === "done" && event.ended) ended = true;
          }
          send(event);
        }
        if (!saved) await persist(store, state, ttl);
        // The assistant ended the call: close it here, so the summary goes out even if the
        // widget's end report never arrives.
        if (ended) await finishSession({ claims, reason: "assistant", env, deps, now: clock() });
      } catch (error) {
        logVoiceEvent({ op: "turn", tenant: tenant.id, rejected: "internal", errorName: errorName(error) });
        send({ type: "error", code: "upstream" });
      } finally {
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

function defaultModel(env: VoiceEnv): (tenant: VoiceTenantConfig, locale: VoiceLocale) => BrainModel | null {
  return (tenant, locale) => {
    if (env.brain === "mock") return createMockBrain({ tenant, locale });
    return env.anthropicApiKey === null ? null : createAnthropicModel(env.anthropicApiKey);
  };
}

async function persist(store: KVStore, state: VoiceSessionState, ttl: number): Promise<boolean> {
  const ok = await saveState(store, state.sessionId, state, ttl);
  if (!ok) logVoiceEvent({ warn: "voice_state_not_saved", tenant: state.tenantId });
  return ok;
}

// ---------------------------------------------------------------------------------------------
// POST /api/voice/tool
// ---------------------------------------------------------------------------------------------

/**
 * Tool calls of a realtime voice provider, during a conversation. OUR neutral request shape: a
 * provider adapter translates its own webhook into it (and its header names onto ours).
 *
 *   POST /api/voice/tool
 *   x-voice-timestamp: <unix seconds>
 *   x-voice-signature: <hex HMAC-SHA256 of "<timestamp>.<raw body>" with VOICE_PROVIDER_WEBHOOK_SECRET>
 *   x-voice-delivery:  <the provider's unique id of this delivery>
 *   { "sessionToken": "<the token our session route issued>",
 *     "call": { "id": "<provider's tool call id>", "name": "<tool name>", "input": { ... } } }
 *
 *   200 { "ok": true, "callId": "<id>", "result": ToolOutcome }
 *
 * Without VOICE_PROVIDER_WEBHOOK_SECRET the route does not exist (404). The signature is checked
 * on the raw body before anything is parsed; a delivery id is accepted once (a replay gets 409).
 * The session token inside the body decides the tenant, and only realtime sessions may call.
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
    const store = deps.store ?? getStore();
    const delivery = request.headers.get(TOOL_DELIVERY_HEADER)?.trim() ?? "";
    // Only after the signature: otherwise a forger could burn real ids in advance.
    if (await seenBefore(store, `tool:${delivery}`, 2 * DEFAULT_WEBHOOK_TOLERANCE_SECONDS)) {
      return errorResponse(refuse(409, "bad_request"));
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch {
      return errorResponse(refuse(400, "bad_request"));
    }
    if (!isRecord(raw) || !isRecord(raw.call)) return errorResponse(refuse(400, "bad_request"));
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

    const limits = resolveVoiceLimits(tenant, env);
    const state = await loadOrRecoverState(store, claims);
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
      calendar: (deps.calendar ?? getCalendar)(tenant),
      sinks: deps.sinks ? deps.sinks(tenant) : createSessionSinks(tenant, deps.resend),
      record: (outcome) => {
        state.outcomes.push(outcome);
      },
    };
    const result = await executeTool(ctx, { id: call.id, name: call.name, input: call.input });
    state.toolMemory = exportToolMemory(counters);
    await persist(store, state, stateTtlSeconds(limits));
    logVoiceEvent({
      op: "tool",
      tenant: tenant.id,
      toolName: isVoiceToolName(call.name) ? call.name : "unknown",
      ok: result.ok,
      code: result.ok ? undefined : result.code,
    });
    return json({ ok: true, callId: call.id, result });
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

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
