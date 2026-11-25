// Admission and accounting (lib/voice/server/limits.ts): every refusal reason, races for the last
// minutes and slots, rollback, sessions that never end, settlement, scripted mode, turns, and
// tenant isolation. Time is injected (`now`), never waited.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { secondsUntilNextUtcDay, secondsUntilNextUtcMonth } from "@/lib/assistant/server/guard";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import {
  admitSession,
  admitTurn,
  BUSY_RETRY_AFTER_SECONDS,
  parseSessionReservation,
  SCRIPTED_IP_LIMIT_FACTOR,
  SESSION_GRACE_SECONDS,
  sessionLifetimeSeconds,
  settleSession,
  spendThresholdsCrossed,
  usageSnapshot,
  type SessionReservation,
} from "@/lib/voice/server/limits";
import { isSessionId } from "@/lib/voice/server/token";
import { DEFAULT_VOICE_LIMITS, type VoiceLimits, type VoiceMode } from "@/lib/voice/types";
import { createFakeStore } from "../assistant/fixtures";

/** 2026-11-25 12:00:00 UTC: on a whole hour, and on a 240-second bucket boundary. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const DAY = "2026-11-25";
const MONTH = "2026-11";
const TENANT = "demo-umzug";
const IP = "0123456789abcdef0123456789abcdef";
/** Bucket length with the default maxCallSeconds (180) plus the grace. */
const L = DEFAULT_VOICE_LIMITS.maxCallSeconds + SESSION_GRACE_SECONDS;
const BUCKET = Math.floor(NOW / 1000 / L);

/** Generous limits, so each test tightens only the one it is about. */
function limits(overrides: Partial<VoiceLimits> = {}): VoiceLimits {
  return {
    ...DEFAULT_VOICE_LIMITS,
    sessionsPerIpPerHour: 100,
    sessionsPerIpPerDay: 100,
    maxConcurrentSessions: 10,
    minutesPerDay: 1000,
    minutesPerMonth: 10_000,
    budgetChfPerMonth: 1000,
    ...overrides,
  };
}

function admit(
  store: KVStore,
  options: { limits?: VoiceLimits; now?: number; mode?: VoiceMode; tenantId?: string; ipHash?: string | null; cost?: number } = {},
) {
  return admitSession({
    store,
    tenantId: options.tenantId ?? TENANT,
    limits: options.limits ?? limits(),
    ipHash: options.ipHash === undefined ? IP : options.ipHash,
    mode: options.mode ?? "realtime",
    costChfPerMinute: options.cost ?? 0.25,
    now: options.now ?? NOW,
  });
}

async function admitOk(store: KVStore, options: Parameters<typeof admit>[1] = {}): Promise<SessionReservation> {
  const result = await admit(store, options);
  assert.ok(result.ok, JSON.stringify(result));
  return result.reservation;
}

/** The voice accounting counters (everything but the per-IP windows), as numbers. */
function counters(data: Map<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of data) if (key.startsWith("mva:")) out[key] = Number(value);
  return out;
}

const secDay = (tenant = TENANT) => `mva:sec:${tenant}:${DAY}`;
const secMonth = (tenant = TENANT) => `mva:sec:${tenant}:${MONTH}`;
const chf = (tenant = TENANT) => `mva:chf:${tenant}:${MONTH}`;
const run = (bucket: number, length = L, tenant = TENANT) => `mva:run:${tenant}:${length}:${bucket}`;

let logLines: string[] = [];
beforeEach(() => {
  logLines = [];
  mock.method(console, "log", (line: unknown) => {
    logLines.push(String(line));
  });
});
afterEach(() => {
  mock.restoreAll();
});

