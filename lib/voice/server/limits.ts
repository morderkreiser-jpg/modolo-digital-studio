// Admission and accounting of voice sessions: who may open a conversation, and what it is allowed
// to cost. Server-only. Everything works on the KVStore passed in (memory or Upstash, see
// lib/assistant/server/store.ts), which never throws and has no scan and no delete.
//
// A BRAKE, NOT AN INVOICE (decision D18). The minute and spend counters below exist to stop abuse
// and runaway costs. They run on UTC days and UTC months, the spend is an estimate that errs high,
// and a session is charged to the day it was admitted on. Minutes billed to a customer will be
// counted separately, on the calendar month of Zurich, when billing exists (phase 5).
//
// Stores. The per-IP windows live in the SHARED store (anyone can create them). Everything else
// here lives in the ACCOUNTING store (stores.ts): only admitted sessions and the counters write to
// it, so a flood of free keys can never push the counters out of a bounded memory store.
//
// Keys (all integers, so they can be incremented atomically in Redis):
//   mda:rl:mva:ip:<live|scripted>:<ip hash>:<3600|86400>:<window>
//                                    sessions per IP subject, ACROSS ALL TENANTS (hitWindow from the
//                                    chat guard, which adds its "mda:rl:" prefix)
//   mva:run:<tenant>:<B>:<bucket>    sessions registered as running in that time bucket
//   mva:sec:<tenant>:<YYYY-MM-DD>    conversation seconds today, reservations included (TTL 3 d)
//   mva:sec:<tenant>:<YYYY-MM>       conversation seconds this month (TTL 40 d)
//   mva:chf:<tenant>:<YYYY-MM>       estimated spend this month, micro-CHF (TTL 40 d)
//   mva:gsec:<YYYY-MM-DD>            conversation seconds today, EVERY tenant together (TTL 3 d)
//   mva:gchf:<YYYY-MM>               estimated spend this month, every tenant together (TTL 40 d)
//   mva:led:<session>:<sec|chf|run|turn>
//                                    the session's ledger: what it charged IN THIS STORE (TTL 1 d)
//   mva:settled:<tenant>:<session>   settlement marker, makes settlement idempotent (TTL 2 d)
//   mva:conf:<session>               a realtime call was confirmed and charged (TTL 1 d)
//   mva:turn:<session>               caller turns of one session (TTL 1 d)
//   mda:rl:mva:turnreq:<session>:<window>
//                                    turn requests of one session per short window, before the lock
//                                    (hitWindow again; written only with a valid session token)
//   mva:lock:<session>:<slot>        one turn at a time per session (see "Lock" below)
//   mva:cap:<session>:<kind>         per-session tool caps (tool calls, bookings, leads)
//
// Reservation, not after-the-fact counting. A conversation is admitted only after a reservation
// has been added to the day minutes, the month minutes and the month spend of its tenant AND of all
// tenants together, with atomic increments. Sessions opened at the same instant see each other:
// the increment that pushes a counter over its limit is taken back and that session is refused.
//
// What a minute is worth depends on the mode, and only what costs is held to a ceiling.
//   "local"    The browser speaks and listens for free; the model's tokens are the only cost, and
//              they are charged turn by turn: each turn reserves its worst case before the first
//              model call and settles it to the real cost after (reserveTurnSpend). Its minutes
//              are still counted, on a lease (below), but they never refuse a local session: a
//              script that keeps empty sessions alive would otherwise fill the day's minutes for
//              free (review finding S2-2). A ceiling of zero minutes still switches it off.
//   "realtime" The provider bills every connected minute. When the provider confirms calls
//              (RealtimeProvider.confirmsCalls: it reports when a call connects and how long it
//              lasted), admission charges NOTHING: it only checks that one whole call still fits.
//              The whole call is charged when the provider proves the call is live (its "started"
//              event or a tool call it signed: confirmRealtimeCall) and settled to the seconds the
//              provider reports at the end (settleReportedCall). A token that is never used costs
//              nothing, so ten unused sessions no longer fill a tenant's day (review finding S2-1).
//              Sessions admitted together may all connect: the ceilings can then be passed by at
//              most the calls running at once (maxConcurrentSessions), never by more.
//              Without such a provider, admission reserves the whole call, as nobody could tell an
//              unused token from a call, and the browser's end report gives no time back.
//
// Leases. A "local" session registers (and counts minutes) for SESSION_LEASE_SECONDS at
// admission, and every turn the model answers extends that to "time used so far + one lease"
// (extendSession). A session that never reports its end therefore runs on for at most one lease
// beyond its last sign of life. An unconfirmed realtime session is registered for one lease too.
//
// The ledger. Whatever a session charges is also written to its ledger keys, in the same store,
// AFTER the counters. Settlement first takes from the ledger, atomically, and gives back to the
// counters only what it could take there. During an Upstash outage the resilient store sends
// increments to per-instance memory; a session charged there finds an empty ledger once Upstash is
// back and gives nothing back to counters that never received its reservation. Every give-back is
// clamped at zero too: a counter never goes below zero.
//
// Concurrency without a key scan. Time is cut into buckets of B = RUN_BUCKET_SECONDS. A session
// registers itself in every bucket from now to the end of its lease (or, for a charged "realtime"
// call, of its whole life); "running now" is the counter of the current bucket. Admission checks the values
// its own increments returned, so two sessions racing for the last slot share a bucket and the
// later one sees the earlier: no read-then-write gap. Each turn extends the registration; the end
// report takes back the current and future buckets. A session that never reports its end stops
// counting at most a lease plus one bucket after its last sign of life: the slots free themselves.
//
// Lock. Turns of one session run one at a time, so the session state (its counters, the replay
// memory, the outcomes) is never loaded twice and saved over itself. A turn takes two lock slots
// of TURN_LOCK_SECONDS, its own and the next, with atomic increments; a second turn of the session
// that starts while the first runs meets one of them. A lock lost by a crashed function frees itself
// when its two slots have passed. Waiting for it costs one read per try, with the pause between
// tries doubling, and the turn route lets each session send only a few requests per window before
// it even looks at the lock: refused requests cannot multiply into store commands (review S2-4).
import type { KVStore } from "@/lib/assistant/server/store";
import {
  hashId,
  hitWindow,
  secondsUntilNextUtcDay,
  secondsUntilNextUtcMonth,
  utcDay,
  utcMonth,
} from "@/lib/assistant/server/guard";
import type { SessionCaps } from "@/lib/voice/tools/execute";
import { DEFAULT_VOICE_LIMITS, type VoiceLimits, type VoiceMode } from "@/lib/voice/types";
import { DEFAULT_VOICE_GLOBAL_LIMITS, VOICE_LIMIT_RANGES, type VoiceGlobalLimits } from "./env";
import { logVoiceEvent } from "./log";
import { isSessionId, isTenantId, newSessionId } from "./token";

