// Admission and accounting (lib/voice/server/limits.ts): every refusal reason, races for the last
// minutes and slots, rollback, sessions that never end, leases, settlement through the ledger,
// scripted mode, turns, the model's spend per turn, the lock and the caps, and tenant isolation.
// Time is injected (`now`), never waited. The abuse scenarios of the security review are
// reproduced in limits-abuse.test.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { secondsUntilNextUtcDay, secondsUntilNextUtcMonth } from "@/lib/assistant/server/guard";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import {
  acquireSessionLock,
  admitSession,
  admitTurn,
  admitTurnRequest,
  BUSY_RETRY_AFTER_SECONDS,
  cancelReservation,
  confirmRealtimeCall,
  createSessionCaps,
  extendSession,
  globalUsageSnapshot,
  LOCK_MAX_POLL_MS,
  MIN_CHARGED_SECONDS,
  parseSessionReservation,
  reservationFromClaims,
  reserveTurnSpend,
  RUN_BUCKET_SECONDS,
  SCRIPTED_IP_LIMIT_FACTOR,
  SESSION_LEASE_SECONDS,
  sessionLifetimeSeconds,
  settleReportedCall,
  settleSession,
  settleTurnSpend,
  spendThresholdsCrossed,
  TURN_LOCK_SECONDS,
  TURN_REQUEST_WINDOW_SECONDS,
  TURN_REQUESTS_PER_WINDOW,
  usageSnapshot,
  usdToMicroChf,
  type SessionReservation,
} from "@/lib/voice/server/limits";
import { isSessionId } from "@/lib/voice/server/token";
import type { VoiceGlobalLimits } from "@/lib/voice/server/env";
import { DEFAULT_VOICE_LIMITS, type VoiceLimits, type VoiceMode } from "@/lib/voice/types";
import { createFakeStore } from "../assistant/fixtures";

