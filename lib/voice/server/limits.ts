// Admission and accounting of voice sessions: who may open a conversation, and what it is allowed
// to cost. Server-only. Everything works on the KVStore passed in (memory or Upstash, see
// lib/assistant/server/store.ts), which never throws and has no scan and no delete.
//
// Counters (all integers, so they can be incremented atomically in Redis):
//   mda:rl:mva:ip:<tenant>:<live|scripted>:<ip hash>:<3600|86400>:<window>
//                                    sessions per IP subject (hitWindow from the chat guard; the
//                                    chat's limiter adds its "mda:rl:" prefix)
//   mva:run:<tenant>:<L>:<bucket>    sessions that may be running (see "Concurrency" below)
//   mva:sec:<tenant>:<YYYY-MM-DD>    conversation seconds today, reservations included (TTL 3 d)
//   mva:sec:<tenant>:<YYYY-MM>       conversation seconds this month (TTL 40 d)
//   mva:chf:<tenant>:<YYYY-MM>       estimated spend this month, micro-CHF (TTL 40 d)
//   mva:settled:<tenant>:<session>   settlement marker, makes settleSession idempotent (TTL 2 d)
//   mva:turn:<session>               caller turns of one session (TTL 1 d)
//
// Every key carries the tenant (or a 128-bit random session id), so one tenant's traffic can never
// use up, or read, another tenant's counters.
//
// Reservation, not after-the-fact counting: a conversation is admitted only after its WORST CASE
// (limits.maxCallSeconds, and what that costs) has been added to the day minutes, the month
// minutes and the month spend with atomic increments. Sessions opened at the same instant
// therefore see each other: the increment that pushes a counter over its limit is taken back and
// that session is refused, so together they can never overshoot. When the session ends,
// settleSession() gives back what it did not use.
//
// Concurrency without a key scan. Time is cut into buckets of L = maxCallSeconds + grace seconds.
// Opening a session increments TWO counters: its own bucket b and the next one, b + 1. "Running
// now" is simply the counter of the current bucket. Why this works:
//   - A session opened at t counts in every check made during buckets b and b + 1, i.e. until
//     (b + 2) * L, which is always more than t + L. With L at least the session's whole life,
//     a session is never forgotten while it can still be running.
//   - A session that never reports its end stops counting at (b + 2) * L, at most 2 * L after it
//     opened. Nothing has to clean it up.
//   - The admission check reads the values returned by its OWN two increments. Two sessions racing
//     at a bucket boundary (one in b, one in b + 1) both increment b + 1, so the second of them
//     sees the first: the check is atomic, with no read-then-write gap.
//   - The count is an upper bound (a session that ended early but whose end was never reported
//     still counts until its buckets pass), which is the safe direction.
// Ending a session decrements both of its buckets. L is part of the key, so a change of
// maxCallSeconds starts fresh counters instead of mixing bucket sizes.
import type { KVStore } from "@/lib/assistant/server/store";
import {
  hashId,
  hitWindow,
  secondsUntilNextUtcDay,
  secondsUntilNextUtcMonth,
  utcDay,
  utcMonth,
} from "@/lib/assistant/server/guard";
import { DEFAULT_VOICE_LIMITS, type VoiceLimits, type VoiceMode } from "@/lib/voice/types";
import { VOICE_LIMIT_RANGES } from "./env";
import { logVoiceEvent } from "./log";
import { isSessionId, isTenantId, newSessionId } from "./token";

const HOUR = 3600;
const DAY = 24 * HOUR;
const DAY_TTL = 3 * DAY;
const MONTH_TTL = 40 * DAY;
const SETTLED_TTL = 2 * DAY;
const TURNS_TTL = DAY;

/**
 * Seconds a session may live beyond maxCallSeconds: the time between admission and the first
 * word (microphone permission, connecting to the provider) plus the end report. The session
 * token should expire after sessionLifetimeSeconds() too, so a session can never outlive the
 * window in which it counts as running.
 */
export const SESSION_GRACE_SECONDS = 60;
/**
 * Scripted examples cost nothing, so their per-IP allowance is this many times the live one, on
 * separate counters: watching a few examples must not use up a visitor's real conversations.
 */