const HOUR = 3600;
const DAY = 24 * HOUR;
const DAY_TTL = 3 * DAY;
const MONTH_TTL = 40 * DAY;
const SETTLED_TTL = 2 * DAY;
const TURNS_TTL = DAY;
const LEDGER_TTL = DAY;
// Buckets are read only while current; two hours outlive the longest registration (a 30-minute
// realtime call plus its grace).
const RUN_TTL = 2 * HOUR;

/**
 * Seconds a session may live beyond maxCallSeconds: the time between admission and the first
 * word (microphone permission, connecting to the provider) plus the end report. The session
 * token expires after sessionLifetimeSeconds().
 */
export const SESSION_GRACE_SECONDS = 60;
/**
 * What a "local" session reserves ahead of its last sign of life (the admission, then each turn).
 * It is also the most an abandoned local session keeps of the day's minutes after that moment.
 */
export const SESSION_LEASE_SECONDS = 60;
/** Length of a concurrency bucket. An abandoned session counts as running at most a lease plus this. */
export const RUN_BUCKET_SECONDS = 60;
/**
 * The least a live session that ended is charged. Without it a script could open and close
 * sessions for free, by the thousand, and fill the accounting store with their markers.
 */
export const MIN_CHARGED_SECONDS = 10;
/** Length of a lock slot. A turn holds two, so it is protected for at least this long. */
export const TURN_LOCK_SECONDS = 60;
/**
 * Scripted examples cost nothing, so their per-IP allowance is this many times the live one, on
 * separate counters: watching a few examples must not use up a visitor's real conversations.
 */
export const SCRIPTED_IP_LIMIT_FACTOR = 5;
/** Retry-After of a "busy" refusal: nobody knows when a slot frees up, so a short wait. */
export const BUSY_RETRY_AFTER_SECONDS = 30;
/**
 * Turn requests one session may send per TURN_REQUEST_WINDOW_SECONDS. The widget sends one turn
 * at a time, and after a barge-in or a "turn_in_progress" a few more; a script firing requests
 * in parallel is refused here, before each request could wait for the lock.
 */
export const TURN_REQUESTS_PER_WINDOW = 8;
export const TURN_REQUEST_WINDOW_SECONDS = 10;
/** The longest pause between two looks at a taken lock. */
export const LOCK_MAX_POLL_MS = 1_000;
/** Spend thresholds (percent of the monthly budget) reported by spendThresholdsCrossed(). */
export const SPEND_ALERT_THRESHOLDS = [50, 80, 100] as const;

/**
 * What admitSession() charged at admission. Plain JSON: it travels inside the session state, and
 * reservationFromClaims() rebuilds it when the state is gone. The AMOUNTS a settlement gives back
 * come from the session's ledger in the store, never from here: this is the session's identity
 * and its prices. `day` and `month` are the counters charged, so a session that ends after
 * midnight is still charged on the day it was admitted.
 */
export interface SessionReservation {
  tenantId: string;
  sessionId: string;
  mode: VoiceMode;
  /**
   * Seconds reserved at admission: one lease for "local", the whole call for "realtime" (0 when
   * its provider confirms calls: charged on confirmation), 0 for "scripted".
   */
  reservedSeconds: number;
  costChfPerMinute: number;
  /** Spend reserved at admission, micro-CHF. */
  reservedMicroChf: number;
  day: string;
  month: string;
  /** First concurrency bucket the session was registered in; null for "scripted". */
  bucket: number | null;
  /** B, the bucket length in seconds. */
  bucketSeconds: number;
  /** Unix ms of the admission. */
  at: number;
}

/** A month spend in CHF before and after one charge, for spendThresholdsCrossed(). */
export interface SpendStep {
  beforeChf: number;
  afterChf: number;
}

export type AdmissionResult =
  | {
      ok: true;
      reservation: SessionReservation;
      /** The tenant's month spend before and after this reservation (live modes only). */
      spend?: SpendStep;
      /** Everybody's month spend (all tenants together) before and after it (live modes only). */
      globalSpend?: SpendStep;
    }
  | { ok: false; code: "rate_limited" | "busy" | "budget_exhausted"; retryAfter?: number };

/** How long a session may last from admission to its end, in seconds (token expiry). */
export function sessionLifetimeSeconds(limits: Pick<VoiceLimits, "maxCallSeconds">): number {
  return callSeconds(limits.maxCallSeconds) + SESSION_GRACE_SECONDS;
}

