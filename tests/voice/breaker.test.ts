// Circuit breaker (lib/voice/server/breaker.ts): opening, staying open, half-open, recovery,
// separation per tenant and provider. Time is injected (`now`), never waited.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_HALF_OPEN_MAX_SECONDS,
  BREAKER_OPEN_SECONDS,
  BREAKER_WINDOW_SECONDS,
  breakerState,
  isOpen,
  recordFailure,
  recordSuccess,
} from "@/lib/voice/server/breaker";
import { createFakeStore } from "../assistant/fixtures";

/** 2026-11-25 12:00:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const T = "demo-umzug";
const P = "mock";
const at = (seconds: number) => NOW + seconds * 1000;

/** Fails `count` times at the given offsets (seconds); returns how many calls reported opening. */
async function failAt(store: KVStore, offsets: number[], tenant = T, provider = P): Promise<number> {
  let opened = 0;
  for (const offset of offsets) if (await recordFailure(store, tenant, provider, at(offset))) opened += 1;
  return opened;
}

/** A breaker that opened at second 0. */
async function tripped(): Promise<KVStore> {
  const store = createMemoryStore();
  assert.equal(await failAt(store, [0, 0, 0, 0, 0]), 1);
  return store;
}

describe("breaker constants", () => {
  it("match the documented policy", () => {
    assert.equal(BREAKER_FAILURE_THRESHOLD, 5);
    assert.equal(BREAKER_WINDOW_SECONDS, 60);
    assert.equal(BREAKER_OPEN_SECONDS, 120);
    assert.ok(BREAKER_HALF_OPEN_MAX_SECONDS > 0);
  });
});

describe("breaker: opening", () => {
  it("starts closed", async () => {
    const store = createMemoryStore();
    assert.equal(await breakerState(store, T, P, NOW), "closed");
    assert.equal(await isOpen(store, T, P, NOW), false);
  });

  it("stays closed after four failures and opens on the fifth inside the window", async () => {
    const store = createMemoryStore();
    assert.equal(await failAt(store, [0, 15, 30, 45]), 0);
    assert.equal(await isOpen(store, T, P, at(46)), false);
    assert.equal(await recordFailure(store, T, P, at(59)), true);
    assert.equal(await isOpen(store, T, P, at(59)), true);
    assert.equal(await breakerState(store, T, P, at(59)), "open");
  });

  it("does not open for five failures spread over more than the window", async () => {
    const store = createMemoryStore();
    assert.equal(await failAt(store, [0, 20, 40, 60, 80, 100, 120]), 0);
    assert.equal(await isOpen(store, T, P, at(121)), false);
  });

  it("reports the opening once, to the failure that caused it", async () => {
    const store = createMemoryStore();
    assert.equal(await failAt(store, [0, 1, 2, 3, 4, 5, 6, 7]), 1);
  });
});

describe("breaker: open, half-open, closed", () => {
  it("stays open for BREAKER_OPEN_SECONDS, then lets traffic through again", async () => {
    const store = await tripped();
    assert.equal(await isOpen(store, T, P, at(BREAKER_OPEN_SECONDS - 1)), true);
    assert.equal(await isOpen(store, T, P, at(BREAKER_OPEN_SECONDS)), false);
    assert.equal(await breakerState(store, T, P, at(BREAKER_OPEN_SECONDS)), "half_open");
  });

  it("is not kept open longer by failures of calls that were already running", async () => {
    const store = await tripped();
    assert.equal(await failAt(store, [10, 60, 119]), 0);
    assert.equal(await isOpen(store, T, P, at(BREAKER_OPEN_SECONDS)), false);
  });

  it("reopens at once on the first failure in half-open", async () => {
    const store = await tripped();
    const reopenAt = BREAKER_OPEN_SECONDS + 5;
    assert.equal(await recordFailure(store, T, P, at(reopenAt)), true);
    assert.equal(await isOpen(store, T, P, at(reopenAt)), true);
    assert.equal(await isOpen(store, T, P, at(reopenAt + BREAKER_OPEN_SECONDS - 1)), true);
    assert.equal(await isOpen(store, T, P, at(reopenAt + BREAKER_OPEN_SECONDS)), false);
  });

  it("closes on a success in half-open: one failure later does not reopen it", async () => {
    const store = await tripped();
    await recordSuccess(store, T, P, at(BREAKER_OPEN_SECONDS + 1));
    assert.equal(await breakerState(store, T, P, at(BREAKER_OPEN_SECONDS + 1)), "closed");
    assert.equal(await recordFailure(store, T, P, at(BREAKER_OPEN_SECONDS + 2)), false);
    assert.equal(await isOpen(store, T, P, at(BREAKER_OPEN_SECONDS + 2)), false);
    // ...but five fresh failures open it again.
    assert.equal(await failAt(store, [200, 201, 202, 203]), 0);
    assert.equal(await failAt(store, [204]), 1);
  });

  it("ignores successes while open", async () => {
    const store = await tripped();
    await recordSuccess(store, T, P, at(10));
    assert.equal(await isOpen(store, T, P, at(11)), true);
  });

  it("ends half-open by itself after a long quiet time", async () => {
    const store = await tripped();
    const quiet = BREAKER_OPEN_SECONDS + BREAKER_HALF_OPEN_MAX_SECONDS;
    assert.equal(await breakerState(store, T, P, at(quiet)), "closed");
    assert.equal(await recordFailure(store, T, P, at(quiet)), false);
    assert.equal(await isOpen(store, T, P, at(quiet)), false);
  });
});