export const SCRIPTED_IP_LIMIT_FACTOR = 5;
/** Retry-After of a "busy" refusal: nobody knows when a slot frees up, so a short wait. */
export const BUSY_RETRY_AFTER_SECONDS = 30;
/** Spend thresholds (percent of the monthly budget) reported by spendThresholdsCrossed(). */
export const SPEND_ALERT_THRESHOLDS = [50, 80, 100] as const;

/**
 * What admitSession() charged, to be settled by settleSession() when the conversation ends.
 * Plain JSON: it travels inside the session state. `day` and `month` are the counters charged, so
 * a session that ends after midnight is still settled on the day it was admitted.
 */
export interface SessionReservation {
  tenantId: string;
  sessionId: string;
  mode: VoiceMode;
  /** Worst case reserved: limits.maxCallSeconds (0 for "scripted"). */
  reservedSeconds: number;
  costChfPerMinute: number;
  /** Spend reserved, micro-CHF. */
  reservedMicroChf: number;
  day: string;
  month: string;
  /** Concurrency bucket the session was counted in (and the next one); null for "scripted". */
  bucket: number | null;
  /** L, the bucket length in seconds. */
  bucketSeconds: number;
  /** Unix ms of the admission. */
  at: number;
}

export type AdmissionResult =
  | {
      ok: true;
      reservation: SessionReservation;
      /** Month spend before and after this reservation (live modes only), for spendThresholdsCrossed(). */
      spend?: { beforeChf: number; afterChf: number };
    }
  | { ok: false; code: "rate_limited" | "busy" | "budget_exhausted"; retryAfter?: number };

/** How long a session may last from admission to its end, in seconds (token expiry, bucket L). */
export function sessionLifetimeSeconds(limits: Pick<VoiceLimits, "maxCallSeconds">): number {
  return callSeconds(limits.maxCallSeconds) + SESSION_GRACE_SECONDS;
}

/**
 * Decides whether a new conversation may start and, if so, reserves its worst case. Checks run
 * cheapest first and stop at the first refusal, so a refused session does not consume the later
 * quotas:
 *   1. sessions per IP per hour and per day (skipped when the IP is unknown)
 *   2. conversations running at the same time, per tenant
 *   3. minutes of the day and of the month, and the estimated spend of the month: reserved
 *      together in one round trip; any of them over its limit takes all three back
 * "scripted" costs nothing: it passes only its own per-IP limit and reserves nothing.
 * Like the chat guard, an attempt refused at gate 2 or 3 still counts against the per-IP windows:
 * hammering a busy or spent tenant never resets them.
 *
 * The reservation's sessionId is the session's id from here on (put it in the token's `sid`).
 */