/**
 * Decides whether a new conversation may start and, if so, reserves its first lease. Checks run
 * cheapest first and stop at the first refusal, so a refused session does not consume the later
 * quotas:
 *   1. sessions per IP per hour and per day, across all tenants (skipped when the IP is unknown)
 *   2. conversations running at the same time, per tenant
 *   3. minutes of the day and of the month, and the estimated spend of the month, of the tenant
 *      and of all tenants together: reserved in one round trip; any of them over its limit takes
 *      them all back. `spendHeadroomMicroChf` must also fit under both spend ceilings without being
 *      charged: a "local" session is admitted only when at least one turn can be paid for.
 *      A "local" session's minutes are counted but never refuse it (see the header); a realtime
 *      session whose provider confirms calls is charged nothing here, but one whole call of
 *      minutes and spend must still fit.
 * "scripted" costs nothing: it passes only its own per-IP limit and reserves nothing.
 * Like the chat guard, an attempt refused at gate 2 or 3 still counts against the per-IP windows:
 * hammering a busy or spent tenant never resets them.
 *
 * The reservation's sessionId is the session's id from here on (put it in the token's `sid`).
 */
export async function admitSession(args: {
  /** The accounting store (stores.ts). */
  store: KVStore;
  /** Where the per-IP windows live; defaults to `store`. */
  ipStore?: KVStore;
  tenantId: string;
  limits: VoiceLimits;
  global?: VoiceGlobalLimits;
  ipHash: string | null;
  mode: VoiceMode;
  costChfPerMinute: number;
  spendHeadroomMicroChf?: number;
  /**
   * "realtime" only: the provider reports when a call connects and how long it lasted
   * (RealtimeProvider.confirmsCalls), so nothing is charged before it does.
   */
  providerConfirmsCalls?: boolean;
  /** Defaults to (and, when it is not a session id, is replaced by) a new random id. */
  sessionId?: string;
  now?: number;
}): Promise<AdmissionResult> {
  const { store, tenantId, limits, ipHash, mode } = args;
  const ipStore = args.ipStore ?? store;
  const global = args.global ?? DEFAULT_VOICE_GLOBAL_LIMITS;
  const now = args.now ?? Date.now();
  const sessionId = isSessionId(args.sessionId) ? args.sessionId : newSessionId();
  const scripted = mode === "scripted";

  // 1. Per IP, whatever the tenant: a script must not get the allowance once per demo business.
  // A null IP means "unknown", never one shared bucket for everybody.
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
      const hit = await hitWindow(ipStore, `mva:ip:${kind}:${subject}:${seconds}`, limit, seconds, now);
      if (!hit.allowed) return { ok: false, code: "rate_limited", retryAfter: hit.retryAfter };
    }
  }

  const day = utcDay(now);
  const month = utcMonth(now);
  const bucketSeconds = RUN_BUCKET_SECONDS;
  const firstBucket = bucketOf(now, bucketSeconds);
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

  // A realtime call its provider will confirm is, until then, a token that may never be used.
  const unconfirmed = mode === "realtime" && args.providerConfirmsCalls === true;
  const wholeCall = callSeconds(limits.maxCallSeconds);

  // 2. Concurrency: every bucket of the registration, checked on the values its own increments
  // returned (see the header).
  const registeredSeconds = mode === "realtime" && !unconfirmed ? sessionLifetimeSeconds(limits) : leaseSeconds(limits);
  const registeredUntil = now + registeredSeconds * 1000;
  const lastBucket = bucketOf(registeredUntil, bucketSeconds);
  const running: Write[] = [];
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) running.push([runKey(tenantId, bucketSeconds, bucket), 1, RUN_TTL]);
  const counts = await apply(store, running);
  const maxRunning = allowance(limits.maxConcurrentSessions);
  if (counts.some((count) => count > maxRunning)) {
    await rollback(store, running);
    return { ok: false, code: "busy", retryAfter: BUSY_RETRY_AFTER_SECONDS };
  }

  // 3. Minutes and spend, the tenant's and everybody's: reserved together.
  const reservedSeconds = mode === "local" ? leaseSeconds(limits) : unconfirmed ? 0 : wholeCall;
  const costChfPerMinute = costPerMinute(args.costChfPerMinute);
  const reservedMicroChf = microChf(reservedSeconds, costChfPerMinute);
  // What must still fit without being charged now: an unconfirmed call's whole length and price,
  // and the first model turn the caller passes for a local session.
  const roomSeconds = unconfirmed ? wholeCall : 0;
  const roomMicro = toCount(args.spendHeadroomMicroChf ?? 0) + (unconfirmed ? microChf(wholeCall, costChfPerMinute) : 0);
  const budget: Write[] = [
    [secondsKey(tenantId, day), reservedSeconds, DAY_TTL],
    [secondsKey(tenantId, month), reservedSeconds, MONTH_TTL],
    [globalSecondsKey(day), reservedSeconds, DAY_TTL],
    [spendKey(tenantId, month), reservedMicroChf, MONTH_TTL],
    [globalSpendKey(month), reservedMicroChf, MONTH_TTL],
  ];
  const [secondsToday, secondsThisMonth, globalToday, spendMicro, globalSpend] = await apply(store, budget);
  // A local session's minutes cost nothing: only a ceiling of zero (switched off) refuses it.
  const minutesOver = (seconds: number, minutes: number): boolean =>
    mode === "local" ? allowance(minutes) === 0 : seconds + roomSeconds > allowance(minutes) * 60;
  const dayOver = minutesOver(secondsToday, limits.minutesPerDay) || minutesOver(globalToday, global.minutesPerDay);
  const monthOver = minutesOver(secondsThisMonth, limits.minutesPerMonth);
  const spendOver =
    spendMicro + roomMicro > microBudget(limits.budgetChfPerMonth) || globalSpend + roomMicro > microBudget(global.budgetChfPerMonth);
  if (dayOver || monthOver || spendOver) {
    await Promise.all([rollback(store, budget), rollback(store, running)]);
    // A spent month outlasts the day: waiting for tomorrow would not help.
    const retryAfter = monthOver || spendOver ? secondsUntilNextUtcMonth(now) : secondsUntilNextUtcDay(now);
    return { ok: false, code: "budget_exhausted", retryAfter };
  }

  // The ledger, after the counters (see the header): what this session charged in this store.
  const ledger: Write[] = [
    [ledgerKey(sessionId, "sec"), reservedSeconds, LEDGER_TTL],
    [ledgerKey(sessionId, "chf"), reservedMicroChf, LEDGER_TTL],
    // The last bucket registered, plus one (0 = nothing registered).
    [ledgerKey(sessionId, "run"), lastBucket + 1, LEDGER_TTL],
  ];
  await apply(store, ledger.filter(([, by]) => by !== 0));

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
      bucket: firstBucket,
      bucketSeconds,
      at: now,
    },
    spend: { beforeChf: (spendMicro - reservedMicroChf) / 1e6, afterChf: spendMicro / 1e6 },
    globalSpend: { beforeChf: (globalSpend - reservedMicroChf) / 1e6, afterChf: globalSpend / 1e6 },
  };
}

