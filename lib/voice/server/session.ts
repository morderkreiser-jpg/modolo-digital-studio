// Opening and closing voice sessions. Server-only.
//
// openSession: cheapest checks first, so abuse is turned away before it costs anything:
//   switch + secret → tenant → origin → body → honeypot → mode → admission (IP, concurrency,
//   minutes, spend: limits.ts) → realtime provider (behind the breaker) → state → signed token.
// closeSession: token (a late end report gets a short grace) → once per session → settle the
//   reservation → summary to the business (live tenants only) → state removed.
//
// The tenant always comes from the SIGNED token once a session exists, never from a request body:
// a token of one business can never act for another. A request without an Origin header (not a
// browser page) passes the origin check, like the chat's, but every limit still applies to it.
import { randomInt } from "node:crypto";
import { clientIp, hashId, isOriginAllowed, rateLimitSubject } from "@/lib/assistant/server/guard";
import { getStore, type KVStore } from "@/lib/assistant/server/store";
import type { TenantConfig } from "@/lib/assistant/types";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { buildVoiceSystem } from "@/lib/voice/prompt";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import type { ToolSinks } from "@/lib/voice/tools/execute";
import {
  isVoiceLocale,
  type CalendarProvider,
  type SessionGrant,
  type VoiceErrorCode,
  type VoiceLocale,
  type VoiceMode,
  type VoiceTenantConfig,
} from "@/lib/voice/types";
import type { BrainModel } from "./brain";
import { availableModes, getVoiceEnv, resolveVoiceLimits, voiceCostChfPerMinute, type VoiceEnv } from "./env";
import { admitSession, sessionLifetimeSeconds, settleSession, spendThresholdsCrossed } from "./limits";
import { logVoiceEvent } from "./log";
import { getRealtimeProvider, openProviderSession, type RealtimeProvider } from "./providers";
import { clearState, createSessionState, loadState, saveState, stateTtlSeconds, type VoiceSessionState } from "./state";
import {
  buildCallSummary,
  canDeliverSummary,
  deliverSummary,
  summaryEmailConfig,
  type ResendConfig,
  type SendEmail,
  type SummaryDelivery,
} from "./summary";
import { MAX_SESSION_TOKEN_LIFETIME_SECONDS, signSessionToken, verifySessionToken, type SessionClaims } from "./token";
import { seenBefore } from "./webhook";