describe("admitSession: admission", () => {
  it("admits a live session and reserves its worst case", async () => {
    const { store, data, calls } = createFakeStore();
    const result = await admit(store);
    assert.ok(result.ok);
    const r = result.reservation;
    assert.ok(isSessionId(r.sessionId));
    assert.deepEqual({ ...r, sessionId: "x" }, {
      tenantId: TENANT,
      sessionId: "x",
      mode: "realtime",
      reservedSeconds: 180,
      costChfPerMinute: 0.25,
      reservedMicroChf: 750_000,
      day: DAY,
      month: MONTH,
      bucket: BUCKET,
      bucketSeconds: L,
      at: NOW,
    });
    assert.deepEqual(result.spend, { beforeChf: 0, afterChf: 0.75 });
    assert.deepEqual(counters(data), {
      [run(BUCKET)]: 1,
      [run(BUCKET + 1)]: 1,
      [secDay()]: 180,
      [secMonth()]: 180,
      [chf()]: 750_000,
    });
    for (const call of calls) assert.match(call.key, /^(mva:|mda:rl:mva:)/, call.key);
  });

  it("uses the session id it is given", async () => {
    const { store } = createFakeStore();
    const result = await admitSession({
      store,
      tenantId: TENANT,
      limits: limits(),
      ipHash: IP,
      mode: "local",
      costChfPerMinute: 0.02,
      sessionId: "AAAAAAAAAAAAAAAAAAAAAA",
      now: NOW,
    });
    assert.ok(result.ok);
    assert.equal(result.reservation.sessionId, "AAAAAAAAAAAAAAAAAAAAAA");
    assert.equal(result.reservation.reservedMicroChf, 60_000);
  });

  it("returns the month spend before and after, ready for spendThresholdsCrossed", async () => {
    const { store } = createFakeStore();
    await admitOk(store);
    const second = await admit(store);
    assert.ok(second.ok);
    assert.deepEqual(second.spend, { beforeChf: 0.75, afterChf: 1.5 });
    assert.deepEqual(spendThresholdsCrossed(second.spend.beforeChf, second.spend.afterChf, 2), [50]);
  });

  it("gives every session a fresh id", async () => {
    const { store } = createFakeStore();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await admitOk(store)).sessionId);
    assert.equal(ids.size, 5);
  });
});

describe("admitSession: rate_limited (per IP)", () => {
  it("refuses the session over the hourly limit, with the time to the end of the hour", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ sessionsPerIpPerHour: 3 });
    for (let i = 0; i < 3; i++) await admitOk(store, { limits: tight });
    assert.deepEqual(await admit(store, { limits: tight }), { ok: false, code: "rate_limited", retryAfter: 3600 });
    // The refused session reserved nothing.
    assert.equal(counters(data)[secDay()], 3 * 180);
  });

  it("refuses the session over the daily limit", async () => {
    const { store } = createFakeStore();
    const tight = limits({ sessionsPerIpPerDay: 2 });
    await admitOk(store, { limits: tight });
    await admitOk(store, { limits: tight, now: NOW + 2 * 3600_000 });
    const third = await admit(store, { limits: tight, now: NOW + 4 * 3600_000 });
    assert.deepEqual(third, { ok: false, code: "rate_limited", retryAfter: 8 * 3600 });
  });

  it("skips the per-IP limit when the IP is unknown, instead of sharing one bucket", async () => {
    const { store } = createFakeStore();
    for (let i = 0; i < 5; i++) await admitOk(store, { limits: limits({ sessionsPerIpPerHour: 0 }), ipHash: null });
  });

  it("never puts a raw IP into a store key, even when a caller passes one by mistake", async () => {
    const { store, calls } = createFakeStore();
    await admitOk(store, { ipHash: "203.0.113.7" });
    await admitOk(store, { ipHash: "2001:db8::1", mode: "scripted" });
    assert.ok(calls.length > 0);
    for (const call of calls) assert.ok(!call.key.includes("203.0.113") && !call.key.includes("2001:db8"), call.key);
  });

  it("counts per tenant and per IP", async () => {
    const { store } = createFakeStore();
    const tight = limits({ sessionsPerIpPerHour: 1 });
    await admitOk(store, { limits: tight });
    assert.equal((await admit(store, { limits: tight })).ok, false);
    await admitOk(store, { limits: tight, tenantId: "demo-salon" });
    await admitOk(store, { limits: tight, ipHash: "fedcba9876543210fedcba9876543210" });
  });
});

describe("admitSession: busy (concurrency per tenant)", () => {
  it("refuses a session over the concurrency limit and rolls its slot back", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 2 });
    await admitOk(store, { limits: tight });
    await admitOk(store, { limits: tight });
    const before = counters(data);
    assert.deepEqual(await admit(store, { limits: tight }), {
      ok: false,
      code: "busy",
      retryAfter: BUSY_RETRY_AFTER_SECONDS,
    });
    assert.deepEqual(counters(data), before);
    assert.equal(before[run(BUCKET)], 2);
  });

  it("refuses everything with a concurrency limit of zero", async () => {
    const { store } = createFakeStore();
    assert.equal((await admit(store, { limits: limits({ maxConcurrentSessions: 0 }) })).ok, false);
  });

  it("counts per tenant", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    await admitOk(store, { limits: tight });
    assert.equal((await admit(store, { limits: tight })).ok, false);
    await admitOk(store, { limits: tight, tenantId: "demo-salon" });
  });
});

