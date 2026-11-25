// Opening and closing voice sessions. Server-only.
//
// openSession: cheapest checks first, so abuse is turned away before it costs anything:
//   switch + secret → tenant → origin → body → honeypot → mode (demo businesses: "scripted" only,
//   unless VOICE_LAB) → realtime provider configured → admission (IP across tenants,
//   concurrency, minutes and spend of the tenant and of all tenants: limits.ts) → provider
//   session (behind the breaker) → state → token.
// closeSession: token (a late end report gets a short grace) → once per session (marked closed
//   at once, so no new turn starts) → the running turn may finish → settle the reservation (from
//   the ledger, even when the state is gone) → summary of what was not sent yet (live tenants
//   only) → state removed.
//
// The tenant always comes from the SIGNED token once a session exists, never from a request body:
// a token of one business can never act for another. A request without an Origin header (not a
// browser page) passes the origin check, like the chat's, but every limit still applies to it.
//
// Stores (stores.ts): the per-IP windows go to the shared store; the counters, the ledger, the
// session state and every per-session marker go to the accounting store.
import { createHash, randomInt } from "node:crypto";
import { clientIp, hashId, isOriginAllowed, rateLimitSubject } from "@/lib/assistant/server/guard";
import type { KVStore } from "@/lib/assistant/server/store";
import type { TenantConfig } from "@/lib/assistant/types";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import type { ToolSinks } from "@/lib/voice/tools/execute";
import {
  isVoiceLocale,
  type CalendarProvider,
  type CallSummary,
  type SessionGrant,
  type VoiceChannel,
  type VoiceErrorCode,
  type VoiceLimits,
  type VoiceLocale,
  type VoiceMode,
  type VoiceTenantConfig,
} from "@/lib/voice/types";
import { turnSystem, turnTools, turnWorstCaseUsd, type BrainModel } from "./brain";
import { availableModes, getVoiceEnv, resolveVoiceLimits, voiceCostChfPerMinute, type VoiceEnv } from "./env";
import {
  acquireSessionLock,
  admitSession,
  cancelReservation,
  reservationFromClaims,
  sessionLifetimeSeconds,
  settleSession,
  spendThresholdsCrossed,
  usdToMicroChf,
} from "./limits";
import { logVoiceEvent } from "./log";
import { getRealtimeProvider, openProviderSession, type RealtimeProvider } from "./providers";
import { clearState, createSessionState, loadState, saveState, stateTtlSeconds, type VoiceSessionState } from "./state";
import { voiceStores } from "./stores";
import {
  canDeliverSummary,
  deliverRequest,
  deliverSummary,
  endOfCallSummary,
  summaryEmailConfig,
  type ResendConfig,
  type SendEmail,
  type SummaryDelivery,
} from "./summary";
import { MAX_SESSION_TOKEN_LIFETIME_SECONDS, signSessionToken, verifySessionToken, type SessionClaims } from "./token";
import { seenBefore } from "./webhook";

/** An end report may arrive this long after the token expired and still close the session. */
export const END_GRACE_SECONDS = 10 * 60;
/**
 * How long an end report waits for a turn of the session that is still saving its state, so the
 * summary includes what that turn did. Then it closes anyway: a stale lock must not keep a
 * session open.
 */
export const END_LOCK_WAIT_MS = 4_000;
/** Path of the tool webhook a realtime provider calls (app/api/voice/tool/route.ts). */
export const VOICE_TOOL_ENDPOINT = "/api/voice/tool";