export type ExtensionResult =
  | { ok: true; reservedSeconds: number }
  | { ok: false; code: "budget_exhausted"; retryAfter: number };

/**
 * A sign of life of a "local" session (a turn the model answers): extends its minutes to the time
 * used so far plus one lease (at most the whole call) and its concurrency registration to the end
 * of that lease. The minutes never refuse it (see the header). Only a price per minute, should a
 * caller give local one, is held to the month's spend: when it has no room, the session may go on
 * as long as it still holds reserved time; once it has used that up, it is refused. Other modes
 * are not extended here: a realtime call is charged on the provider's word (confirmRealtimeCall).
 */
export async function extendSession(args: {
  store: KVStore;
  reservation: SessionReservation;
  limits: VoiceLimits;
  global?: VoiceGlobalLimits;
  now?: number;
}): Promise<ExtensionResult> {
  const { store, limits } = args;
  const r = parseSessionReservation(args.reservation);
  if (r === null) {
    logVoiceEvent({ warn: "extend_invalid_reservation" });
    return { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcDay(args.now ?? Date.now()) };
  }
  if (r.mode !== "local") return { ok: true, reservedSeconds: r.reservedSeconds };
  const global = args.global ?? DEFAULT_VOICE_GLOBAL_LIMITS;
  const now = args.now ?? Date.now();
  const elapsed = Math.max(0, Math.ceil((now - r.at) / 1000));
  const target = Math.min(callSeconds(limits.maxCallSeconds), elapsed + SESSION_LEASE_SECONDS);

  const [heldSeconds, heldMicro] = (
    await Promise.all([store.get(ledgerKey(r.sessionId, "sec")), store.get(ledgerKey(r.sessionId, "chf"))])
  ).map(parseCount);

  let reserved = heldSeconds;
  const addSeconds = target - heldSeconds;
  if (addSeconds > 0) {
    const addMicro = Math.max(0, microChf(target, r.costChfPerMinute) - heldMicro);
    const writes = chargeWrites(r, addSeconds, addMicro);
    const [, , , spendMicro, globalSpend] = await apply(store, writes);
    const spendOver = addMicro > 0 && (spendMicro > microBudget(limits.budgetChfPerMonth) || globalSpend > microBudget(global.budgetChfPerMonth));
    if (spendOver) {
      await rollback(store, writes);
      // Time already reserved is the session's own: it may still use it.
      if (heldSeconds > elapsed) return { ok: true, reservedSeconds: heldSeconds };
      return { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcMonth(now) };
    }
    await addToLedger(store, r, addSeconds, addMicro);
    reserved = target;
  }

  // The concurrency registration follows the lease. Registering never refuses: the session runs
  // already, and refusing it now would only cut a conversation off.
  await registerUntil(store, r, now + SESSION_LEASE_SECONDS * 1000, now);
  return { ok: true, reservedSeconds: reserved };
}

/**
 * Proof that a realtime call is connected: the provider's "started" event, or a tool call it
 * signed. Charges the session's whole call (minutes and spend, from its ledger: whatever it
 * already holds is not charged twice) and registers it as running until the end of its life.
 * Once per session. Never refuses: the provider bills a connected call whatever we decide, so the
 * counters may pass a ceiling here, and the next admissions are refused instead. A call the
 * provider already reported as ended (settleReportedCall) is not charged again.
 */
export async function confirmRealtimeCall(args: {
  store: KVStore;
  reservation: SessionReservation;
  limits: Pick<VoiceLimits, "maxCallSeconds">;
  now?: number;
}): Promise<SpendChange | null> {
  const { store, limits } = args;
  const r = parseSessionReservation(args.reservation);
  if (r === null || r.mode !== "realtime") return null;
  const now = args.now ?? Date.now();
  if (await isSettled(store, r)) return null;
  if ((await store.incrBy(confirmedKey(r.sessionId), 1, LEDGER_TTL)) !== 1) return null;
  const spend = await chargeUpTo(store, r, callSeconds(limits.maxCallSeconds));
  await registerUntil(store, r, r.at + sessionLifetimeSeconds(limits) * 1000, now);
  return spend;
}

/** The tenant's month spend before and after a charge (CHF), for spendThresholdsCrossed(). */
export interface SpendChange extends SpendStep {
  month: string;
  /** Everybody's month spend before and after the same charge. */
  globalSpend: SpendStep;
}

/**
 * The provider's own report of how long a realtime call was connected (its "ended" event). The
 * session is charged exactly that, whatever it held: the rest is given back, a call that was never
 * confirmed (a lost "started" event) is charged now. Its slot is freed. Once per session (the
 * marker it shares with settleSession), so a repeated report changes nothing. A report that is
 * not a number of seconds keeps everything charged and only frees the slot.
 */
