// Spend accounting and structured logs of the assistant. Server-only.
//
// Counters per tenant (all integers, so they can be incremented atomically in Redis):
//   mda:cost:<tenant>:<YYYY-MM-DD>   estimated spend today, micro-USD        (TTL 3 days)
//   mda:cost:<tenant>:<YYYY-MM>      estimated spend this month, micro-USD   (TTL 40 days)
//   mda:tok:in|out:<tenant>:<day>    uncached input / output tokens today    (TTL 3 days)
//   mda:req:<tenant>:<day>           chat requests today (written by guard.ts)
//
// Spend is reserved before a reply and settled after it: reserveSpend() adds the request's worst
// case to the cost counters at the gate, atomically, so replies running at the same time see each
// other and can never overshoot the budget together; settleSpend() then corrects the counters to
// what the reply really cost. The cost counters therefore include the replies still in flight.
import type { AssistantLimits } from "@/lib/assistant/types";
import type { KVStore } from "./store";
import type { UsageTokens } from "./costs";
import { secondsUntilNextUtcDay, secondsUntilNextUtcMonth, utcDay, utcMonth } from "./guard";

const DAY_TTL = 3 * 86_400;
const MONTH_TTL = 40 * 86_400;

/** Spend charged by reserveSpend(), to be settled with settleSpend() once the reply has ended. */
export interface SpendReservation {
  /**
   * The cost counters that were charged. The settlement corrects exactly these, so a reply that
   * ends after UTC midnight still lands on the day (and month) it was admitted on.
   */
  dayKey: string;
  monthKey: string;
  /** Micro-USD reserved: the request's worst case. */
  micro: number;
  /** When the reservation was made; the reply's tokens are counted on that same day. */
  at: number;
}

export type SpendGate =
  | { ok: true; reservation: SpendReservation }
  | { ok: false; code: "budget_exhausted"; retryAfter: number };

/**
 * Reserves `micro` (the worst-case cost of a request, micro-USD) on today's and this month's spend
 * counters before the request runs. Each increment is atomic, so the new totals already include
 * every reservation made before; when either is over its budget, the reservation is taken back and
 * the request refused.
 */
export async function reserveSpend(args: {
  store: KVStore;
  tenantId: string;
  limits: Pick<AssistantLimits, "tenantBudgetUsdPerDay" | "tenantBudgetUsdPerMonth">;
  micro: number;
  now?: number;
}): Promise<SpendGate> {
  const { store, tenantId, limits } = args;
  const now = args.now ?? Date.now();
  const micro = toCount(args.micro);
  const dayKey = `mda:cost:${tenantId}:${utcDay(now)}`;
  const monthKey = `mda:cost:${tenantId}:${utcMonth(now)}`;

  const [spentToday, spentThisMonth] = await Promise.all([
    store.incrBy(dayKey, micro, DAY_TTL),
    store.incrBy(monthKey, micro, MONTH_TTL),
  ]);
  const overMonth = spentThisMonth > limits.tenantBudgetUsdPerMonth * 1e6;
  if (overMonth || spentToday > limits.tenantBudgetUsdPerDay * 1e6) {
    await Promise.all([store.incrBy(dayKey, -micro, DAY_TTL), store.incrBy(monthKey, -micro, MONTH_TTL)]);
    // Same Retry-After as guard.ts: a spent month outlasts the day, so tomorrow would not help.
    const retryAfter = overMonth ? secondsUntilNextUtcMonth(now) : secondsUntilNextUtcDay(now);
    return { ok: false, code: "budget_exhausted", retryAfter };
  }
  return { ok: true, reservation: { dayKey, monthKey, micro, at: now } };
}

/**
 * Corrects a reservation to what the reply really cost (`actualMicro`): its usage, the provider's
 * input-only estimate for a call cut off before the API answered, or 0 when the API was never
 * reached or answered with an error. The difference is signed; usually it gives most of the
 * reservation back, because few replies use their whole output allowance.
 */
export async function settleSpend(store: KVStore, reservation: SpendReservation, actualMicro: number): Promise<void> {
  const delta = toCount(actualMicro) - reservation.micro;
  if (delta === 0) return;
  await Promise.all([
    store.incrBy(reservation.dayKey, delta, DAY_TTL),
    store.incrBy(reservation.monthKey, delta, MONTH_TTL),
  ]);
}

/** Counts a reply's uncached input and output tokens on the day of `now` (for the usage summary). */
export async function recordTokens(args: {
  store: KVStore;
  tenantId: string;
  usage: UsageTokens;
  now?: number;
}): Promise<void> {
  const { store, tenantId, usage } = args;
  const day = utcDay(args.now ?? Date.now());
  const input = toCount(usage.inputTokens);
  const output = toCount(usage.outputTokens);

  // Zero increments are skipped: they would only cost a round trip to the store.
  const writes: Array<Promise<number>> = [];
  if (input > 0) writes.push(store.incrBy(`mda:tok:in:${tenantId}:${day}`, input, DAY_TTL));
  if (output > 0) writes.push(store.incrBy(`mda:tok:out:${tenantId}:${day}`, output, DAY_TTL));
  await Promise.all(writes);
}

/** The counters read back. The spend includes the reservations of replies still in flight. */
export async function getUsageSummary(
  store: KVStore,
  tenantId: string,
  now: number = Date.now(),
): Promise<{
  day: string;
  month: string;
  requestsToday: number;
  costTodayUsd: number;
  costMonthUsd: number;
  inputTokensToday: number;
  outputTokensToday: number;
  store: "memory" | "upstash";
}> {
  const day = utcDay(now);
  const month = utcMonth(now);
  const [requests, costToday, costMonth, inputTokens, outputTokens] = await Promise.all([
    store.get(`mda:req:${tenantId}:${day}`),
    store.get(`mda:cost:${tenantId}:${day}`),
    store.get(`mda:cost:${tenantId}:${month}`),
    store.get(`mda:tok:in:${tenantId}:${day}`),
    store.get(`mda:tok:out:${tenantId}:${day}`),
  ]);
  return {
    day,
    month,
    requestsToday: parseCount(requests),
    costTodayUsd: parseCount(costToday) / 1e6,
    costMonthUsd: parseCount(costMonth) / 1e6,
    inputTokensToday: parseCount(inputTokens),
    outputTokensToday: parseCount(outputTokens),
    store: store.kind,
  };
}

/**
 * One JSON line per event on stdout (Vercel keeps it with the function logs). Callers pass ids,
 * counts, timings and costs only: never message content, names, emails, phones or raw IPs.
 */
export function logEvent(event: Record<string, string | number | boolean | null | undefined>): void {
  console.log(JSON.stringify({ evt: "assistant", ts: new Date().toISOString(), ...event }));
}

/**
 * USD → whole micro-USD for the integer counters, rounded up. Rounded to whole nano-USD first, so
 * binary float noise (300.00000000000006) does not add a phantom micro-dollar to every request.
 */
export function toMicroUsd(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.ceil(Math.round(costUsd * 1e9) / 1e3);
}

function toCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function parseCount(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