const MAX_PAGE_CHARS = 200;
const MODES: readonly VoiceMode[] = ["scripted", "local", "realtime"];
const IP_HASH_RE = /^[0-9a-f]{16,64}$/;
// The "closed" marker outlives every token and every grace period.
const CLOSED_TTL_SECONDS = MAX_SESSION_TOKEN_LIFETIME_SECONDS + END_GRACE_SECONDS + 3600;
const LEAD_REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** What the routes can replace, for tests: every default is the production one. */
export interface VoiceDeps {
  /** The shared store (per-IP windows, webhook ids, breaker). Default: the chat's store. */
  store?: KVStore;
  /** The accounting store (stores.ts). Default: accountingStoreFor(store). */
  accountingStore?: KVStore;
  /** How long a request waits for the session's lock (ms). Default per route. */
  lockWaitMs?: number;
  /** Clock in unix ms. */
  now?: () => number;
  /** Keeps the function alive for work that ends after the response (Next's after()). */
  keepAlive?: (work: Promise<unknown>) => void;
  model?: (tenant: VoiceTenantConfig, locale: VoiceLocale) => BrainModel | null;
  calendar?: (tenant: VoiceTenantConfig) => CalendarProvider | null;
  sinks?: (tenant: VoiceTenantConfig) => ToolSinks;
  /** undefined = the configured one (VOICE_PROVIDER). */
  provider?: RealtimeProvider | null;
  /** undefined = the site's configuration (RESEND_API_KEY). */
  resend?: ResendConfig | null;
  sendEmail?: SendEmail;
}

export type Refusal = { ok: false; status: number; error: VoiceErrorCode; retryAfter?: number };

export type SessionOutcome = { ok: true; grant: SessionGrant } | Refusal;

// ---------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------