/** 2026-11-25 12:00:00 UTC: on a whole hour, and on a bucket boundary. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const DAY = "2026-11-25";
const MONTH = "2026-11";
const TENANT = "demo-umzug";
const IP = "0123456789abcdef0123456789abcdef";
const B = RUN_BUCKET_SECONDS;
const BUCKET = Math.floor(NOW / 1000 / B);
/** Generous ceilings across all tenants, so each test tightens only the one it is about. */
const WIDE: VoiceGlobalLimits = { minutesPerDay: 100_000, budgetChfPerMonth: 100_000 };

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
  options: {
    limits?: VoiceLimits;
    now?: number;
    mode?: VoiceMode;
    tenantId?: string;
    ipHash?: string | null;
    cost?: number;
    global?: VoiceGlobalLimits;
    headroom?: number;
    /** A realtime provider that confirms calls (review finding S2-1). */
    confirms?: boolean;
  } = {},
) {
  return admitSession({
    store,
    tenantId: options.tenantId ?? TENANT,
    limits: options.limits ?? limits(),
    global: options.global ?? WIDE,
    ipHash: options.ipHash === undefined ? IP : options.ipHash,
    mode: options.mode ?? "realtime",
    costChfPerMinute: options.cost ?? (options.mode === "local" ? 0 : 0.25),
    spendHeadroomMicroChf: options.headroom,
    providerConfirmsCalls: options.confirms,
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
const gsec = `mva:gsec:${DAY}`;
const gchf = `mva:gchf:${MONTH}`;
const run = (bucket: number, tenant = TENANT) => `mva:run:${tenant}:${B}:${bucket}`;
const ledger = (sid: string, part: "sec" | "chf" | "run" | "turn") => `mva:led:${sid}:${part}`;

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
  it("admits a realtime session and reserves its whole call, for the tenant and for everybody", async () => {
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
      bucketSeconds: B,
      at: NOW,
    });
    assert.deepEqual(result.spend, { beforeChf: 0, afterChf: 0.75 });
    // A realtime session runs at the provider for its whole life (180 s + 60 s grace): it counts as
    // running in every bucket of it. The ledger records what it charged in this store.
    const lastBucket = Math.floor((NOW + sessionLifetimeSeconds(DEFAULT_VOICE_LIMITS) * 1000) / 1000 / B);
    const expected: Record<string, number> = {
      [secDay()]: 180,
      [secMonth()]: 180,
      [chf()]: 750_000,
      [gsec]: 180,
      [gchf]: 750_000,
      [ledger(r.sessionId, "sec")]: 180,
      [ledger(r.sessionId, "chf")]: 750_000,
      [ledger(r.sessionId, "run")]: lastBucket + 1,
    };
    for (let bucket = BUCKET; bucket <= lastBucket; bucket += 1) expected[run(bucket)] = 1;
    assert.deepEqual(counters(data), expected);
    for (const call of calls) assert.match(call.key, /^(mva:|mda:rl:mva:)/, call.key);
  });

  // Review finding sicurezza/F4: a local session reserves one lease, not its whole call.
  it("admits a local session with one lease of minutes, and registers it for that lease only", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { mode: "local", cost: 0.02 });
    assert.equal(r.reservedSeconds, SESSION_LEASE_SECONDS);
    assert.equal(r.reservedMicroChf, Math.ceil((SESSION_LEASE_SECONDS * 20_000) / 60));
    assert.equal(counters(data)[secDay()], SESSION_LEASE_SECONDS);
    assert.equal(counters(data)[gsec], SESSION_LEASE_SECONDS);
    assert.equal(counters(data)[run(BUCKET)], 1);
    assert.equal(counters(data)[run(BUCKET + 1)], 1);
    assert.equal(counters(data)[run(BUCKET + 2)], undefined);
  });

  it("uses the session id it is given", async () => {
    const { store } = createFakeStore();
    const result = await admitSession({
      store,
      tenantId: TENANT,
      limits: limits(),
      global: WIDE,
      ipHash: IP,
      mode: "local",
      costChfPerMinute: 0.02,
      sessionId: "AAAAAAAAAAAAAAAAAAAAAA",
      now: NOW,
    });
    assert.ok(result.ok);
    assert.equal(result.reservation.sessionId, "AAAAAAAAAAAAAAAAAAAAAA");
    // One lease (60 s) at 0.02 CHF a minute; it was the whole call (180 s, 60'000) before leases.
    assert.equal(result.reservation.reservedMicroChf, 20_000);
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

  it("admits a local session only when the month can still pay for one turn", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ budgetChfPerMonth: 0.01 });
    const refused = await admit(store, { mode: "local", limits: tight, headroom: 20_000 });
    assert.deepEqual(refused, { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcMonth(NOW) });
    assert.equal(counters(data)[secDay()], 0, "nothing stays reserved");
    await admitOk(store, { mode: "local", limits: tight, headroom: 5_000 });
    // The headroom is checked, never charged.
    assert.equal(counters(data)[chf()], 0);
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

  // Review finding sicurezza/F3: the per-IP windows used to be per tenant, so thirteen public
  // tenants gave one IP thirteen allowances. They count across all tenants now.
  it("counts per IP across every tenant, and keeps different IPs apart", async () => {
    const { store } = createFakeStore();
    const tight = limits({ sessionsPerIpPerHour: 1 });
    await admitOk(store, { limits: tight });
    assert.equal((await admit(store, { limits: tight })).ok, false);
    const otherTenant = await admit(store, { limits: tight, tenantId: "demo-salon" });
    assert.deepEqual(otherTenant, { ok: false, code: "rate_limited", retryAfter: 3600 });
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

  // Review finding sicurezza/F3: nothing capped the total across tenants.
  it("stops every tenant at the global minutes of the day and the global spend of the month", async () => {
    const { store, data } = createFakeStore();
    const global = { minutesPerDay: 6, budgetChfPerMonth: 100 };
    await admitOk(store, { global, tenantId: "demo-a" });
    await admitOk(store, { global, tenantId: "demo-b" });
    const third = await admit(store, { global, tenantId: "demo-c" });
    assert.deepEqual(third, { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcDay(NOW) });
    assert.equal(counters(data)[gsec], 360, "the refused reservation was taken back");
    assert.deepEqual(await globalUsageSnapshot(store, NOW), { minutesToday: 6, spendChfThisMonth: 1.5 });

    const money = createFakeStore();
    const budget = { minutesPerDay: 100_000, budgetChfPerMonth: 1 };
    await admitOk(money.store, { global: budget, tenantId: "demo-a" });
    const over = await admit(money.store, { global: budget, tenantId: "demo-b" });
    assert.deepEqual(over, { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcMonth(NOW) });
  });
});

describe("admitSession: broken inputs fail closed", () => {
  it("treats a limit that is not a number as zero", async () => {
    const { store } = createFakeStore();
    assert.equal((await admit(store, { limits: limits({ minutesPerDay: Number.NaN }) })).ok, false);
    assert.equal((await admit(store, { limits: limits({ budgetChfPerMonth: Number.NaN }) })).ok, false);
    const busy = await admit(store, { limits: limits({ maxConcurrentSessions: Number.NaN }) });
    assert.equal(busy.ok ? "ok" : busy.code, "busy");
    assert.equal((await admit(store, { global: { minutesPerDay: Number.NaN, budgetChfPerMonth: 100 } })).ok, false);
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

  it("ten tenants racing for the global minutes: they never pass them together", async () => {
    const store = createMemoryStore();
    const global = { minutesPerDay: 9, budgetChfPerMonth: 1000 };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => admit(store, { global, tenantId: `demo-${i}` })));
    assert.equal(results.filter((result) => result.ok).length, 3);
    assert.equal((await globalUsageSnapshot(store, NOW)).minutesToday, 9);
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
  // The bucket length no longer depends on maxCallSeconds (it is RUN_BUCKET_SECONDS). A realtime
  // session counts for its whole possible life; a local one for its lease, renewed by each turn.
  it("a realtime session that never ends counts for its whole life, and stops after it", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    await admitOk(store, { limits: tight }); // never settled
    const life = sessionLifetimeSeconds(DEFAULT_VOICE_LIMITS);
    for (const later of [10, life - 1, life, life + B - 1]) {
      const result = await admit(store, { limits: tight, now: NOW + later * 1000 });
      assert.equal(result.ok, false, `+${later}s`);
    }
    await admitOk(store, { limits: tight, now: NOW + (life + B) * 1000 });
  });

  it("a local session that never reports anything counts for one lease and one bucket, not more", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    await admitOk(store, { mode: "local", limits: tight }); // abandoned
    for (const later of [10, SESSION_LEASE_SECONDS, SESSION_LEASE_SECONDS + B - 1]) {
      const result = await admit(store, { mode: "local", limits: tight, now: NOW + later * 1000 });
      assert.equal(result.ok, false, `+${later}s`);
    }
    await admitOk(store, { mode: "local", limits: tight, now: NOW + (SESSION_LEASE_SECONDS + B) * 1000 });
  });

  it("sees a session opened just before a bucket boundary from just after it", async () => {
    const { store } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    await admitOk(store, { mode: "local", limits: tight, now: NOW + B * 1000 - 1 });
    assert.equal((await admit(store, { mode: "local", limits: tight, now: NOW + B * 1000 })).ok, false);
  });

  it("uses a token as long as the session may live", () => {
    assert.equal(sessionLifetimeSeconds({ maxCallSeconds: 180 }), 240);
    assert.equal(sessionLifetimeSeconds({ maxCallSeconds: 600 }), 660);
    assert.equal(sessionLifetimeSeconds({ maxCallSeconds: Number.NaN }), 240);
  });

  it("counts running sessions whatever their call length", async () => {
    const { store } = createFakeStore();
    const long = limits({ maxCallSeconds: 300 });
    await admitOk(store, { limits: long });
    await admitOk(store);
    assert.equal((await usageSnapshot(store, TENANT, NOW)).running, 2);
  });
});

describe("extendSession (leases)", () => {
  it("each turn extends a local session to the time used plus one lease, and its slot with it", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    const r = await admitOk(store, { mode: "local", limits: tight });
    assert.deepEqual(await extendSession({ store, reservation: r, limits: tight, global: WIDE, now: NOW + 50_000 }), {
      ok: true,
      reservedSeconds: 110,
    });
    assert.equal(counters(data)[secDay()], 110);
    assert.equal(counters(data)[gsec], 110);
    assert.equal(counters(data)[ledger(r.sessionId, "sec")], 110);
    await extendSession({ store, reservation: r, limits: tight, global: WIDE, now: NOW + 100_000 });
    assert.equal(counters(data)[secDay()], 160);
    // Still running more than two minutes after admission, because it showed signs of life.
    assert.equal((await admit(store, { mode: "local", limits: tight, now: NOW + 130_000 })).ok, false);
    // Never beyond the whole call.
    await extendSession({ store, reservation: r, limits: tight, global: WIDE, now: NOW + 170_000 });
    assert.equal(counters(data)[secDay()], 180);
  });

  // This ran on the minutes of the day before. A local session's minutes no longer refuse it
  // (review finding S2-2, next test), so the same rule is shown on what still does: a price per
  // minute held to the month's spend.
  it("an extension that does not fit lets the session use what it holds, then refuses", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ budgetChfPerMonth: 0.02 }); // at 0.02 CHF a minute: room for the first lease only
    const r = await admitOk(store, { mode: "local", limits: tight, cost: 0.02 });
    assert.deepEqual(await extendSession({ store, reservation: r, limits: tight, global: WIDE, now: NOW + 30_000 }), {
      ok: true,
      reservedSeconds: 60,
    });
    assert.equal(counters(data)[secDay()], 60, "the extension was taken back");
    assert.equal(counters(data)[chf()], 20_000);
    assert.deepEqual(await extendSession({ store, reservation: r, limits: tight, global: WIDE, now: NOW + 61_000 }), {
      ok: false,
      code: "budget_exhausted",
      retryAfter: secondsUntilNextUtcMonth(NOW + 61_000),
    });
  });

  // Review finding S2-2: a local session's minutes cost nothing (the model is charged per turn),
  // yet they filled the day: a script keeping empty sessions alive shut the receptionist down.
  it("the minutes of the day never refuse a local session, they are only counted", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ minutesPerDay: 1, minutesPerMonth: 1, maxConcurrentSessions: 100 });
    const global = { minutesPerDay: 1, budgetChfPerMonth: 100_000 };
    const first = await admitOk(store, { mode: "local", limits: tight, global });
    for (const at of [50_000, 100_000, 150_000]) {
      assert.equal((await extendSession({ store, reservation: first, limits: tight, global, now: NOW + at })).ok, true, `+${at}`);
    }
    for (let i = 0; i < 5; i++) await admitOk(store, { mode: "local", limits: tight, global, now: NOW + i * 1000 });
    assert.equal(counters(data)[secDay()], 180 + 5 * 60, "counted all the same");
    // Zero still means off.
    assert.deepEqual(await admit(store, { mode: "local", limits: limits({ minutesPerDay: 0 }) }), {
      ok: false,
      code: "budget_exhausted",
      retryAfter: secondsUntilNextUtcDay(NOW),
    });
    assert.equal((await admit(store, { mode: "local", global: { minutesPerDay: 0, budgetChfPerMonth: 100 } })).ok, false);
  });

  it("does not extend a realtime session: it holds its whole call from the start", async () => {
    const { store, calls } = createFakeStore();
    const r = await admitOk(store);
    const before = calls.length;
    assert.deepEqual(await extendSession({ store, reservation: r, limits: limits(), now: NOW + 60_000 }), { ok: true, reservedSeconds: 180 });
    assert.equal(calls.length, before);
  });
});