/** An end report may arrive this long after the token expired and still close the session. */
export const END_GRACE_SECONDS = 10 * 60;
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
  store?: KVStore;
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
  // The server may answer with a lesser mode than asked; "scripted" is always on offer.
  const offered = availableModes(env);
  const mode: VoiceMode = offered.includes(requested as VoiceMode) ? (requested as VoiceMode) : "scripted";

  const store = deps.store ?? getStore();
  const limits = resolveVoiceLimits(tenant, env);
  const ip = clientIp(request);
  // IPv6 visitors are counted per /64 (rateLimitSubject); only the salted hash is ever stored.
  const ipHash = ip ? hashId(rateLimitSubject(ip), env.hashSalt) : null;
  const admission = await admitSession({
    store,
    tenantId: tenant.id,
    limits,
    ipHash,
    mode,
    costChfPerMinute: voiceCostChfPerMinute(env, mode),
    now,
  });
  if (!admission.ok) {
    // A tenant at capacity is not the visitor misbehaving: 503, like the chat's spent budget.
    const status = admission.code === "rate_limited" ? 429 : 503;
    return refuse(status, admission.code, tenant.id, admission.retryAfter);
  }
  const reservation = admission.reservation;
  const sessionId = reservation.sessionId;
  if (admission.spend) await reportSpend(store, tenant.id, reservation.month, admission.spend, limits.budgetChfPerMonth);

  // From here on a failure must give the reservation back.
  const giveBack = (): Promise<void> => settleSession(store, reservation, 0, now);

  let realtime: SessionGrant["realtime"];
  if (mode === "realtime") {
    const provider = deps.provider === undefined ? getRealtimeProvider(env) : deps.provider;
    if (provider === null) {
      await giveBack();
      return refuse(503, "unavailable", tenant.id);
    }
    const system = buildVoiceSystem({ tenant, locale, channel: "web", now: new Date(now), isOpen: true, remainingSeconds: limits.maxCallSeconds });
    const opened = await openProviderSession({
      provider,
      store,
      signal: request.signal,
      now,
      session: {
        tenantId: tenant.id,
        sessionId,
        locale,
        maxSeconds: limits.maxCallSeconds,
        systemPrompt: `${system.staticText}\n\n${system.dynamicText}`,
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
    if (!(await saveState(store, sessionId, state, stateTtlSeconds(limits)))) {
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

  logVoiceEvent({ op: "session", tenant: tenant.id, mode, asked: requested, locale, store: store.kind });
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
 * One log line per spend threshold crossed this month, once per tenant, month and threshold.
 * Never an email from here: VOICE_ALERT_EMAIL is not wired to a sender yet.
 */
async function reportSpend(
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
 * Ends a session once: settles its reservation with the seconds really used, hands the summary to
 * the business, and removes the state. Used by the end route and by the turn route when the
 * assistant ended the call. True when THIS call closed it. Never throws.
 */
export async function finishSession(args: {
  claims: SessionClaims;
  reason: string;
  env: VoiceEnv;
  deps: VoiceDeps;
  now: number;
}): Promise<boolean> {
  const { claims, deps, now } = args;
  const store = deps.store ?? getStore();
  try {
    if ((await store.incrBy(closedKey(claims.sid), 1, CLOSED_TTL_SECONDS)) !== 1) return false;

    const tenant = getVoiceTenant(claims.tid);
    const state = await loadState(store, claims.sid);
    const valid = state !== null && state.tenantId === claims.tid;
    let delivery: SummaryDelivery | null = null;
    if (valid && state.reservation) {
      await settleSession(store, state.reservation, (now - state.startedAt) / 1000, now);
    } else if (claims.mode !== "scripted") {
      // The state expired or never reached this store: the reservation stays charged in full (the
      // safe direction) and the concurrency slot frees itself when its buckets pass.
      logVoiceEvent({ warn: "voice_state_missing", op: "end", tenant: claims.tid, mode: claims.mode });
    }
    if (valid && tenant) {
      delivery = await deliverSummary({
        summary: buildCallSummary(state, tenant, now),
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
      seconds: valid ? Math.max(0, Math.round((now - state.startedAt) / 1000)) : undefined,
      turns: valid ? state.turns : undefined,
      outcomes: valid ? state.outcomes.length : undefined,
      summary: delivery === null ? "none" : delivery.sent ? "sent" : delivery.reason,
    });
    return true;
  } catch (error) {
    logVoiceEvent({ warn: "voice_end_failed", tenant: claims.tid, errorName: error instanceof Error ? error.name : typeof error });
    return false;
  }
}

/** True once the session was closed: no turn and no tool may run in it any more. */
export async function isSessionClosed(store: KVStore, sessionId: string): Promise<boolean> {
  const value = await store.get(closedKey(sessionId));
  return value !== null && Number.parseInt(value, 10) > 0;
}

function closedKey(sessionId: string): string {
  return `mva:closed:${sessionId}`;
}

// ---------------------------------------------------------------------------------------------
// What the tools of a session reach
// ---------------------------------------------------------------------------------------------

/**
 * The sinks of a web session. Requests and callback wishes are kept in the session's outcomes and
 * reach the business with the call summary when the session ends (deliverSummary). So a live
 * tenant without a recipient or an email service refuses them: the assistant then says the
 * request did not go through, instead of promising a hand-over that would never happen. A demo
 * business is invented; its requests stay in the demo. There is no telephony on the web: a
 * transfer never connects.
 */
export function createSessionSinks(tenant: VoiceTenantConfig, resend: ResendConfig | null = summaryEmailConfig()): ToolSinks {
  const deliverable = canDeliverSummary(tenant, resend);
  return {
    async lead() {
      return deliverable ? { ok: true, ref: newLeadRef() } : { ok: false, ref: "" };
    },
    async callback() {
      return { ok: deliverable };
    },
    async transfer() {
      return { connected: false };
    },
  };
}

/** "LD-7K2Q": the safe alphabet of booking references (no 0/O, 1/I), random per request. */
function newLeadRef(): string {
  let code = "";
  for (let index = 0; index < 4; index += 1) code += LEAD_REF_ALPHABET[randomInt(LEAD_REF_ALPHABET.length)];
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