/** POST /api/voice/session, after the route has read the body (`body` is the parsed JSON). */
export async function openSession(request: Request, body: unknown, deps: VoiceDeps = {}): Promise<SessionOutcome> {
  const env = getVoiceEnv();
  const now = (deps.now ?? Date.now)();
  if (!env.enabled) return refuse(503, "unavailable");
  // Without a secret no token can be signed (production without VOICE_SESSION_SECRET).
  if (env.sessionSecret === null) return refuse(503, "unavailable");
  if (!isRecord(body)) return refuse(400, "bad_request");

  const tenant = getVoiceTenant(body.tenant);
  if (!tenant) return refuse(400, "bad_request");
  if (!originAllowed(request, tenant)) return refuse(403, "forbidden", tenant.id);

  const requested = body.mode;
  if (typeof requested !== "string" || !MODES.includes(requested as VoiceMode)) return refuse(400, "bad_request", tenant.id);
  const askedLocale = body.locale;
  if (!isVoiceLocale(askedLocale)) return refuse(400, "bad_request", tenant.id);
  if (body.page !== undefined && (typeof body.page !== "string" || body.page.length > MAX_PAGE_CHARS)) {
    return refuse(400, "bad_request", tenant.id);
  }
  if (body.hp !== undefined && typeof body.hp !== "string") return refuse(400, "bad_request", tenant.id);
  // Honeypot: a field people never see. Anything in it is a bot filling every input.
  if (typeof body.hp === "string" && body.hp !== "") return refuse(403, "forbidden", tenant.id);

  const locale: VoiceLocale = tenant.locales.includes(askedLocale) ? askedLocale : tenant.defaultLocale;
  // The server may answer with a lesser mode than asked; "scripted" is always on offer. A demo
  // business gets live modes only in the lab (VOICE_LAB), never from the public site.
  const offered = availableModes(env, tenant);
  const mode: VoiceMode = offered.includes(requested as VoiceMode) ? (requested as VoiceMode) : "scripted";

  // The provider first: whether it confirms calls decides what admission charges (limits.ts).
  const provider = mode !== "realtime" ? null : deps.provider === undefined ? getRealtimeProvider(env) : deps.provider;
  if (mode === "realtime" && provider === null) return refuse(503, "unavailable", tenant.id);

  const { shared, accounting } = voiceStores(deps);
  const limits = resolveVoiceLimits(tenant, env);
  const ip = clientIp(request);
  // IPv6 visitors are counted per /64 (rateLimitSubject); only the salted hash is ever stored.
  const ipHash = ip ? hashId(rateLimitSubject(ip), env.hashSalt) : null;
  const admission = await admitSession({
    store: accounting,
    ipStore: shared,
    tenantId: tenant.id,
    limits,
    global: env.global,
    ipHash,
    mode,
    costChfPerMinute: voiceCostChfPerMinute(env, mode),
    // A "local" conversation must be able to pay for at least one turn of the model.
    spendHeadroomMicroChf: mode === "local" ? usdToMicroChf(firstTurnWorstCaseUsd(tenant, locale, limits, env, now), env.chfPerUsd) : 0,
    providerConfirmsCalls: provider?.confirmsCalls === true,
    now,
  });
  if (!admission.ok) {
    // A tenant at capacity is not the visitor misbehaving: 503, like the chat's spent budget.
    const status = admission.code === "rate_limited" ? 429 : 503;
    return refuse(status, admission.code, tenant.id, admission.retryAfter);
  }
  const reservation = admission.reservation;
  const sessionId = reservation.sessionId;
  // The alert markers are few (per tenant, month and threshold): kept with the counters.
  if (admission.spend) await reportSpend(accounting, tenant.id, reservation.month, admission.spend, limits.budgetChfPerMonth);

  // From here on a failure must give the reservation back.
  const giveBack = (): Promise<void> => cancelReservation(accounting, reservation, now);

  let realtime: SessionGrant["realtime"];
  if (provider !== null) {
    // The prompt of the text-turn mode, opening hours included: "open now" or "closed now, next
    // opening ..." as of this moment (review finding S2-5). One builder, so the two modes cannot
    // drift apart.
    const system = turnSystem({ tenant, state: { channel: "web", outcomes: [] }, locale, now: new Date(now), remainingSeconds: limits.maxCallSeconds });
    const opened = await openProviderSession({
      provider,
      store: shared,
      signal: request.signal,
      now,
      session: {
        tenantId: tenant.id,
        sessionId,
        locale,
        maxSeconds: limits.maxCallSeconds,
        systemPrompt: system.map((block) => block.text).join("\n\n"),
        greeting: pickVoiceText(tenant.greeting, locale, tenant.defaultLocale),
        tools: toolDefinitions(tenant),
        toolWebhookUrl: new URL(VOICE_TOOL_ENDPOINT, request.url).href,
      },
    });
    if (!opened.ok) {
      await giveBack();
      const status = opened.code === "timeout" ? 504 : opened.code === "upstream" ? 502 : 503;
      return refuse(status, opened.code, tenant.id);
    }
    realtime = { provider: provider.id, token: opened.token, expiresAt: opened.expiresAt, ...(opened.params ? { params: opened.params } : {}) };
  }

  // Live sessions keep their reservation (and, in "local", the conversation) on the server.
  if (mode !== "scripted") {
    const state = createSessionState({ tenantId: tenant.id, sessionId, mode, channel: "web", locale, startedAt: now, reservation });
    if (!(await saveState(accounting, sessionId, state, stateTtlSeconds(limits)))) {
      // The shared store is down: a session that cannot keep its state cannot be settled either.
      await giveBack();
      logVoiceEvent({ op: "session", tenant: tenant.id, mode, rejected: "state_not_saved" });
      return refuse(503, "unavailable", tenant.id);
    }
  }

  const iat = Math.floor(now / 1000);
  const claims: SessionClaims = {
    v: 1,
    tid: tenant.id,
    sid: sessionId,
    mode,
    loc: locale,
    ch: "web",
    iat,
    exp: iat + sessionLifetimeSeconds(limits),
  };
  if (ipHash !== null && IP_HASH_RE.test(ipHash)) claims.ip = ipHash;

  logVoiceEvent({ op: "session", tenant: tenant.id, mode, asked: requested, locale, store: shared.kind });
  return {
    ok: true,
    grant: {
      ok: true,
      sessionToken: signSessionToken(claims, env.sessionSecret),
      mode,
      locale,
      expiresAt: claims.exp * 1000,
      limits: {
        maxCallSeconds: limits.maxCallSeconds,
        warnBeforeEndSeconds: limits.warnBeforeEndSeconds,
        silenceTimeoutSeconds: limits.silenceTimeoutSeconds,
        maxTurnChars: limits.maxTurnChars,
      },
      ...(realtime ? { realtime } : {}),
    },
  };
}