export async function settleReportedCall(args: {
  store: KVStore;
  reservation: SessionReservation;
  reportedSeconds: number;
  limits: Pick<VoiceLimits, "maxCallSeconds">;
  now?: number;
}): Promise<SpendChange | null> {
  const { store, limits } = args;
  const r = parseSessionReservation(args.reservation);
  if (r === null || r.mode !== "realtime") {
    logVoiceEvent({ warn: "settle_invalid_reservation" });
    return null;
  }
  const now = args.now ?? Date.now();
  if (!(await firstSettlement(store, r))) return null;
  if (!Number.isFinite(args.reportedSeconds) || args.reportedSeconds < 0) {
    await release(store, r, Number.POSITIVE_INFINITY, now);
    return null;
  }
  // The provider cuts the call at maxSeconds: a longer report is noise, not minutes.
  const seconds = Math.min(Math.ceil(args.reportedSeconds), sessionLifetimeSeconds(limits));
  const spend = await chargeUpTo(store, r, seconds);
  await release(store, r, seconds, now);
  return spend;
}

/**
 * The end of a conversation: gives back the reserved time the session did not use, and the spend
 * of that time, and frees its concurrency slot. Idempotent per session id: a second settle of the
 * same session changes nothing, so a retried or duplicated end report cannot give minutes back
 * twice.
 *   "local"    is charged the seconds it really lasted (at least MIN_CHARGED_SECONDS), never more
 *              than its ledger holds. `usedSeconds` that is not a finite number charges everything:
 *              when in doubt, never undercount.
 *   "realtime" keeps what it was charged: the provider bills the call whatever the browser
 *              reports, and the end report comes from the browser. Only the slot is freed, and no
 *              settlement marker is set, so the provider's own report (settleReportedCall) can
 *              still settle the minutes to the seconds it billed. An unconfirmed call was charged
 *              nothing, so it keeps nothing.
 * A reservation that does not look like one of ours is ignored (and logged).
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
  if (r.mode === "scripted") return;
  if (r.mode === "realtime") {
    await release(store, r, Number.POSITIVE_INFINITY, now);
    return;
  }
  if (!(await firstSettlement(store, r))) return;
  const keep = Number.isFinite(usedSeconds) ? Math.max(MIN_CHARGED_SECONDS, Math.ceil(usedSeconds)) : Number.POSITIVE_INFINITY;
  await release(store, r, keep, now);
}

/**
 * Takes back a whole admission that never turned into a conversation (the provider did not open,
 * the state could not be stored): everything it charged is given back. Idempotent like
 * settleSession(), with which it shares the marker.
 */
export async function cancelReservation(store: KVStore, reservation: SessionReservation, now: number = Date.now()): Promise<void> {
  const r = parseSessionReservation(reservation);
  if (r === null) {
    logVoiceEvent({ warn: "settle_invalid_reservation" });
    return;
  }
  if (r.mode === "scripted") return;
  if (!(await firstSettlement(store, r))) return;
  await release(store, r, 0, now);
}

/**
 * Rebuilds a session's reservation from its token when the session state is gone (expired,
 * evicted, or on another instance with the memory store): the ledger in the store holds the
 * amounts, so settlement still frees the slot and gives back exactly what this store holds.
 */
export function reservationFromClaims(
  claims: { tid: string; sid: string; mode: VoiceMode; iat: number },
  costChfPerMinute: number,
): SessionReservation | null {
  const at = claims.iat * 1000;
  return parseSessionReservation({
    tenantId: claims.tid,
    sessionId: claims.sid,
    mode: claims.mode,
    reservedSeconds: 0,
    costChfPerMinute: claims.mode === "scripted" ? 0 : costPerMinute(costChfPerMinute),
    reservedMicroChf: 0,
    day: utcDay(at),
    month: utcMonth(at),
    bucket: claims.mode === "scripted" ? null : bucketOf(at, RUN_BUCKET_SECONDS),
    bucketSeconds: RUN_BUCKET_SECONDS,
    at,
  });
}

// ---------------------------------------------------------------------------------------------
// The model's spend, per turn
// ---------------------------------------------------------------------------------------------

/** What reserveTurnSpend() charged, to be settled with settleTurnSpend() after the turn. */
export interface TurnSpendReservation {
  tenantId: string;
  sessionId: string;
  month: string;
  /** Micro-CHF reserved: the turn's worst case. */
  micro: number;
}

/**
 * Reserves the worst case of one turn's model calls (micro-CHF) on the tenant's and everybody's
 * month spend before the model is called. Over either budget, it is taken back and the turn is
 * refused: this is what stops the spend once the ceiling is reached, whatever a script does.
 */
export async function reserveTurnSpend(args: {
  store: KVStore;
  tenantId: string;
  sessionId: string;
  limits: Pick<VoiceLimits, "budgetChfPerMonth">;
  global?: VoiceGlobalLimits;
  micro: number;
  now?: number;
}): Promise<
  | { ok: true; reservation: TurnSpendReservation; spend: SpendStep; globalSpend: SpendStep }
  | { ok: false; code: "budget_exhausted"; retryAfter: number }
> {
  const { store, tenantId, sessionId, limits } = args;
  const global = args.global ?? DEFAULT_VOICE_GLOBAL_LIMITS;
  const now = args.now ?? Date.now();
  const month = utcMonth(now);
  const micro = toCount(args.micro);
  const writes: Write[] = [
    [spendKey(tenantId, month), micro, MONTH_TTL],
    [globalSpendKey(month), micro, MONTH_TTL],
  ];
  const [tenantSpend, globalSpend] = await apply(store, writes);
  if (tenantSpend > microBudget(limits.budgetChfPerMonth) || globalSpend > microBudget(global.budgetChfPerMonth)) {
    await rollback(store, writes);
    return { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcMonth(now) };
  }
  if (micro > 0) await store.incrBy(ledgerKey(sessionId, "turn"), micro, LEDGER_TTL);
  return {
    ok: true,
    reservation: { tenantId, sessionId, month, micro },
    spend: { beforeChf: (tenantSpend - micro) / 1e6, afterChf: tenantSpend / 1e6 },
    globalSpend: { beforeChf: (globalSpend - micro) / 1e6, afterChf: globalSpend / 1e6 },
  };
}