describe("admitSession: budget_exhausted (minutes and spend)", () => {
  it("refuses when the day's minutes cannot hold the worst case, until tomorrow", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ minutesPerDay: 5 });
    await admitOk(store, { limits: tight });
    const before = counters(data);
    assert.deepEqual(await admit(store, { limits: tight }), {
      ok: false,
      code: "budget_exhausted",
      retryAfter: secondsUntilNextUtcDay(NOW),
    });
    assert.deepEqual(counters(data), before);
  });

  it("refuses when the month's minutes are used up, until next month", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ minutesPerMonth: 5 });
    await admitOk(store, { limits: tight });
    const before = counters(data);
    assert.deepEqual(await admit(store, { limits: tight }), {
      ok: false,
      code: "budget_exhausted",
      retryAfter: secondsUntilNextUtcMonth(NOW),
    });
    assert.deepEqual(counters(data), before);
  });

  it("refuses when the estimated spend would pass the monthly budget", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ budgetChfPerMonth: 1 });
    await admitOk(store, { limits: tight });
    const before = counters(data);
    assert.deepEqual(await admit(store, { limits: tight }), {
      ok: false,
      code: "budget_exhausted",
      retryAfter: secondsUntilNextUtcMonth(NOW),
    });
    assert.deepEqual(counters(data), before);
  });

  it("admits up to exactly the budget", async () => {
    const { store } = createFakeStore();
    const tight = limits({ budgetChfPerMonth: 1.5 });
    await admitOk(store, { limits: tight });
    await admitOk(store, { limits: tight });
    assert.equal((await admit(store, { limits: tight })).ok, false);
  });

  it("refuses everything with zero minutes or a zero budget", async () => {
    const { store } = createFakeStore();
    assert.equal((await admit(store, { limits: limits({ minutesPerDay: 0 }) })).ok, false);
    assert.equal((await admit(store, { limits: limits({ budgetChfPerMonth: 0 }) })).ok, false);
  });

  it("keeps one tenant's spent budget away from the others", async () => {
    const { store } = createFakeStore();
    const tight = limits({ minutesPerDay: 3 });
    await admitOk(store, { limits: tight });
    assert.equal((await admit(store, { limits: tight })).ok, false);
    assert.deepEqual(await usageSnapshot(store, "demo-salon", NOW), {
      minutesToday: 0,
      minutesThisMonth: 0,
      spendChfThisMonth: 0,
      running: 0,
    });
    await admitOk(store, { limits: tight, tenantId: "demo-salon" });
  });
});

describe("admitSession: broken inputs fail closed", () => {
  it("treats a limit that is not a number as zero", async () => {
    const { store } = createFakeStore();
    assert.equal((await admit(store, { limits: limits({ minutesPerDay: Number.NaN }) })).ok, false);
    assert.equal((await admit(store, { limits: limits({ budgetChfPerMonth: Number.NaN }) })).ok, false);
    const busy = await admit(store, { limits: limits({ maxConcurrentSessions: Number.NaN }) });
    assert.equal(busy.ok ? "ok" : busy.code, "busy");
  });

  it("reserves the default call length when maxCallSeconds is not a number", async () => {
    const { store } = createFakeStore();
    const r = await admitOk(store, { limits: limits({ maxCallSeconds: Number.NaN }) });
    assert.equal(r.reservedSeconds, DEFAULT_VOICE_LIMITS.maxCallSeconds);
  });

  it("charges the expensive rate when the cost is not a number", async () => {
    const { store } = createFakeStore();
    for (const cost of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      assert.equal((await admitOk(store, { cost })).reservedMicroChf, 750_000, String(cost));
    }
  });
});