/**
 * The worst case of a first turn (an empty history and the longest utterance allowed), to check at
 * admission that the month's spend can still pay for one turn.
 */
function firstTurnWorstCaseUsd(tenant: VoiceTenantConfig, locale: VoiceLocale, limits: VoiceLimits, env: VoiceEnv, now: number): number {
  return turnWorstCaseUsd({
    modelId: env.model,
    maxOutputTokens: env.maxOutputTokens,
    system: turnSystem({ tenant, state: { channel: "web", outcomes: [] }, locale, now: new Date(now), remainingSeconds: limits.maxCallSeconds }),
    tools: turnTools(tenant),
    messages: [{ role: "user", content: "x".repeat(limits.maxTurnChars) }],
  });
}

/**
 * One log line per spend threshold crossed this month, once per tenant, month and threshold.
 * Never an email from here: VOICE_ALERT_EMAIL is not wired to a sender yet.
 */
export async function reportSpend(
  store: KVStore,
  tenantId: string,
  month: string,
  spend: { beforeChf: number; afterChf: number },
  budget: number,
): Promise<void> {
  for (const percent of spendThresholdsCrossed(spend.beforeChf, spend.afterChf, budget)) {
    if (await seenBefore(store, `alert:${tenantId}:${month}:${percent}`, 40 * 86_400)) continue;
    logVoiceEvent({ warn: "voice_spend_threshold", tenant: tenantId, percent });
  }
}

// ---------------------------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------------------------

export type CloseOutcome = { ok: true; closed: boolean } | Refusal;

const END_REASONS = new Set(["user", "assistant", "timeout", "silence", "error", "unload"]);

/** POST /api/voice/end (`body` is the parsed JSON). Idempotent: a second report changes nothing. */
export async function closeSession(body: unknown, deps: VoiceDeps = {}): Promise<CloseOutcome> {
  const env = getVoiceEnv();
  const now = (deps.now ?? Date.now)();
  if (!isRecord(body) || typeof body.sessionToken !== "string") return refuse(400, "bad_request");
  // Without a secret no session could have been opened: nothing to close.
  if (env.sessionSecret === null) return { ok: true, closed: false };
  const verified = verifySessionToken(body.sessionToken, env.sessionSecret, now, { acceptExpiredForSeconds: END_GRACE_SECONDS });
  if (!verified.ok) return verified.reason === "expired" ? { ok: true, closed: false } : refuse(403, "forbidden");
  const reason = typeof body.reason === "string" && END_REASONS.has(body.reason) ? body.reason : "unknown";
  const closed = await finishSession({ claims: verified.claims, reason, env, deps, now });
  return { ok: true, closed };
}

/**
 * Ends a session once: settles its reservation with the seconds really used, hands the business
 * what it has not received yet, and removes the state. Used by the end route and by the turn
 * route when the assistant ended the call. True when THIS call closed it. Never throws.
 *
 * An example ("scripted") has nothing to close and writes nothing: its tokens are free to get, and
 * an end report for each must not fill the accounting store with markers.
 */