export async function admitSession(args: {
  store: KVStore;
  tenantId: string;
  limits: VoiceLimits;
  ipHash: string | null;
  mode: VoiceMode;
  costChfPerMinute: number;
  /** Defaults to (and, when it is not a session id, is replaced by) a new random id. */
  sessionId?: string;
  now?: number;
}): Promise<AdmissionResult> {
  const { store, tenantId, limits, ipHash, mode } = args;
  const now = args.now ?? Date.now();
  const sessionId = isSessionId(args.sessionId) ? args.sessionId : newSessionId();
  const scripted = mode === "scripted";

  // 1. Per IP. A null IP means "unknown", never one shared bucket for everybody.
  if (ipHash !== null) {
    // Callers pass hashId(rateLimitSubject(ip), env.hashSalt). Should one pass a raw address by
    // mistake, it is hashed here so that no IP ever ends up in a store key.
    const subject = IP_HASH_RE.test(ipHash) ? ipHash : hashId(ipHash, "mva-ip");
    const factor = scripted ? SCRIPTED_IP_LIMIT_FACTOR : 1;
    const windows: Array<[limit: number, seconds: number]> = [
      [allowance(limits.sessionsPerIpPerHour) * factor, HOUR],
      [allowance(limits.sessionsPerIpPerDay) * factor, DAY],
    ];
    const kind = scripted ? "scripted" : "live";
    for (const [limit, seconds] of windows) {
      const hit = await hitWindow(store, `mva:ip:${tenantId}:${kind}:${subject}:${seconds}`, limit, seconds, now);
      if (!hit.allowed) return { ok: false, code: "rate_limited", retryAfter: hit.retryAfter };
    }
  }

  const day = utcDay(now);
  const month = utcMonth(now);
  const bucketSeconds = sessionLifetimeSeconds(limits);
  if (scripted) {
    return {
      ok: true,
      reservation: {
        tenantId,
        sessionId,
        mode,
        reservedSeconds: 0,
        costChfPerMinute: 0,
        reservedMicroChf: 0,
        day,
        month,
        bucket: null,
        bucketSeconds,
        at: now,
      },
    };
  }

  // 2. Concurrency: two increments, checked on their own results (see the header).
  const bucket = Math.floor(now / 1000 / bucketSeconds);
  const runTtl = 3 * bucketSeconds;
  const running: Write[] = [
    [runKey(tenantId, bucketSeconds, bucket), 1, runTtl],
    [runKey(tenantId, bucketSeconds, bucket + 1), 1, runTtl],
  ];
  const [runningNow, runningNext] = await apply(store, running);
  const maxRunning = allowance(limits.maxConcurrentSessions);
  if (runningNow > maxRunning || runningNext > maxRunning) {
    await rollback(store, running);
    return { ok: false, code: "busy", retryAfter: BUSY_RETRY_AFTER_SECONDS };
  }

  // 3. Minutes and spend: the worst case, reserved atomically.
  const reservedSeconds = callSeconds(limits.maxCallSeconds);
  const costChfPerMinute = costPerMinute(args.costChfPerMinute);
  const reservedMicroChf = microChf(reservedSeconds, costChfPerMinute);
  const budget: Write[] = [
    [secondsKey(tenantId, day), reservedSeconds, DAY_TTL],
    [secondsKey(tenantId, month), reservedSeconds, MONTH_TTL],
    [spendKey(tenantId, month), reservedMicroChf, MONTH_TTL],
  ];
  const [secondsToday, secondsThisMonth, spendMicro] = await apply(store, budget);
  const dayOver = secondsToday > allowance(limits.minutesPerDay) * 60;
  const monthOver = secondsThisMonth > allowance(limits.minutesPerMonth) * 60;
  const spendOver = spendMicro > Math.floor(allowance(limits.budgetChfPerMonth) * 1e6);
  if (dayOver || monthOver || spendOver) {
    await Promise.all([rollback(store, budget), rollback(store, running)]);
    // A spent month outlasts the day: waiting for tomorrow would not help.
    const retryAfter = monthOver || spendOver ? secondsUntilNextUtcMonth(now) : secondsUntilNextUtcDay(now);
    return { ok: false, code: "budget_exhausted", retryAfter };
  }

  return {
    ok: true,
    reservation: {
      tenantId,
      sessionId,
      mode,
      reservedSeconds,
      costChfPerMinute,
      reservedMicroChf,
      day,
      month,
      bucket,
      bucketSeconds,
      at: now,
    },
    spend: { beforeChf: (spendMicro - reservedMicroChf) / 1e6, afterChf: spendMicro / 1e6 },
  };
}

/**
 * Turns a reservation into the real usage: gives back the seconds and the spend the session did
 * not use (the usage is never below zero and never above the reservation) and releases its
 * concurrency slot. Idempotent per session id: a second settle of the same session changes
 * nothing, so a retried or duplicated end report cannot give minutes back twice.
 *
 * `usedSeconds` that is not a finite number charges the whole reservation: when in doubt, never
 * undercount. A reservation that does not look like one of ours is ignored (and logged).
 */