/**
 * Corrects a turn's reservation to what its model calls really cost (`actualMicro`). What is
 * given back is first taken from the session's ledger in this store, so a reservation that landed
 * elsewhere is never returned here; a turn that cost more than reserved is charged the difference.
 * Never throws.
 */
export async function settleTurnSpend(store: KVStore, reservation: TurnSpendReservation, actualMicro: number): Promise<void> {
  try {
    const actual = toCount(actualMicro);
    const taken = await take(store, ledgerKey(reservation.sessionId, "turn"), reservation.micro, LEDGER_TTL);
    const delta = actual - taken;
    const keys: Array<[string, number]> = [
      [spendKey(reservation.tenantId, reservation.month), MONTH_TTL],
      [globalSpendKey(reservation.month), MONTH_TTL],
    ];
    if (delta > 0) await Promise.all(keys.map(([key, ttl]) => store.incrBy(key, delta, ttl)));
    else if (delta < 0) await Promise.all(keys.map(([key, ttl]) => giveBack(store, key, -delta, ttl)));
  } catch {
    // Settling is best effort; an unsettled reservation stays charged in full, the safe direction.
  }
}

/** Whole micro-CHF of a model cost in USD at `chfPerUsd`, rounded up (never undercount). */
export function usdToMicroChf(costUsd: number, chfPerUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  const rate = Number.isFinite(chfPerUsd) && chfPerUsd > 0 ? chfPerUsd : 1;
  // Rounded to whole nano-CHF first, so float noise does not add a phantom micro-franc.
  return Math.ceil(Math.round(costUsd * rate * 1e9) / 1e3);
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/**
 * The counters of one tenant. Minutes and spend include the reservations of running sessions.
 * (It took the tenant's limits once, to find the concurrency buckets; their length no longer
 * depends on them.)
 */
export async function usageSnapshot(
  store: KVStore,
  tenantId: string,
  now: number = Date.now(),
): Promise<{ minutesToday: number; minutesThisMonth: number; spendChfThisMonth: number; running: number }> {
  const month = utcMonth(now);
  const [today, thisMonth, spend, running] = await Promise.all([
    store.get(secondsKey(tenantId, utcDay(now))),
    store.get(secondsKey(tenantId, month)),
    store.get(spendKey(tenantId, month)),
    store.get(runKey(tenantId, RUN_BUCKET_SECONDS, bucketOf(now, RUN_BUCKET_SECONDS))),
  ]);
  return {
    minutesToday: parseCount(today) / 60,
    minutesThisMonth: parseCount(thisMonth) / 60,
    spendChfThisMonth: parseCount(spend) / 1e6,
    running: parseCount(running),
  };
}

/** The counters of all tenants together. */
export async function globalUsageSnapshot(
  store: KVStore,
  now: number = Date.now(),
): Promise<{ minutesToday: number; spendChfThisMonth: number }> {
  const [today, spend] = await Promise.all([store.get(globalSecondsKey(utcDay(now))), store.get(globalSpendKey(utcMonth(now)))]);
  return { minutesToday: parseCount(today) / 60, spendChfThisMonth: parseCount(spend) / 1e6 };
}

/**
 * The month spend (CHF) of one tenant and of all tenants together, two reads: for the alert of a
 * charge the ceiling refused (alerts.ts, reportCeilingRefusal).
 */
export async function monthSpendChf(
  store: KVStore,
  tenantId: string,
  now: number = Date.now(),
): Promise<{ month: string; tenantChf: number; globalChf: number }> {
  const month = utcMonth(now);
  const [tenant, global] = await Promise.all([store.get(spendKey(tenantId, month)), store.get(globalSpendKey(month))]);
  return { month, tenantChf: parseCount(tenant) / 1e6, globalChf: parseCount(global) / 1e6 };
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

// ---------------------------------------------------------------------------------------------
// Turns, the lock, the caps
// ---------------------------------------------------------------------------------------------

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
 * The per-session gate in front of the lock (see the header): at most TURN_REQUESTS_PER_WINDOW
 * turn requests per TURN_REQUEST_WINDOW_SECONDS. One increment per request. An id that is not a
 * session id is refused without touching the store.
 */
export async function admitTurnRequest(
  store: KVStore,
  sessionId: string,
  now: number = Date.now(),
): Promise<{ ok: true } | { ok: false; code: "rate_limited"; retryAfter: number }> {
  if (!isSessionId(sessionId)) return { ok: false, code: "rate_limited", retryAfter: TURN_REQUEST_WINDOW_SECONDS };
  const hit = await hitWindow(store, `mva:turnreq:${sessionId}`, TURN_REQUESTS_PER_WINDOW, TURN_REQUEST_WINDOW_SECONDS, now);
  return hit.allowed ? { ok: true } : { ok: false, code: "rate_limited", retryAfter: hit.retryAfter };
}

export interface SessionLock {
  /** Frees the lock. Safe to call more than once. Never throws. */
  release(): Promise<void>;
}

/**
 * Takes the session's lock (see the header), waiting up to `waitMs` for a turn that is still
 * finishing (a caller who barged in sends the next turn while the aborted one saves its state).
 * null when it stays taken. While it is taken, each try is a single read, and the pause between
 * tries doubles from `pollMs` up to LOCK_MAX_POLL_MS. `clock` decides the slot, so tests can move
 * time.
 */
export async function acquireSessionLock(
  store: KVStore,
  sessionId: string,
  options: { clock?: () => number; waitMs?: number; pollMs?: number } = {},
): Promise<SessionLock | null> {
  if (!isSessionId(sessionId)) return null;
  const clock = options.clock ?? Date.now;
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs as number) : 0;
  let pause = Number.isFinite(options.pollMs) ? Math.max(5, options.pollMs as number) : 100;
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    const slot = Math.floor(clock() / 1000 / TURN_LOCK_SECONDS);
    const keys = [lockKey(sessionId, slot), lockKey(sessionId, slot + 1)];
    // A look before the increments: a holder of this slot is seen with one read, instead of an
    // increment and its give-back (on Upstash, four commands).
    if (parseCount(await store.get(keys[0])) === 0) {
      // One after the other: a racing turn that took the first slot is seen before the second is
      // touched, which keeps the both-refused case rare.
      const first = await store.incrBy(keys[0], 1, LOCK_TTL);
      if (first === 1) {
        const second = await store.incrBy(keys[1], 1, LOCK_TTL);
        if (second === 1) {
          let released = false;
          return {
            async release() {
              if (released) return;
              released = true;
              try {
                await Promise.all(keys.map((key) => giveBack(store, key, 1, LOCK_TTL)));
              } catch {
                // The slots expire by themselves.
              }
            },
          };
        }
        await giveBack(store, keys[1], 1, LOCK_TTL);
      }
      await giveBack(store, keys[0], 1, LOCK_TTL);
    }
    if (Date.now() + pause > giveUpAt) return null;
    await sleep(pause);
    pause = Math.min(pause * 2, LOCK_MAX_POLL_MS);
  }
}