export async function finishSession(args: {
  claims: SessionClaims;
  reason: string;
  env: VoiceEnv;
  deps: VoiceDeps;
  now: number;
}): Promise<boolean> {
  const { claims, deps, env, now } = args;
  if (claims.mode === "scripted") return false;
  const { accounting: store } = voiceStores(deps);
  // Closed first, before waiting: no new turn or tool call starts from here on (they check the
  // marker under the lock), and a repeated end report returns at once instead of waiting for the
  // lock too (review findings S2-4 and S2-6).
  if ((await store.incrBy(closedKey(claims.sid), 1, CLOSED_TTL_SECONDS)) !== 1) return false;
  // A turn that is still running finishes first and saves its state, so the summary has what it
  // did. One that runs longer finds the session ending when it saves, and removes its state
  // instead (handlers.ts, persistUnlessEnded): the summary below is made from the state as it is
  // now, and the conversation must not be kept after it.
  const lock = await acquireSessionLock(store, claims.sid, {
    clock: deps.now ?? Date.now,
    waitMs: deps.lockWaitMs ?? END_LOCK_WAIT_MS,
  });
  try {
    await store.incrBy(endingKey(claims.sid), 1, CLOSED_TTL_SECONDS);
    const tenant = getVoiceTenant(claims.tid);
    const state = await loadState(store, claims.sid);
    const valid = state !== null && state.tenantId === claims.tid;
    let delivery: SummaryDelivery | null = null;
    // Settled from the ledger, so a session whose state expired, was lost or lives on another
    // instance still frees its slot and gives back exactly what this store holds for it.
    const reservation = valid && state.reservation ? state.reservation : reservationFromClaims(claims, voiceCostChfPerMinute(env, claims.mode));
    if (!valid) logVoiceEvent({ warn: "voice_state_missing", op: "end", tenant: claims.tid, mode: claims.mode });
    const startedAt = valid ? state.startedAt : claims.iat * 1000;
    if (reservation) await settleSession(store, reservation, (now - startedAt) / 1000, now);
    if (valid && tenant) {
      // Requests and callback wishes went out the moment they were taken: only the rest now.
      delivery = await deliverSummary({
        summary: endOfCallSummary(state, tenant, now),
        tenant,
        resend: deps.resend,
        send: deps.sendEmail,
      });
    }
    await clearState(store, claims.sid);
    logVoiceEvent({
      op: "end",
      tenant: claims.tid,
      mode: claims.mode,
      reason: args.reason,
      seconds: Math.max(0, Math.round((now - startedAt) / 1000)),
      turns: valid ? state.turns : undefined,
      outcomes: valid ? state.outcomes.length : undefined,
      delivery: delivery === null ? "none" : delivery.sent ? "sent" : delivery.reason,
    });
    return true;
  } catch (error) {
    logVoiceEvent({ warn: "voice_end_failed", tenant: claims.tid, errorName: error instanceof Error ? error.name : typeof error });
    return false;
  } finally {
    await lock?.release();
  }
}

/** True once the session was closed: no turn and no tool may run in it any more. */
export async function isSessionClosed(store: KVStore, sessionId: string): Promise<boolean> {
  const value = await store.get(closedKey(sessionId));
  return value !== null && Number.parseInt(value, 10) > 0;
}

/**
 * True once the end of the session has stopped waiting for its running turn and makes the
 * summary from the stored state: a turn that saves after this would keep the conversation beyond
 * its end (review finding S2-6). A closed session is not ending yet while the end report still
 * waits: a turn finishing then must save, so the summary has what it did.
 */
export async function isSessionEnding(store: KVStore, sessionId: string): Promise<boolean> {
  const value = await store.get(endingKey(sessionId));
  return value !== null && Number.parseInt(value, 10) > 0;
}

function closedKey(sessionId: string): string {
  return `mva:closed:${sessionId}`;
}

function endingKey(sessionId: string): string {
  return `mva:ending:${sessionId}`;
}

// ---------------------------------------------------------------------------------------------
// What the tools of a session reach
// ---------------------------------------------------------------------------------------------

/**
 * The sinks of a web session. A request or a callback wish of a live tenant is emailed to the
 * business the moment the tool takes it (deliverRequest): it must not depend on the session
 * ending properly, since the end report may never come. The tool reports success, and the
 * assistant says it was passed on, only when the email service accepted the message; without a
 * recipient or an email service nothing is accepted. A demo business is invented: its requests
 * stay in the demo. There is no telephony on the web: a transfer never connects.
 */