export async function settleSession(
  store: KVStore,
  reservation: SessionReservation,
  usedSeconds: number,
  now: number = Date.now(),
): Promise<void> {
  const r = parseSessionReservation(reservation);
  if (r === null) {
    logVoiceEvent({ warn: "settle_invalid_reservation" });
    return;
  }
  if (r.mode === "scripted" || (r.reservedSeconds === 0 && r.bucket === null)) return;

  const first = await store.incrBy(`mva:settled:${r.tenantId}:${r.sessionId}`, 1, SETTLED_TTL);
  if (first !== 1) return;

  const used = Number.isFinite(usedSeconds) ? Math.min(r.reservedSeconds, Math.max(0, Math.ceil(usedSeconds))) : r.reservedSeconds;
  const usedMicro = Math.min(r.reservedMicroChf, microChf(used, r.costChfPerMinute));
  const writes: Write[] = [
    [secondsKey(r.tenantId, r.day), used - r.reservedSeconds, DAY_TTL],
    [secondsKey(r.tenantId, r.month), used - r.reservedSeconds, MONTH_TTL],
    [spendKey(r.tenantId, r.month), usedMicro - r.reservedMicroChf, MONTH_TTL],
  ];
  // Once both buckets are in the past the session no longer counts anyway: decrementing would only
  // recreate expired keys.
  const currentBucket = Math.floor(now / 1000 / r.bucketSeconds);
  if (r.bucket !== null && currentBucket <= r.bucket + 1) {
    const runTtl = 3 * r.bucketSeconds;
    writes.push(
      [runKey(r.tenantId, r.bucketSeconds, r.bucket), -1, runTtl],
      [runKey(r.tenantId, r.bucketSeconds, r.bucket + 1), -1, runTtl],
    );
  }
  // A session that used its whole reservation has nothing to give back: skip the round trips.
  await apply(store, writes.filter(([, by]) => by !== 0));
}

/**
 * The counters read back for one tenant. Minutes and spend include the reservations of sessions
 * still running. `running` needs the bucket length: pass the tenant's resolved limits when its
 * maxCallSeconds differs from the default, or the count reads the wrong buckets.
 */
export async function usageSnapshot(
  store: KVStore,
  tenantId: string,
  now: number = Date.now(),
  limits: Pick<VoiceLimits, "maxCallSeconds"> = DEFAULT_VOICE_LIMITS,
): Promise<{ minutesToday: number; minutesThisMonth: number; spendChfThisMonth: number; running: number }> {
  const month = utcMonth(now);
  const bucketSeconds = sessionLifetimeSeconds(limits);
  const bucket = Math.floor(now / 1000 / bucketSeconds);
  const [today, thisMonth, spend, running] = await Promise.all([
    store.get(secondsKey(tenantId, utcDay(now))),
    store.get(secondsKey(tenantId, month)),
    store.get(spendKey(tenantId, month)),
    store.get(runKey(tenantId, bucketSeconds, bucket)),
  ]);
  return {
    minutesToday: parseCount(today) / 60,
    minutesThisMonth: parseCount(thisMonth) / 60,
    spendChfThisMonth: parseCount(spend) / 1e6,
    running: parseCount(running),
  };
}

/**
 * The thresholds of SPEND_ALERT_THRESHOLDS (percent of `budget`) that the change from `before` to
 * `after` crossed upwards, so the caller can send one alert per threshold. A reservation that is
 * later given back can cross the same line again: deduplicate the alert itself (for example with
 * seenBefore() on "<tenant>:<month>:<percent>").
 */
export function spendThresholdsCrossed(before: number, after: number, budget: number): number[] {
  if (!Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(budget) || budget <= 0) return [];
  return SPEND_ALERT_THRESHOLDS.filter((percent) => {
    const line = (budget * percent) / 100;
    return before < line && after >= line;
  });
}

/**
 * One caller turn of a session (text-turn mode). A refused turn still counts, so hammering a
 * spent session never frees it up. An id that is not a session id is refused.
 */
export async function admitTurn(args: {
  store: KVStore;
  sessionId: string;
  limits: Pick<VoiceLimits, "maxTurnsPerSession">;
  now?: number;
}): Promise<{ ok: true; remainingTurns: number } | { ok: false; code: "session_limit" }> {
  const { store, sessionId, limits } = args;
  if (!isSessionId(sessionId)) return { ok: false, code: "session_limit" };
  const max = allowance(limits.maxTurnsPerSession);
  const count = await store.incrBy(`mva:turn:${sessionId}`, 1, TURNS_TTL);
  if (count > max) return { ok: false, code: "session_limit" };
  return { ok: true, remainingTurns: Math.max(0, max - count) };
}