describe("admitSession: scripted mode", () => {
  it("reserves nothing and ignores concurrency, minutes and budget", async () => {
    const { store, data } = createFakeStore();
    const none = limits({ maxConcurrentSessions: 0, minutesPerDay: 0, minutesPerMonth: 0, budgetChfPerMonth: 0 });
    const result = await admit(store, { limits: none, mode: "scripted", global: { minutesPerDay: 0, budgetChfPerMonth: 0 } });
    assert.ok(result.ok);
    assert.equal(result.spend, undefined);
    assert.equal(result.reservation.reservedSeconds, 0);
    assert.equal(result.reservation.reservedMicroChf, 0);
    assert.equal(result.reservation.bucket, null);
    assert.deepEqual(counters(data), {});
    // Per IP across tenants (sicurezza/F3): the key names the kind, not the tenant.
    for (const key of data.keys()) assert.match(key, /^mda:rl:mva:ip:scripted:/);
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
    await cancelReservation(store, r, NOW);
    assert.equal(calls.length, 0);
  });
});

describe("settleSession", () => {
  // These ran on a realtime session before. A realtime session no longer gives time back on the
  // browser's word (see "keeps a realtime session's whole reservation"), so they use a local one.
  it("gives back the unused lease and its spend, and frees the slot", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { mode: "local", cost: 0.02 });
    await settleSession(store, r, 31, NOW + 35_000);
    const c = counters(data);
    assert.equal(c[secDay()], 31);
    assert.equal(c[secMonth()], 31);
    assert.equal(c[gsec], 31);
    assert.equal(c[chf()], Math.ceil((31 * 20_000) / 60));
    assert.equal(c[gchf], Math.ceil((31 * 20_000) / 60));
    assert.equal(c[run(BUCKET)], 0);
    assert.equal(c[run(BUCKET + 1)], 0);
    assert.equal(c[`mva:settled:${TENANT}:${r.sessionId}`], 1);
    const snapshot = await usageSnapshot(store, TENANT, NOW + 35_000);
    assert.equal(snapshot.running, 0);
    assert.equal(snapshot.minutesToday, 31 / 60);
  });

  it("is idempotent per session: a second settle changes nothing", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { mode: "local" });
    await settleSession(store, r, 40, NOW);
    // The settlement marker itself counts every attempt; everything else must stay put.
    const accounting = () =>
      Object.fromEntries(Object.entries(counters(data)).filter(([key]) => !key.startsWith("mva:settled:")));
    const after = accounting();
    await settleSession(store, r, 0, NOW);
    await settleSession(store, { ...r }, 10, NOW);
    await cancelReservation(store, r, NOW);
    assert.deepEqual(accounting(), after);
    assert.equal(after[secDay()], 40);
  });

  it("never charges more than was reserved, nor less than the minimum", async () => {
    const { store, data } = createFakeStore();
    const over = await admitOk(store, { mode: "local" });
    await settleSession(store, over, 5000, NOW);
    assert.equal(counters(data)[secDay()], SESSION_LEASE_SECONDS);
    const under = await admitOk(store, { mode: "local" });
    await settleSession(store, under, -30, NOW);
    assert.equal(counters(data)[secDay()], SESSION_LEASE_SECONDS + MIN_CHARGED_SECONDS);
  });

  it("charges the whole reservation when the used time is not a number, and still frees the slot", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { mode: "local" });
    await settleSession(store, r, Number.NaN, NOW);
    assert.equal(counters(data)[secDay()], SESSION_LEASE_SECONDS);
    assert.equal(counters(data)[run(BUCKET)], 0);
  });

  it("keeps a realtime session's whole reservation: the provider bills it whatever the browser says", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store);
    await settleSession(store, r, 5, NOW + 5_000);
    assert.equal(counters(data)[secDay()], 180);
    assert.equal(counters(data)[chf()], 750_000);
    assert.equal(counters(data)[run(BUCKET)], 0, "the slot is free");
  });

  it("gives everything back when an admission never became a conversation", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store);
    await cancelReservation(store, r, NOW);
    for (const key of [secDay(), secMonth(), chf(), gsec, gchf, run(BUCKET), run(BUCKET + 4)]) assert.equal(counters(data)[key], 0, key);
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
    const lateEvening = Date.UTC(2026, 10, 25, 23, 59, 30);
    const r = await admitOk(store, { mode: "local", now: lateEvening });
    await extendSession({ store, reservation: r, limits: limits(), global: WIDE, now: lateEvening + 50_000 });
    await settleSession(store, r, 100, lateEvening + 100_000);
    assert.equal(counters(data)[secDay()], 100);
    assert.equal(counters(data)["mva:sec:demo-umzug:2026-11-26"], undefined);
  });

  it("does not touch concurrency buckets that are already in the past", async () => {
    const { store, calls } = createFakeStore();
    const r = await admitOk(store, { mode: "local" });
    const before = calls.length;
    await settleSession(store, r, 100, NOW + 10 * 60_000);
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

  it("settles a session whose state is gone, from its token and its ledger", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { mode: "local" });
    const rebuilt = reservationFromClaims({ tid: TENANT, sid: r.sessionId, mode: "local", iat: Math.floor(NOW / 1000) }, 0);
    assert.ok(rebuilt);
    await settleSession(store, rebuilt, 20, NOW + 20_000);
    assert.equal(counters(data)[secDay()], 20);
    assert.equal(counters(data)[run(BUCKET)], 0);
  });
});