/**
 * Per-session tool caps as atomic store counters, for executeTool (ToolContext.caps): parallel
 * requests of one session can never pass more actions than the caps allow, whatever their state
 * copies say.
 */
export function createSessionCaps(store: KVStore, sessionId: string, ttlSeconds: number): SessionCaps {
  const key = (kind: string): string => `mva:cap:${sessionId}:${kind}`;
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DAY;
  return {
    async take(kind, max) {
      const count = await store.incrBy(key(kind), 1, ttl);
      if (count <= allowance(max)) return true;
      await giveBack(store, key(kind), 1, ttl);
      return false;
    },
    async giveBack(kind) {
      await giveBack(store, key(kind), 1, ttl);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

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
const LOCK_TTL = 3 * TURN_LOCK_SECONDS;
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

function globalSecondsKey(day: string): string {
  return `mva:gsec:${day}`;
}

function globalSpendKey(month: string): string {
  return `mva:gchf:${month}`;
}

function ledgerKey(sessionId: string, part: "sec" | "chf" | "run" | "turn"): string {
  return `mva:led:${sessionId}:${part}`;
}

function lockKey(sessionId: string, slot: number): string {
  return `mva:lock:${sessionId}:${slot}`;
}

function bucketOf(ms: number, bucketSeconds: number): number {
  return Math.floor(ms / 1000 / bucketSeconds);
}

function confirmedKey(sessionId: string): string {
  return `mva:conf:${sessionId}`;
}

function settledKey(r: SessionReservation): string {
  return `mva:settled:${r.tenantId}:${r.sessionId}`;
}

/** True for the first settlement of this session (the marker makes every later one a no-op). */
async function firstSettlement(store: KVStore, r: SessionReservation): Promise<boolean> {
  return (await store.incrBy(settledKey(r), 1, SETTLED_TTL)) === 1;
}

async function isSettled(store: KVStore, r: SessionReservation): Promise<boolean> {
  return parseCount(await store.get(settledKey(r))) > 0;
}

/** The increments that add minutes and spend to a session's tenant and to everybody's counters. */
function chargeWrites(r: SessionReservation, seconds: number, micro: number): Write[] {
  return [
    [secondsKey(r.tenantId, r.day), seconds, DAY_TTL],
    [secondsKey(r.tenantId, r.month), seconds, MONTH_TTL],
    [globalSecondsKey(r.day), seconds, DAY_TTL],
    [spendKey(r.tenantId, r.month), micro, MONTH_TTL],
    [globalSpendKey(r.month), micro, MONTH_TTL],
  ];
}

/** Records in the session's ledger what it was just charged (after the counters: see the header). */
async function addToLedger(store: KVStore, r: SessionReservation, seconds: number, micro: number): Promise<void> {
  const ledger: Write[] = [
    [ledgerKey(r.sessionId, "sec"), seconds, LEDGER_TTL],
    [ledgerKey(r.sessionId, "chf"), micro, LEDGER_TTL],
  ];
  await apply(store, ledger.filter(([, by]) => by > 0));
}

/**
 * Charges the session up to `seconds` in all (and their price), counting what its ledger already
 * holds, with no ceiling: for a call the provider says is live or was live, which it bills anyway.
 * The tenant's month spend before and after, when anything was charged.
 */
async function chargeUpTo(store: KVStore, r: SessionReservation, seconds: number): Promise<SpendChange | null> {
  const [heldSeconds, heldMicro] = (
    await Promise.all([store.get(ledgerKey(r.sessionId, "sec")), store.get(ledgerKey(r.sessionId, "chf"))])
  ).map(parseCount);
  const addSeconds = toCount(seconds - heldSeconds);
  if (addSeconds === 0) return null;
  const addMicro = Math.max(0, microChf(heldSeconds + addSeconds, r.costChfPerMinute) - heldMicro);
  const [, , , spendMicro, globalMicro] = await apply(store, chargeWrites(r, addSeconds, addMicro));
  await addToLedger(store, r, addSeconds, addMicro);
  return {
    month: r.month,
    beforeChf: (spendMicro - addMicro) / 1e6,
    afterChf: spendMicro / 1e6,
    globalSpend: { beforeChf: (globalMicro - addMicro) / 1e6, afterChf: globalMicro / 1e6 },
  };
}

/**
 * Registers the session as running in every bucket up to the one of `until` that it is not
 * registered in yet (from the current bucket on: past buckets no longer count). Never refuses.
 */
async function registerUntil(store: KVStore, r: SessionReservation, until: number, now: number): Promise<void> {
  const runMark = parseCount(await store.get(ledgerKey(r.sessionId, "run")));
  const lastRegistered = runMark - 1;
  const newLast = bucketOf(until, r.bucketSeconds);
  if (newLast <= lastRegistered) return;
  const from = Math.max(lastRegistered + 1, bucketOf(now, r.bucketSeconds));
  const writes: Write[] = [];
  for (let bucket = from; bucket <= newLast; bucket += 1) writes.push([runKey(r.tenantId, r.bucketSeconds, bucket), 1, RUN_TTL]);
  await apply(store, writes);
  await store.incrBy(ledgerKey(r.sessionId, "run"), newLast - lastRegistered, LEDGER_TTL);
}

/**
 * Gives back what the session holds beyond `keepSeconds` (Infinity keeps everything), taken from
 * its ledger first, and frees its current and future concurrency buckets.
 */
async function release(store: KVStore, r: SessionReservation, keepSeconds: number, now: number): Promise<void> {
  const [heldSeconds, heldMicro, runMark] = (
    await Promise.all([
      store.get(ledgerKey(r.sessionId, "sec")),
      store.get(ledgerKey(r.sessionId, "chf")),
      store.get(ledgerKey(r.sessionId, "run")),
    ])
  ).map(parseCount);

  const work: Array<Promise<unknown>> = [];
  if (Number.isFinite(keepSeconds)) {
    const keptSeconds = Math.min(heldSeconds, Math.max(0, keepSeconds));
    const keptMicro = Math.min(heldMicro, microChf(keptSeconds, r.costChfPerMinute));
    work.push(
      (async () => {
        const seconds = await take(store, ledgerKey(r.sessionId, "sec"), heldSeconds - keptSeconds, LEDGER_TTL);
        if (seconds > 0) {
          await Promise.all([
            giveBack(store, secondsKey(r.tenantId, r.day), seconds, DAY_TTL),
            giveBack(store, secondsKey(r.tenantId, r.month), seconds, MONTH_TTL),
            giveBack(store, globalSecondsKey(r.day), seconds, DAY_TTL),
          ]);
        }
      })(),
      (async () => {
        const micro = await take(store, ledgerKey(r.sessionId, "chf"), heldMicro - keptMicro, LEDGER_TTL);
        if (micro > 0) {
          await Promise.all([
            giveBack(store, spendKey(r.tenantId, r.month), micro, MONTH_TTL),
            giveBack(store, globalSpendKey(r.month), micro, MONTH_TTL),
          ]);
        }
      })(),
    );
  }

  // Buckets already in the past no longer count anyway: decrementing would only recreate them.
  const lastRegistered = runMark - 1;
  const current = bucketOf(now, r.bucketSeconds);
  if (lastRegistered >= current) {
    work.push(
      (async () => {
        const writes: Array<Promise<void>> = [];
        for (let bucket = current; bucket <= lastRegistered; bucket += 1) {
          writes.push(giveBack(store, runKey(r.tenantId, r.bucketSeconds, bucket), 1, RUN_TTL));
        }
        await Promise.all(writes);
        await take(store, ledgerKey(r.sessionId, "run"), runMark, LEDGER_TTL);
      })(),
    );
  }
  await Promise.all(work);
}

/** All increments in one parallel round trip. */
function apply(store: KVStore, writes: Write[]): Promise<number[]> {
  return Promise.all(writes.map(([key, by, ttl]) => store.incrBy(key, by, ttl)));
}

/** Takes back increments made by apply(). Zero increments are skipped: nothing to undo. */
async function rollback(store: KVStore, writes: Write[]): Promise<void> {
  await Promise.all(writes.filter(([, by]) => by > 0).map(([key, by, ttl]) => giveBack(store, key, by, ttl)));
}

/** Decrements a counter by `amount`, but never below zero (see the header). */
async function giveBack(store: KVStore, key: string, amount: number, ttl: number): Promise<void> {
  const by = toCount(amount);
  if (by === 0) return;
  const left = await store.incrBy(key, -by, ttl);
  if (left < 0) await store.incrBy(key, -left, ttl);
}

/**
 * Takes up to `amount` from a ledger counter, atomically, and returns what was really there to
 * take (0 when the ledger never reached this store).
 */
async function take(store: KVStore, key: string, amount: number, ttl: number): Promise<number> {
  const by = toCount(amount);
  if (by === 0) return 0;
  const left = await store.incrBy(key, -by, ttl);
  if (left >= 0) return by;
  await store.incrBy(key, -left, ttl);
  return Math.max(0, by + left);
}

/** Micro-CHF of `seconds` at `chfPerMinute`, rounded up (never undercount). */
function microChf(seconds: number, chfPerMinute: number): number {
  return Math.ceil((seconds * Math.round(chfPerMinute * 1e6)) / 60);
}

function microBudget(chf: number): number {
  return Math.floor(allowance(chf) * 1e6);
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

function leaseSeconds(limits: Pick<VoiceLimits, "maxCallSeconds">): number {
  return Math.min(callSeconds(limits.maxCallSeconds), SESSION_LEASE_SECONDS);
}

function costPerMinute(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : FALLBACK_COST_CHF_PER_MINUTE;
}

function toCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function parseCount(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