/**
 * A reservation read back from session state, checked field by field; null when anything is off.
 * Settlement trusts these numbers, so they must be ours.
 */
export function parseSessionReservation(value: unknown): SessionReservation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const mode = r.mode;
  if (mode !== "scripted" && mode !== "local" && mode !== "realtime") return null;
  if (!isTenantId(r.tenantId) || !isSessionId(r.sessionId)) return null;
  if (!isCount(r.reservedSeconds, VOICE_LIMIT_RANGES.maxCallSeconds.max)) return null;
  if (typeof r.costChfPerMinute !== "number" || !Number.isFinite(r.costChfPerMinute) || r.costChfPerMinute < 0) {
    return null;
  }
  if (!isCount(r.reservedMicroChf, Number.MAX_SAFE_INTEGER)) return null;
  if (typeof r.day !== "string" || !DAY_RE.test(r.day)) return null;
  if (typeof r.month !== "string" || !MONTH_RE.test(r.month) || !r.day.startsWith(r.month)) return null;
  const bucket = r.bucket === null ? null : isCount(r.bucket, Number.MAX_SAFE_INTEGER) ? r.bucket : undefined;
  if (bucket === undefined) return null;
  if (!isCount(r.bucketSeconds, Number.MAX_SAFE_INTEGER) || r.bucketSeconds < 1) return null;
  if (!isCount(r.at, Number.MAX_SAFE_INTEGER)) return null;
  return {
    tenantId: r.tenantId,
    sessionId: r.sessionId,
    mode,
    reservedSeconds: r.reservedSeconds,
    costChfPerMinute: r.costChfPerMinute,
    reservedMicroChf: r.reservedMicroChf,
    day: r.day,
    month: r.month,
    bucket,
    bucketSeconds: r.bucketSeconds,
    at: r.at,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Write = [key: string, by: number, ttlSeconds: number];

const IP_HASH_RE = /^[0-9a-f]{16,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// The conservative fallback when a caller passes a cost that is not a number: charge like the
// most expensive mode rather than nothing.
const FALLBACK_COST_CHF_PER_MINUTE = 0.25;

function runKey(tenantId: string, bucketSeconds: number, bucket: number): string {
  return `mva:run:${tenantId}:${bucketSeconds}:${bucket}`;
}

function secondsKey(tenantId: string, period: string): string {
  return `mva:sec:${tenantId}:${period}`;
}

function spendKey(tenantId: string, month: string): string {
  return `mva:chf:${tenantId}:${month}`;
}

/** All increments in one parallel round trip; zero increments still read the current value. */
function apply(store: KVStore, writes: Write[]): Promise<number[]> {
  return Promise.all(writes.map(([key, by, ttl]) => store.incrBy(key, by, ttl)));
}

/** Takes back increments made by apply(). Zero increments are skipped: nothing to undo. */
async function rollback(store: KVStore, writes: Write[]): Promise<void> {
  await Promise.all(writes.filter(([, by]) => by !== 0).map(([key, by, ttl]) => store.incrBy(key, -by, ttl)));
}

/** Micro-CHF of `seconds` at `chfPerMinute`, rounded up (never undercount). */
function microChf(seconds: number, chfPerMinute: number): number {
  return Math.ceil((seconds * Math.round(chfPerMinute * 1e6)) / 60);
}

/**
 * A limit that is not a usable number allows nothing: a broken configuration must stop sessions,
 * not let them through (NaN compares false with everything).
 */
function allowance(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** The worst-case length of one call, always within the sane range (never 0: that would be free). */
function callSeconds(value: number): number {
  const range = VOICE_LIMIT_RANGES.maxCallSeconds;
  const seconds = Number.isFinite(value) ? Math.ceil(value) : DEFAULT_VOICE_LIMITS.maxCallSeconds;
  return Math.min(range.max, Math.max(range.min, seconds));
}

function costPerMinute(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : FALLBACK_COST_CHF_PER_MINUTE;
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function parseCount(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