describe("breaker: isolation and robustness", () => {
  it("keeps tenants and providers apart", async () => {
    const store = await tripped();
    assert.equal(await isOpen(store, T, P, at(1)), true);
    assert.equal(await isOpen(store, "demo-salon", P, at(1)), false);
    assert.equal(await isOpen(store, T, "other", at(1)), false);
  });

  it("cannot be confused by ids that contain the separator", async () => {
    const store = createMemoryStore();
    await failAt(store, [0, 0, 0, 0, 0], "a", "b:c");
    assert.equal(await isOpen(store, "a", "b:c", at(1)), true);
    assert.equal(await isOpen(store, "a:b", "c", at(1)), false);
  });

  it("writes only mva: keys", async () => {
    const { store, calls } = createFakeStore();
    await failAt(store, [0, 0, 0, 0, 0]);
    await recordSuccess(store, T, P, at(BREAKER_OPEN_SECONDS + 1));
    for (const call of calls) assert.match(call.key, /^mva:brk:/);
  });

  it("repairs a trip slot that was still in use when the generation counter restarted", async () => {
    const { store, data } = createFakeStore();
    // A leftover from an older generation 1 of the same day: an old trip time, still in the store.
    // (The generation is counted per UTC day now, so the day is part of the key.)
    const day = Math.floor(NOW / 1000 / 86_400);
    data.set(`mva:brk:${T}:${P}:trip:${day}:1`, String(NOW / 1000 - 30));
    assert.equal(await failAt(store, [0, 0, 0, 0, 0]), 1);
    assert.equal(data.get(`mva:brk:${T}:${P}:trip:${day}:1`), String(NOW / 1000));
    assert.equal(await isOpen(store, T, P, at(BREAKER_OPEN_SECONDS - 1)), true);
    assert.equal(await isOpen(store, T, P, at(BREAKER_OPEN_SECONDS)), false);
  });

  // Review finding correttezza/F10: the generation counter kept the TTL of its first trip and could
  // expire while the breaker was open, which read as "closed".
  it("stays open across the generation counter's age, and across midnight", async () => {
    const { store, data, calls } = createFakeStore();
    // A generation counter of a long-gone day plays no part: only today's and yesterday's are read.
    data.set(`mva:brk:${T}:${P}:gen:${Math.floor(NOW / 1000 / 86_400) - 7}`, "9");
    const lateEvening = Date.UTC(2026, 10, 25, 23, 59, 0);
    for (let i = 0; i < 5; i++) await recordFailure(store, T, P, lateEvening);
    assert.equal(await isOpen(store, T, P, lateEvening + 90_000), true, "still open just after midnight");
    assert.equal(await breakerState(store, T, P, lateEvening + (BREAKER_OPEN_SECONDS + 10) * 1000), "half_open");
    // Every generation counter is written with a TTL of days, never a week.
    for (const call of calls.filter((entry) => entry.op === "incrBy" && entry.key.includes(":gen:"))) {
      assert.ok((call.ttlSeconds ?? 0) <= 3 * 86_400);
    }
  });
});