describe("admitSession: races and rollback", () => {
  it("two sessions racing for the last minutes never both pass", async () => {
    for (const store of [createFakeStore().store, createMemoryStore()]) {
      const tight = limits({ minutesPerDay: 3 }); // room for exactly one 180-second reservation
      const results = await Promise.all([admit(store, { limits: tight }), admit(store, { limits: tight })]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      const snapshot = await usageSnapshot(store, TENANT, NOW);
      assert.equal(snapshot.minutesToday, 3);
      assert.equal(snapshot.running, 1);
    }
  });

  it("ten sessions racing for three slots: exactly three pass", async () => {
    const store = createMemoryStore();
    const tight = limits({ maxConcurrentSessions: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => admit(store, { limits: tight })));
    assert.equal(results.filter((result) => result.ok).length, 3);
    assert.equal((await usageSnapshot(store, TENANT, NOW)).running, 3);
    assert.equal((await usageSnapshot(store, TENANT, NOW)).minutesToday, 9);
  });

  it("ten sessions racing for a budget of four: exactly four pass, spend within budget", async () => {
    const store = createMemoryStore();
    const tight = limits({ budgetChfPerMonth: 3 }); // 4 x 0.75 CHF
    const results = await Promise.all(Array.from({ length: 10 }, () => admit(store, { limits: tight })));
    assert.equal(results.filter((result) => result.ok).length, 4);
    assert.equal((await usageSnapshot(store, TENANT, NOW)).spendChfThisMonth, 3);
  });

  it("a refused session leaves every counter as it was", async () => {
    const { store, data } = createFakeStore();
    await admitOk(store);
    for (const tight of [
      limits({ maxConcurrentSessions: 1 }),
      limits({ minutesPerDay: 3 }),
      limits({ minutesPerMonth: 3 }),
      limits({ budgetChfPerMonth: 0.75 }),
    ]) {
      const before = counters(data);
      assert.equal((await admit(store, { limits: tight })).ok, false);
      assert.deepEqual(counters(data), before);
    }
  });
});

describe("admitSession: concurrency without a scan", () => {
  it("a session that never ends counts for at least one window, and stops after two", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    await admitOk(store, { limits: tight }); // never settled
    for (const later of [10, L - 1, L, L + 100, 2 * L - 1]) {
      const result = await admit(store, { limits: tight, now: NOW + later * 1000 });
      assert.equal(result.ok, false, `+${later}s`);
    }
    await admitOk(store, { limits: tight, now: NOW + 2 * L * 1000 });
  });

  it("sees a session opened just before a bucket boundary from just after it", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    await admitOk(store, { limits: tight, now: NOW + L * 1000 - 1 });
    assert.equal((await admit(store, { limits: tight, now: NOW + L * 1000 })).ok, false);
  });

  it("uses a bucket as long as the session may live", () => {
    assert.equal(sessionLifetimeSeconds({ maxCallSeconds: 180 }), 240);
    assert.equal(sessionLifetimeSeconds({ maxCallSeconds: 600 }), 660);
    assert.equal(sessionLifetimeSeconds({ maxCallSeconds: Number.NaN }), 240);
  });

  it("keeps the counters of different call lengths apart", async () => {
    const { store } = createFakeStore();
    const long = limits({ maxCallSeconds: 300 });
    await admitOk(store, { limits: long });
    assert.equal((await usageSnapshot(store, TENANT, NOW, long)).running, 1);
    // Without the tenant's limits the snapshot reads the default buckets.
    assert.equal((await usageSnapshot(store, TENANT, NOW)).running, 0);
  });
});

describe("admitSession: scripted mode", () => {
  it("reserves nothing and ignores concurrency, minutes and budget", async () => {
    const { store, data } = createFakeStore();
    const none = limits({ maxConcurrentSessions: 0, minutesPerDay: 0, minutesPerMonth: 0, budgetChfPerMonth: 0 });
    const result = await admit(store, { limits: none, mode: "scripted" });
    assert.ok(result.ok);
    assert.equal(result.spend, undefined);
    assert.equal(result.reservation.reservedSeconds, 0);
    assert.equal(result.reservation.reservedMicroChf, 0);
    assert.equal(result.reservation.bucket, null);
    assert.deepEqual(counters(data), {});
    for (const key of data.keys()) assert.match(key, /^mda:rl:mva:ip:demo-umzug:scripted:/);
  });

  it("touches the store not at all when the IP is unknown", async () => {
    const { store, calls } = createFakeStore();
    assert.ok((await admit(store, { mode: "scripted", ipHash: null })).ok);
    assert.equal(calls.length, 0);
  });

  it("has its own, larger per-IP allowance that leaves the live sessions alone", async () => {
    const { store } = createFakeStore();
    const tight = limits({ sessionsPerIpPerHour: 3 });
    for (let i = 0; i < 3 * SCRIPTED_IP_LIMIT_FACTOR; i++) {
      assert.ok((await admit(store, { limits: tight, mode: "scripted" })).ok, `example ${i + 1}`);
    }
    const over = await admit(store, { limits: tight, mode: "scripted" });
    assert.equal(over.ok ? "ok" : over.code, "rate_limited");
    await admitOk(store, { limits: tight, mode: "realtime" });
  });

  it("settles to nothing", async () => {
    const { store, calls } = createFakeStore();
    const r = await admitOk(store, { mode: "scripted", ipHash: null });
    await settleSession(store, r, 120, NOW);
    assert.equal(calls.length, 0);
  });
});

