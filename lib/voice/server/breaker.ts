// Circuit breaker per tenant and voice provider. Server-only.
//
// When a provider fails, every visitor who presses "talk" would otherwise retry it, and every
// retry costs a slow timeout on our side and load on theirs: an outage turns into a retry storm.
// The breaker stops that: after BREAKER_FAILURE_THRESHOLD failures inside BREAKER_WINDOW_SECONDS it
// OPENS and the provider is not called for BREAKER_OPEN_SECONDS. Then it is HALF-OPEN: traffic
// goes through again, the next failure reopens it at once, a success closes it. Half-open ends by
// itself after BREAKER_HALF_OPEN_MAX_SECONDS without any call.
//
// No timers, no background work: the state lives in store counters and is computed from `now`
// on every call, so it is shared by every instance (with Upstash) and tests can move time freely.
//   mva:brk:<tenant>:<provider>:f:<slot>              failures in a 10-second slot (TTL 2 min)
//   mva:brk:<tenant>:<provider>:gen:<epoch>           generation counter of a UTC day, +1 on every
//                                                     trip and every close
//   mva:brk:<tenant>:<provider>:trip:<epoch>:<gen>    unix second the breaker opened then
// The latest generation decides the state: no trip time → closed; trip time less than OPEN
// seconds ago → open; then half-open, then closed. A success in half-open starts a new generation
// that has no trip time, i.e. closes the breaker, without a delete (the store has none).
//
// Why per day: an increment keeps the key's first TTL, so one long-lived generation counter
// expired a fixed time after its first trip, possibly while the breaker was open, which read as
// "closed" and let a retry storm through (review finding correttezza/F10). A day's counter is
// read on that day and the next (a whole open and half-open cycle lasts minutes) and lives three.
//
// The failure window is counted in 10-second slots: the current slot and the six before it, so
// "inside 60 seconds" means inside the last 60 to 70 seconds. The breaker errs towards opening.
import type { KVStore } from "@/lib/assistant/server/store";

export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_WINDOW_SECONDS = 60;
export const BREAKER_OPEN_SECONDS = 120;
export const BREAKER_HALF_OPEN_MAX_SECONDS = 600;

export type BreakerState = "closed" | "open" | "half_open";

const SLOT_SECONDS = 10;
const SLOTS = BREAKER_WINDOW_SECONDS / SLOT_SECONDS + 1;
const FAILURE_TTL = 2 * BREAKER_WINDOW_SECONDS;
const EPOCH_SECONDS = 86_400;
const GENERATION_TTL = 3 * EPOCH_SECONDS;
const TRIP_TTL = BREAKER_OPEN_SECONDS + BREAKER_HALF_OPEN_MAX_SECONDS + 60;

/** The breaker's state now. */
export async function breakerState(
  store: KVStore,
  tenantId: string,
  providerId: string,
  now: number = Date.now(),
): Promise<BreakerState> {
  const nowSeconds = toSeconds(now);
  const trippedAt = await lastTrip(store, prefix(tenantId, providerId), nowSeconds);
  return stateAt(trippedAt, nowSeconds);
}

/** True while the provider must not be called (open). Half-open lets traffic through. */
export async function isOpen(
  store: KVStore,
  tenantId: string,
  providerId: string,
  now: number = Date.now(),
): Promise<boolean> {
  return (await breakerState(store, tenantId, providerId, now)) === "open";
}

/**
 * Records one failed provider call (an error answer or a timeout, never a refusal of ours).
 * Returns true when THIS failure opened the breaker, so the caller can log it once.
 */
export async function recordFailure(
  store: KVStore,
  tenantId: string,
  providerId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const key = prefix(tenantId, providerId);
  const nowSeconds = toSeconds(now);
  const state = stateAt(await lastTrip(store, key, nowSeconds), nowSeconds);
  // Calls that started before the trip and fail now change nothing: it is already open.
  if (state === "open") return false;
  if (state === "half_open") {
    await trip(store, key, nowSeconds);
    return true;
  }

  const slot = Math.floor(nowSeconds / SLOT_SECONDS);
  let failures = await store.incrBy(`${key}:f:${slot}`, 1, FAILURE_TTL);
  if (failures < BREAKER_FAILURE_THRESHOLD) {
    const earlier = await Promise.all(
      Array.from({ length: SLOTS - 1 }, (_, index) => store.get(`${key}:f:${slot - index - 1}`)),
    );
    failures += earlier.reduce((sum, value) => sum + parseCount(value), 0);
  }
  if (failures < BREAKER_FAILURE_THRESHOLD) return false;
  await trip(store, key, nowSeconds);
  return true;
}

/** Records one successful provider call. In half-open it closes the breaker; otherwise a no-op. */
export async function recordSuccess(
  store: KVStore,
  tenantId: string,
  providerId: string,
  now: number = Date.now(),
): Promise<void> {
  const key = prefix(tenantId, providerId);
  const nowSeconds = toSeconds(now);
  if (stateAt(await lastTrip(store, key, nowSeconds), nowSeconds) !== "half_open") return;
  // A generation without a trip time reads as closed.
  await store.incrBy(generationKey(key, epochOf(nowSeconds)), 1, GENERATION_TTL);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function prefix(tenantId: string, providerId: string): string {
  // Encoded so that no id can contain the separator and collide with another pair.
  return `mva:brk:${encodeURIComponent(tenantId)}:${encodeURIComponent(providerId)}`;
}

function stateAt(trippedAt: number | null, nowSeconds: number): BreakerState {
  if (trippedAt === null) return "closed";
  if (nowSeconds < trippedAt + BREAKER_OPEN_SECONDS) return "open";
  if (nowSeconds < trippedAt + BREAKER_OPEN_SECONDS + BREAKER_HALF_OPEN_MAX_SECONDS) return "half_open";
  return "closed";
}

/** The trip time of the latest generation: today's, or yesterday's when today has none yet. */
async function lastTrip(store: KVStore, key: string, nowSeconds: number): Promise<number | null> {
  const today = epochOf(nowSeconds);
  for (const epoch of [today, today - 1]) {
    const generation = parseCount(await store.get(generationKey(key, epoch)));
    if (generation === 0) continue;
    const trippedAt = parseCount(await store.get(tripKey(key, epoch, generation)));
    return trippedAt > 0 ? trippedAt : null;
  }
  return null;
}

function generationKey(key: string, epoch: number): string {
  return `${key}:gen:${epoch}`;
}

function tripKey(key: string, epoch: number, generation: number): string {
  return `${key}:trip:${epoch}:${generation}`;
}

function epochOf(nowSeconds: number): number {
  return Math.floor(nowSeconds / EPOCH_SECONDS);
}

async function trip(store: KVStore, key: string, nowSeconds: number): Promise<void> {
  const epoch = epochOf(nowSeconds);
  const generation = await store.incrBy(generationKey(key, epoch), 1, GENERATION_TTL);
  const slot = tripKey(key, epoch, generation);
  const written = await store.incrBy(slot, nowSeconds, TRIP_TTL);
  // Each generation has one writer, so the key was new. If it was not (the generation counter was
  // lost, e.g. evicted from the memory store, and restarted at a number still in use), correct the
  // sum to the trip time instead of leaving a timestamp far in the future.
  if (written !== nowSeconds) await store.incrBy(slot, nowSeconds - written, TRIP_TTL);
}

function toSeconds(now: number): number {
  return Math.floor(now / 1000);
}

function parseCount(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