// Review finding correttezza/F2: a reservation charged to the memory fallback during an Upstash
// cool-down was later given back to Upstash, which never received it.
describe("settlement through the ledger", () => {
  it("gives nothing back to a store that never received the reservation, and never goes below zero", async () => {
    const fallback = createFakeStore(); // where the admission landed during the outage
    const remote = createFakeStore(); // the store that is up again at settlement
    const tight = limits({ maxConcurrentSessions: 2 });
    const a = await admitOk(remote.store, { limits: tight });
    const b = await admitOk(fallback.store, { limits: tight });
    await settleSession(remote.store, b, 20, NOW + 20_000);
    assert.equal(counters(remote.data)[secDay()], 180, "A's reservation is untouched");
    assert.equal(counters(remote.data)[chf()], 750_000);
    assert.equal(counters(remote.data)[run(BUCKET)], 1, "A still counts as running");
    for (const value of Object.values(counters(remote.data))) assert.ok(value >= 0);
    // A second session is still admitted, a third is not: concurrency holds.
    await admitOk(remote.store, { limits: tight });
    assert.equal((await admit(remote.store, { limits: tight })).ok, false);
    void a;
  });

  it("clamps a counter at zero when a give-back finds less than expected", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { mode: "local" });
    // The day counter was lost (an evicted key, an outage), the ledger was not.
    data.set(secDay(), "5");
    await settleSession(store, r, 10, NOW + 10_000);
    assert.equal(counters(data)[secDay()], 0);
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

// Review finding sicurezza/F1: the model's tokens of a local turn were never charged.
describe("reserveTurnSpend and settleTurnSpend", () => {
  const SID = "TurnSpendSession000001";

  it("reserves the worst case, then settles to the real cost on the tenant and on everybody", async () => {
    const { store, data } = createFakeStore();
    const reserved = await reserveTurnSpend({ store, tenantId: TENANT, sessionId: SID, limits: limits(), global: WIDE, micro: 12_000, now: NOW });
    assert.ok(reserved.ok);
    assert.equal(counters(data)[chf()], 12_000);
    assert.equal(counters(data)[gchf], 12_000);
    await settleTurnSpend(store, reserved.reservation, 3_500);
    assert.equal(counters(data)[chf()], 3_500);
    assert.equal(counters(data)[gchf], 3_500);
    assert.equal(counters(data)[ledger(SID, "turn")], 0);
  });

  it("refuses the turn once the tenant's or everybody's month cannot pay for it", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ budgetChfPerMonth: 0.02 });
    const first = await reserveTurnSpend({ store, tenantId: TENANT, sessionId: SID, limits: tight, global: WIDE, micro: 12_000, now: NOW });
    assert.ok(first.ok);
    await settleTurnSpend(store, first.reservation, 12_000);
    const second = await reserveTurnSpend({ store, tenantId: TENANT, sessionId: SID, limits: tight, global: WIDE, micro: 12_000, now: NOW });
    assert.deepEqual(second, { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcMonth(NOW) });
    assert.equal(counters(data)[chf()], 12_000, "the refused reservation was taken back");
    const global = await reserveTurnSpend({
      store,
      tenantId: "demo-other",
      sessionId: SID,
      limits: limits(),
      global: { minutesPerDay: 100, budgetChfPerMonth: 0.02 },
      micro: 12_000,
      now: NOW,
    });
    assert.equal(global.ok, false);
  });

  it("charges a turn that cost more than its reservation the difference", async () => {
    const { store, data } = createFakeStore();
    const reserved = await reserveTurnSpend({ store, tenantId: TENANT, sessionId: SID, limits: limits(), global: WIDE, micro: 1_000, now: NOW });
    assert.ok(reserved.ok);
    await settleTurnSpend(store, reserved.reservation, 1_500);
    assert.equal(counters(data)[chf()], 1_500);
  });

  it("gives nothing back to a store that never received the turn's reservation", async () => {
    const elsewhere = createFakeStore();
    const here = createFakeStore();
    here.data.set(chf(), "50000");
    const reserved = await reserveTurnSpend({ store: elsewhere.store, tenantId: TENANT, sessionId: SID, limits: limits(), global: WIDE, micro: 12_000, now: NOW });
    assert.ok(reserved.ok);
    await settleTurnSpend(here.store, reserved.reservation, 2_000);
    assert.equal(counters(here.data)[chf()], 52_000, "the real cost is charged, nothing is given back");
  });

  it("converts USD to micro-CHF at the rate, rounding up", () => {
    assert.equal(usdToMicroChf(0.01, 0.9), 9_000);
    assert.equal(usdToMicroChf(0.0000011, 0.9), 1);
    assert.equal(usdToMicroChf(0, 0.9), 0);
    assert.equal(usdToMicroChf(Number.NaN, 0.9), 0);
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

// Review finding sicurezza/F7: turns of one session ran in parallel on copies of its state.
describe("acquireSessionLock and createSessionCaps", () => {
  const SID = "LockedSession000000001";

  it("lets one holder in at a time, and the next one after a release", async () => {
    const store = createMemoryStore();
    const clock = () => NOW;
    const first = await acquireSessionLock(store, SID, { clock });
    assert.ok(first);
    assert.equal(await acquireSessionLock(store, SID, { clock }), null);
    await first.release();
    await first.release(); // twice is harmless
    const second = await acquireSessionLock(store, SID, { clock });
    assert.ok(second);
    await second.release();
  });

  it("of many racing for the lock, exactly one gets it", async () => {
    const store = createMemoryStore();
    const results = await Promise.all(Array.from({ length: 24 }, () => acquireSessionLock(store, SID, { clock: () => NOW })));
    assert.equal(results.filter((lock) => lock !== null).length, 1);
  });

  it("waits for a holder that finishes, and frees a lock lost by a crash after two slots", async () => {
    const store = createMemoryStore();
    const held = await acquireSessionLock(store, SID, { clock: () => NOW });
    assert.ok(held);
    setTimeout(() => void held.release(), 30);
    const waited = await acquireSessionLock(store, SID, { clock: () => NOW, waitMs: 2_000, pollMs: 10 });
    assert.ok(waited, "got it once the first released");
    // `waited` is never released: as if its function had been killed.
    assert.equal(await acquireSessionLock(store, SID, { clock: () => NOW + TURN_LOCK_SECONDS * 1000 }), null);
    assert.ok(await acquireSessionLock(store, SID, { clock: () => NOW + 2 * TURN_LOCK_SECONDS * 1000 }));
  });

  // Review finding S2-4: every refused try was an increment and its give-back, every 100 ms.
  it("a waiter only reads while the lock is held, with pauses that double", async () => {
    const { store, calls } = createFakeStore();
    const held = await acquireSessionLock(store, SID, { clock: () => NOW });
    assert.ok(held);
    const before = calls.length;
    const started = Date.now();
    // Real timers: the deadline sits just under the fifth try, so the fourth still comes when the
    // machine is busy and its timers fire up to 350 ms late (at 400 ms the margin was 50 ms, and
    // the test failed under load with three tries).
    assert.equal(await acquireSessionLock(store, SID, { clock: () => NOW, waitMs: 700, pollMs: 50 }), null);
    const waited = calls.slice(before);
    assert.ok(waited.every((call) => call.op === "get"), JSON.stringify(waited.map((call) => call.op)));
    // Tries at 0, 50, 150 and 350 ms; the next one (750 ms) would come after the deadline.
    assert.equal(waited.length, 4);
    assert.ok(Date.now() - started < 1_000);
    await held.release();
    assert.ok(LOCK_MAX_POLL_MS <= 1_000);
  });

  it("lets each session send only a few turn requests per window, before anything else", async () => {
    const { store, calls } = createFakeStore();
    const results = [];
    for (let i = 0; i < TURN_REQUESTS_PER_WINDOW + 3; i++) results.push(await admitTurnRequest(store, SID, NOW));
    assert.equal(results.filter((result) => result.ok).length, TURN_REQUESTS_PER_WINDOW);
    assert.deepEqual(results[results.length - 1], { ok: false, code: "rate_limited", retryAfter: TURN_REQUEST_WINDOW_SECONDS });
    assert.equal(calls.length, TURN_REQUESTS_PER_WINDOW + 3, "one increment per request");
    // The next window, and another session, start afresh.
    assert.equal((await admitTurnRequest(store, SID, NOW + TURN_REQUEST_WINDOW_SECONDS * 1000)).ok, true);
    assert.equal((await admitTurnRequest(store, "OtherSession0000000001", NOW)).ok, true);
    const before = calls.length;
    assert.equal((await admitTurnRequest(store, "not a session", NOW)).ok, false);
    assert.equal(calls.length, before);
  });

  it("caps hold under parallel takes, and a unit given back can be taken again", async () => {
    const store = createMemoryStore();
    const caps = createSessionCaps(store, SID, 600);
    const taken = await Promise.all(Array.from({ length: 24 }, () => caps.take("leads", 2)));
    assert.equal(taken.filter(Boolean).length, 2);
    await caps.giveBack("leads");
    assert.equal(await caps.take("leads", 2), true);
    assert.equal(await caps.take("leads", 2), false);
    assert.equal(await caps.take("bookings", Number.NaN), false, "a broken cap allows nothing");
  });
});

// Review finding S2-1: every realtime admission reserved and kept its whole call, so ten tokens
// that were never used (or calls of five seconds) shut a tenant down for the day, forty for the
// month. With a provider that confirms calls, a call is charged when the provider proves it is
// live and settled to what the provider bills.
describe("review S2-1: a realtime call is charged on the provider's word", () => {
  const sec = (data: Map<string, string>) => counters(data)[secDay()] ?? 0;
  const spend = (data: Map<string, string>) => counters(data)[chf()] ?? 0;

  it("admission charges nothing, checks that a whole call still fits, and registers one lease", async () => {
    const { store, data } = createFakeStore();
    const result = await admit(store, { confirms: true });
    assert.ok(result.ok);
    assert.equal(result.reservation.reservedSeconds, 0);
    assert.equal(result.reservation.reservedMicroChf, 0);
    assert.deepEqual(result.spend, { beforeChf: 0, afterChf: 0 });
    assert.equal(sec(data), 0);
    assert.equal(spend(data), 0);
    assert.equal(counters(data)[run(BUCKET)], 1);
    assert.equal(counters(data)[run(BUCKET + 1)], 1);
    assert.equal(counters(data)[run(BUCKET + 2)], undefined, "one lease, not the whole life");
    // A whole call (3 minutes, 0.75 CHF) must fit, though nothing is charged.
    assert.equal((await admit(store, { confirms: true, limits: limits({ minutesPerDay: 2 }) })).ok, false);
    assert.equal((await admit(store, { confirms: true, limits: limits({ budgetChfPerMonth: 0.5 }) })).ok, false);
    assert.equal((await admit(store, { confirms: true, global: { minutesPerDay: 2, budgetChfPerMonth: 100 } })).ok, false);
    assert.equal(sec(data), 0, "the refusals left nothing behind");
  });

  it("ten tokens that are never used leave the day untouched, and the eleventh session is admitted (probe5)", async () => {
    const tight = limits({ minutesPerDay: 30, minutesPerMonth: 300, budgetChfPerMonth: 30, maxConcurrentSessions: 2 });
    const { store, data } = createFakeStore();
    for (let i = 0; i <= 10; i++) await admitOk(store, { confirms: true, limits: tight, now: NOW + i * 250_000 });
    assert.equal(sec(data), 0);
    assert.equal(spend(data), 0);
    // Without a provider that confirms calls, the old rule still holds: ten whole calls fill the day.
    const old = createFakeStore();
    for (let i = 0; i < 10; i++) await admitOk(old.store, { limits: tight, now: NOW + i * 250_000 });
    assert.equal((await admit(old.store, { limits: tight, now: NOW + 10 * 250_000 })).ok, false);
  });

  it("the start charges the whole call once, and the end settles it to the seconds billed", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ maxConcurrentSessions: 1 });
    const r = await admitOk(store, { confirms: true, limits: tight });
    await confirmRealtimeCall({ store, reservation: r, limits: tight, now: NOW + 5_000 });
    assert.equal(sec(data), 180);
    assert.equal(spend(data), 750_000);
    assert.equal(counters(data)[gsec], 180);
    assert.equal(counters(data)[ledger(r.sessionId, "sec")], 180);
    // A connected call runs for its whole life: the slot is taken well beyond the first lease.
    assert.equal((await admit(store, { confirms: true, limits: tight, now: NOW + 200_000 })).ok, false);
    // A second proof (a tool call after the "started" event) charges nothing more.
    await confirmRealtimeCall({ store, reservation: r, limits: tight, now: NOW + 30_000 });
    assert.equal(sec(data), 180);

    await settleReportedCall({ store, reservation: r, reportedSeconds: 74.2, limits: tight, now: NOW + 80_000 });
    assert.equal(sec(data), 75);
    assert.equal(spend(data), Math.ceil((75 * 250_000) / 60));
    assert.equal(counters(data)[run(BUCKET + 1)], 0, "the slot is free");
    await admitOk(store, { confirms: true, limits: tight, now: NOW + 81_000 });
    // A late or repeated report, and a late "started", change nothing.
    await settleReportedCall({ store, reservation: r, reportedSeconds: 170, limits: tight, now: NOW + 90_000 });
    await confirmRealtimeCall({ store, reservation: r, limits: tight, now: NOW + 95_000 });
    assert.equal(sec(data), 75);
  });

  it("a call whose start was lost is charged at its end; a token never used costs nothing", async () => {
    const { store, data } = createFakeStore();
    const lost = await admitOk(store, { confirms: true });
    await settleReportedCall({ store, reservation: lost, reportedSeconds: 90, limits: limits(), now: NOW + 95_000 });
    assert.equal(sec(data), 90);
    const unused = await admitOk(store, { confirms: true });
    await settleReportedCall({ store, reservation: unused, reportedSeconds: 0, limits: limits(), now: NOW + 70_000 });
    assert.equal(sec(data), 90);
  });

  it("the browser's end report frees the slot only, and the provider's report still settles", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { confirms: true });
    await confirmRealtimeCall({ store, reservation: r, limits: limits(), now: NOW + 2_000 });
    await settleSession(store, r, 5, NOW + 10_000);
    assert.equal(sec(data), 180, "the browser's word gives no minutes back");
    assert.equal(counters(data)[run(BUCKET)], 0);
    assert.equal(counters(data)[`mva:settled:${TENANT}:${r.sessionId}`], undefined);
    await settleReportedCall({ store, reservation: r, reportedSeconds: 40, limits: limits(), now: NOW + 45_000 });
    assert.equal(sec(data), 40);
  });

  it("a confirmation is never refused: live calls pass the ceiling, and the next admission is refused", async () => {
    const { store, data } = createFakeStore();
    const tight = limits({ minutesPerDay: 3 }); // room for one whole call
    const a = await admitOk(store, { confirms: true, limits: tight });
    const b = await admitOk(store, { confirms: true, limits: tight });
    await confirmRealtimeCall({ store, reservation: a, limits: tight, now: NOW + 1_000 });
    await confirmRealtimeCall({ store, reservation: b, limits: tight, now: NOW + 1_000 });
    assert.equal(sec(data), 360, "two live calls, both charged: the overshoot is bounded by the calls running at once");
    assert.equal((await admit(store, { confirms: true, limits: tight, now: NOW + 2_000 })).ok, false);
  });

  it("a report longer than the session's life is cut to it; one that is not a number keeps everything", async () => {
    const { store, data } = createFakeStore();
    const r = await admitOk(store, { confirms: true });
    await confirmRealtimeCall({ store, reservation: r, limits: limits(), now: NOW });
    await settleReportedCall({ store, reservation: r, reportedSeconds: 99_999, limits: limits(), now: NOW + 240_000 });
    assert.equal(sec(data), sessionLifetimeSeconds(limits()));
    const junk = createFakeStore();
    const s = await admitOk(junk.store, { confirms: true });
    await confirmRealtimeCall({ store: junk.store, reservation: s, limits: limits(), now: NOW });
    await settleReportedCall({ store: junk.store, reservation: s, reportedSeconds: Number.NaN, limits: limits(), now: NOW + 10_000 });
    assert.equal(sec(junk.data), 180);
    assert.equal(counters(junk.data)[run(BUCKET)], 0);
  });

  it("ignores a local session and a reservation that is not ours", async () => {
    const { store, calls } = createFakeStore();
    const local = await admitOk(store, { mode: "local" });
    const before = calls.length;
    await confirmRealtimeCall({ store, reservation: local, limits: limits(), now: NOW });
    await settleReportedCall({ store, reservation: local, reportedSeconds: 30, limits: limits(), now: NOW });
    await confirmRealtimeCall({ store, reservation: null as unknown as SessionReservation, limits: limits(), now: NOW });
    assert.equal(calls.length, before);
  });
});