export function createSessionSinks(
  tenant: VoiceTenantConfig,
  resend: ResendConfig | null = summaryEmailConfig(),
  options: { send?: SendEmail; session?: { channel: VoiceChannel; startedAt: number } } = {},
): ToolSinks {
  const deliverable = canDeliverSummary(tenant, resend);
  const deliver = async (
    outcome: Extract<CallSummary["outcomes"][number], { kind: "lead" | "callback" }>,
    record: { sessionId: string; locale: VoiceLocale; idempotencyKey?: string },
  ): Promise<"sent" | "failed" | "unknown"> => {
    if (tenant.kind === "demo") return "sent";
    if (!deliverable) return "failed";
    const delivery = await deliverRequest({
      outcome,
      tenant,
      session: {
        sessionId: record.sessionId,
        locale: record.locale,
        channel: options.session?.channel ?? "web",
        startedAt: options.session?.startedAt ?? Date.now(),
      },
      resend,
      send: options.send,
      ...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
    });
    if (delivery.sent) return "sent";
    return delivery.reason === "send_unknown" ? "unknown" : "failed";
  };
  return {
    async lead(record) {
      // From the call's key when there is one: a repeat after an unanswered send names the
      // reference of the email the business may already have (review finding S2-8).
      const ref = newLeadRef(record.idempotencyKey);
      const result = await deliver({ kind: "lead", taskId: record.taskId, ref, fields: record.fields, contact: record.contact }, record);
      if (result === "sent") return { ok: true, ref };
      return result === "unknown" ? { ok: false, ref: "", uncertain: true } : { ok: false, ref: "" };
    },
    async callback(record) {
      const outcome = {
        kind: "callback" as const,
        name: record.name,
        phone: record.phone,
        topic: record.topic,
        ...(record.preferredTime === undefined ? {} : { preferredTime: record.preferredTime }),
      };
      const result = await deliver(outcome, record);
      return result === "unknown" ? { ok: false, uncertain: true } : { ok: result === "sent" };
    },
    async transfer() {
      return { connected: false };
    },
  };
}

/**
 * "LD-7K2Q": the safe alphabet of booking references (no 0/O, 1/I). Taken from `seed` (the tool
 * call's idempotency key, hex) when given, so the same request always gets the same reference;
 * random otherwise.
 */
function newLeadRef(seed?: string): string {
  const bytes = seed && /^[0-9a-f]{8,}$/i.test(seed) ? createHash("sha256").update(`lead-ref:${seed}`).digest() : null;
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += LEAD_REF_ALPHABET[bytes ? bytes[index] % LEAD_REF_ALPHABET.length : randomInt(LEAD_REF_ALPHABET.length)];
  }
  return `LD-${code}`;
}

/**
 * A session's state, or a fresh one when it is missing although the token is valid: with the
 * in-memory store, the request may have reached another server instance than the one that opened
 * the session. The conversation then starts over (and its reservation is not settled), which is
 * logged; the turn and tool caps of the store still apply.
 */
export async function loadOrRecoverState(store: KVStore, claims: SessionClaims): Promise<VoiceSessionState> {
  const state = await loadState(store, claims.sid);
  if (state !== null && state.tenantId === claims.tid) return state;
  logVoiceEvent({ warn: "voice_state_missing", tenant: claims.tid, mode: claims.mode, stored: state !== null || undefined });
  return createSessionState({
    tenantId: claims.tid,
    sessionId: claims.sid,
    mode: claims.mode,
    channel: claims.ch,
    locale: claims.loc,
    startedAt: claims.iat * 1000,
    reservation: null,
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * The chat's origin rule (lib/assistant/server/guard.ts), which reads nothing but allowedOrigins:
 * one rule for both assistants. Same origin, an origin the tenant allows, localhost outside
 * production; no Origin header passes.
 */
export function originAllowed(request: Request, tenant: VoiceTenantConfig): boolean {
  return isOriginAllowed(request, { allowedOrigins: tenant.allowedOrigins } as TenantConfig);
}

export function refuse(status: number, error: VoiceErrorCode, tenantId: string | null = null, retryAfter?: number): Refusal {
  logVoiceEvent({ op: "refused", tenant: tenantId, rejected: error, httpStatus: status });
  return retryAfter === undefined ? { ok: false, status, error } : { ok: false, status, error, retryAfter };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