describe("settleSession", () => {
  it("gives back the unused minutes and spend and frees the slot", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store);
    await settleSession(store, r, 61, NOW + 70_000);
    assert.deepEqual(counters(data), {
      [run(BUCKET)]: 0,
      [run(BUCKET + 1)]: 0,
      [secDay()]: 61,
      [secMonth()]: 61,
      [chf()]: Math.ceil((61 * 250_000) / 60),
      [`mva:settled:${TENANT}:${r.sessionId}`]: 1,
    });
    const snapshot = await usageSnapshot(store, TENANT, NOW + 70_000);
    assert.equal(snapshot.running, 0);
    assert.equal(snapshot.minutesToday, 61 / 60);
  });

  it("is idempotent per session: a second settle changes nothing", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store);
    await settleSession(store, r, 60, NOW);
    // The settlement marker itself counts every attempt; everything else must stay put.
    const accounting = () =>
      Object.fromEntries(Object.entries(counters(data)).filter(([key]) => !key.startsWith("mva:settled:")));
    const after = accounting();
    await settleSession(store, r, 0, NOW);
    await settleSession(store, { ...r }, 10, NOW);
    assert.deepEqual(accounting(), after);
    assert.equal(after[secDay()], 60);
  });

  it("never charges more than the reservation, nor less than zero", async () => {
    const { store, data } = createFakeStore();
    const over = await admitOk(store);
    await settleSession(store, over, 5000, NOW);
    assert.equal(counters(data)[secDay()], 180);
    const under = await admitOk(store);
    await settleSession(store, under, -30, NOW);
    assert.equal(counters(data)[secDay()], 180);
    assert.equal(counters(data)[chf()], 750_000);
  });

  it("charges the whole reservation when the used time is not a number", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store);
    await settleSession(store, r, Number.NaN, NOW);
    assert.equal(counters(data)[secDay()], 180);
    assert.equal(counters(data)[run(BUCKET)], 0);
  });

  it("frees the slot for the next caller", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    const first = await admitOk(store, { limits: tight });
    assert.equal((await admit(store, { limits: tight })).ok, false);
    await settleSession(store, first, 30, NOW + 30_000);
    await admitOk(store, { limits: tight, now: NOW + 31_000 });
  });

  it("lands on the day of the admission when the session ends after midnight", async () => {
    const { store, data } = createFakeStore();
    const lateEvening = Date.UTC(2026, 10, 25, 23, 59, 0);
    const r = await admitOk(store, { now: lateEvening });
    await settleSession(store, r, 100, lateEvening + 150_000);
    assert.equal(counters(data)[secDay()], 100);
    assert.equal(counters(data)["mva:sec:demo-umzug:2026-11-26"], undefined);
  });

  it("does not touch concurrency buckets that are already in the past", async () => {
    const { store, calls } = createFakeStore();
    const r = await admitOk(store);
    const before = calls.length;
    await settleSession(store, r, 100, NOW + 2 * L * 1000);
    assert.ok(calls.slice(before).every((call) => !call.key.startsWith("mva:run:")));
  });

  it("ignores something that is not a reservation of ours, and logs it", async () => {
    const { store, calls } = createFakeStore();
    const r = await admitOk(store);
    const before = calls.length;
    await settleSession(store, { ...r, reservedSeconds: -500 }, 0, NOW);
    await settleSession(store, null as unknown as SessionReservation, 0, NOW);
    assert.equal(calls.length, before);
    assert.equal(logLines.filter((line) => line.includes("settle_invalid_reservation")).length, 2);
  });
});

describe("parseSessionReservation", () => {
  it("round-trips a reservation through JSON", async () => {
    const { store } = createFakeStore();
    const r = await admitOk(store);
    assert.deepEqual(parseSessionReservation(JSON.parse(JSON.stringify(r))), r);
    const scripted = await admitOk(store, { mode: "scripted" });
    assert.deepEqual(parseSessionReservation(JSON.parse(JSON.stringify(scripted))), scripted);
  });

  it("refuses every field that is off", async () => {
    const { store } = createFakeStore();
    const r = await admitOk(store);
    const broken: Array<Partial<Record<keyof SessionReservation, unknown>>> = [
      { tenantId: "Demo" },
      { sessionId: "short" },
      { mode: "free" },
      { reservedSeconds: -1 },
      { reservedSeconds: 99_999 },
      { reservedSeconds: 1.5 },
      { costChfPerMinute: -0.1 },
      { reservedMicroChf: "750000" },
      { day: "2026-12-01" },
      { month: "2026-1" },
      { bucket: "7" },
      { bucketSeconds: 0 },
      { at: undefined },
    ];
    for (const change of broken) {
      assert.equal(parseSessionReservation({ ...r, ...change }), null, JSON.stringify(change));
    }
    for (const junk of [null, undefined, "x", 1, []]) assert.equal(parseSessionReservation(junk), null);
  });
});

describe("usageSnapshot", () => {
  it("reads minutes, spend and running sessions of one tenant, reservations included", async () => {
    const { store } = createFakeStore();
    await admitOk(store);
    await admitOk(store);
    assert.deepEqual(await usageSnapshot(store, TENANT, NOW), {
      minutesToday: 6,
      minutesThisMonth: 6,
      spendChfThisMonth: 1.5,
      running: 2,
    });
  });
});

describe("spendThresholdsCrossed", () => {
  it("names each threshold crossed upwards by the change", () => {
    assert.deepEqual(spendThresholdsCrossed(0, 15, 30), [50]);
    assert.deepEqual(spendThresholdsCrossed(14, 25, 30), [50, 80]);
    assert.deepEqual(spendThresholdsCrossed(0, 30, 30), [50, 80, 100]);
    assert.deepEqual(spendThresholdsCrossed(23.9, 24, 30), [80]);
  });

  it("names nothing when no line is crossed upwards", () => {
    assert.deepEqual(spendThresholdsCrossed(15, 16, 30), []);
    assert.deepEqual(spendThresholdsCrossed(25, 10, 30), []);
    assert.deepEqual(spendThresholdsCrossed(30, 31, 30), []);
  });

  it("names nothing for a budget or amounts that are not usable", () => {
    assert.deepEqual(spendThresholdsCrossed(0, 10, 0), []);
    assert.deepEqual(spendThresholdsCrossed(0, 10, -5), []);
    assert.deepEqual(spendThresholdsCrossed(Number.NaN, 10, 30), []);
    assert.deepEqual(spendThresholdsCrossed(0, Number.POSITIVE_INFINITY, 30), []);
  });
});

describe("admitTurn", () => {
  const SID = "AAAAAAAAAAAAAAAAAAAAAA";

  it("counts the caller turns of a session down to zero, then refuses", async () => {
    const { store } = createFakeStore();
    const turnLimits = { maxTurnsPerSession: 3 };
    for (const remaining of [2, 1, 0]) {
      assert.deepEqual(await admitTurn({ store, sessionId: SID, limits: turnLimits }), { ok: true, remainingTurns: remaining });
    }
    assert.deepEqual(await admitTurn({ store, sessionId: SID, limits: turnLimits }), { ok: false, code: "session_limit" });
    assert.deepEqual(await admitTurn({ store, sessionId: SID, limits: turnLimits }), { ok: false, code: "session_limit" });
  });

  it("keeps sessions apart", async () => {
    const { store } = createFakeStore();
    await admitTurn({ store, sessionId: SID, limits: { maxTurnsPerSession: 1 } });
    const other = await admitTurn({ store, sessionId: "BBBBBBBBBBBBBBBBBBBBBB", limits: { maxTurnsPerSession: 1 } });
    assert.deepEqual(other, { ok: true, remainingTurns: 0 });
  });

  it("refuses an id that is not a session id, without touching the store", async () => {
    const { store, calls } = createFakeStore();
    for (const id of ["", "short", "a b c d e f g h i j k l", 42 as unknown as string]) {
      assert.deepEqual(await admitTurn({ store, sessionId: id, limits: { maxTurnsPerSession: 10 } }), {
        ok: false,
        code: "session_limit",
      });
    }
    assert.equal(calls.length, 0);
  });

  it("refuses everything when the limit is not a number", async () => {
    const { store } = createFakeStore();
    const result = await admitTurn({ store, sessionId: SID, limits: { maxTurnsPerSession: Number.NaN } });
    assert.equal(result.ok, false);
  });
});
