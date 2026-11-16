// Spend accounting and logs (lib/assistant/server/usage.ts): the spend reservation taken at the
// gate and its settlement, token counters, the summary read back, and content-free JSON logs.
// Exact keys, TTLs and integer micro-USD amounts from the contract.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createMemoryStore } from "@/lib/assistant/server/store";
import {
  getUsageSummary,
  logEvent,
  recordTokens,
  reserveSpend,
  settleSpend,
  toMicroUsd,
} from "@/lib/assistant/server/usage";
import { createFakeStore } from "./fixtures";

const NOW = Date.UTC(2026, 10, 15, 10, 30, 0);
const DAY = "2026-11-15";
const MONTH = "2026-11";
const THREE_DAYS = 3 * 86_400;
const FORTY_DAYS = 40 * 86_400;
/** From NOW to the next UTC day / month. */
const TO_NEXT_DAY = 13.5 * 3600;
const TO_NEXT_MONTH = 15 * 86_400 + TO_NEXT_DAY;
/** $1 a day, $15 a month, as in DEFAULT_LIMITS. */
const BUDGET = { tenantBudgetUsdPerDay: 1, tenantBudgetUsdPerMonth: 15 };

describe("reserveSpend", () => {
  it("adds the reservation to the day and month cost counters (contract keys and TTLs)", async () => {
    const { store, calls } = createFakeStore();
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1835, now: NOW });
    assert.deepEqual(gate, {
      ok: true,
      reservation: { dayKey: `mda:cost:t1:${DAY}`, monthKey: `mda:cost:t1:${MONTH}`, micro: 1835, at: NOW },
    });
    assert.deepEqual(calls, [
      { op: "incrBy", key: `mda:cost:t1:${DAY}`, by: 1835, ttlSeconds: THREE_DAYS },
      { op: "incrBy", key: `mda:cost:t1:${MONTH}`, by: 1835, ttlSeconds: FORTY_DAYS },
    ]);
  });

  it("admits a request whose worst case lands exactly on the budget", async () => {
    const { store, data } = createFakeStore();
    data.set(`mda:cost:t1:${DAY}`, "999000");
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1000, now: NOW });
    assert.equal(gate.ok, true);
    assert.equal(data.get(`mda:cost:t1:${DAY}`), "1000000");
  });

  it("refuses a request whose worst case no longer fits today, and takes the reservation back", async () => {
    const { store, data } = createFakeStore();
    data.set(`mda:cost:t1:${DAY}`, "999500");
    data.set(`mda:cost:t1:${MONTH}`, "4000000");
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1000, now: NOW });
    assert.deepEqual(gate, { ok: false, code: "budget_exhausted", retryAfter: TO_NEXT_DAY });
    assert.equal(data.get(`mda:cost:t1:${DAY}`), "999500", "the day counter is back where it was");
    assert.equal(data.get(`mda:cost:t1:${MONTH}`), "4000000", "the month counter is back where it was");
  });

  it("refuses on the monthly budget with the month's Retry-After, also when the day is spent too", async () => {
    for (const day of ["0", "999999"]) {
      const { store, data } = createFakeStore();
      data.set(`mda:cost:t1:${DAY}`, day);
      data.set(`mda:cost:t1:${MONTH}`, "14999500");
      const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1000, now: NOW });
      assert.deepEqual(gate, { ok: false, code: "budget_exhausted", retryAfter: TO_NEXT_MONTH }, `day spent ${day}`);
      assert.equal(data.get(`mda:cost:t1:${MONTH}`), "14999500");
      assert.equal(data.get(`mda:cost:t1:${DAY}`), day);
    }
  });

  it("refuses everything when the budget is zero", async () => {
    const { store } = createFakeStore();
    const limits = { tenantBudgetUsdPerDay: 0, tenantBudgetUsdPerMonth: 15 };
    const gate = await reserveSpend({ store, tenantId: "t1", limits, micro: 1, now: NOW });
    assert.equal(gate.ok, false);
  });

  it("lets a burst of concurrent requests reserve no more than the budget (SEC-2)", async () => {
    // The race the reservation closes: 80 replies admitted together used to pass a gate that only
    // read the spend, which grew once each reply had ended. Each reservation here is 0.1 USD.
    const store = createMemoryStore();
    const gates = await Promise.all(
      Array.from({ length: 80 }, () => reserveSpend({ store, tenantId: "burst", limits: BUDGET, micro: 100_000, now: NOW })),
    );
    const admitted = gates.filter((gate) => gate.ok);
    assert.equal(admitted.length, 10, "exactly what fits in $1");
    assert.equal(await store.get(`mda:cost:burst:${DAY}`), "1000000", "the refused reservations were all taken back");
    assert.equal(await store.get(`mda:cost:burst:${MONTH}`), "1000000");
    const next = await reserveSpend({ store, tenantId: "burst", limits: BUDGET, micro: 1, now: NOW });
    assert.equal(next.ok, false, "a full budget refuses even the smallest request");
  });

  it("keeps budgets per tenant", async () => {
    const { store, data } = createFakeStore();
    data.set(`mda:cost:spent:${DAY}`, "5000000");
    const gate = await reserveSpend({ store, tenantId: "fresh", limits: BUDGET, micro: 1000, now: NOW });
    assert.equal(gate.ok, true);
  });
});

describe("settleSpend", () => {
  it("gives back what the reply did not use, on the counters it was reserved on", async () => {
    const { store, data, calls } = createFakeStore();
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1835, now: NOW });
    assert.ok(gate.ok);
    calls.length = 0;
    await settleSpend(store, gate.reservation, 108);
    assert.deepEqual(calls, [
      { op: "incrBy", key: `mda:cost:t1:${DAY}`, by: -1727, ttlSeconds: THREE_DAYS },
      { op: "incrBy", key: `mda:cost:t1:${MONTH}`, by: -1727, ttlSeconds: FORTY_DAYS },
    ]);
    assert.equal(data.get(`mda:cost:t1:${DAY}`), "108");
    assert.equal(data.get(`mda:cost:t1:${MONTH}`), "108");
  });

  it("settles on the day and month of the reservation, even when the reply ends after midnight", async () => {
    const { store, data } = createFakeStore();
    const lastSecond = Date.UTC(2026, 10, 30, 23, 59, 59);
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 2000, now: lastSecond });
    assert.ok(gate.ok);
    // settleSpend reads no clock: whatever time it runs, only the captured keys move.
    await settleSpend(store, gate.reservation, 500);
    assert.equal(data.get("mda:cost:t1:2026-11-30"), "500");
    assert.equal(data.get("mda:cost:t1:2026-11"), "500");
    assert.deepEqual([...data.keys()].sort(), ["mda:cost:t1:2026-11", "mda:cost:t1:2026-11-30"]);
  });

  it("adds the difference when the reply cost more than its reservation", async () => {
    const { store, data } = createFakeStore();
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1000, now: NOW });
    assert.ok(gate.ok);
    await settleSpend(store, gate.reservation, 1250);
    assert.equal(data.get(`mda:cost:t1:${DAY}`), "1250");
  });

  it("gives the whole reservation back when nothing was billed", async () => {
    const { store, data } = createFakeStore();
    data.set(`mda:cost:t1:${DAY}`, "7000");
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1835, now: NOW });
    assert.ok(gate.ok);
    await settleSpend(store, gate.reservation, 0);
    assert.equal(data.get(`mda:cost:t1:${DAY}`), "7000");
  });

  it("makes no store call when the reply cost exactly its reservation", async () => {
    const { store, calls } = createFakeStore();
    const gate = await reserveSpend({ store, tenantId: "t1", limits: BUDGET, micro: 1000, now: NOW });
    assert.ok(gate.ok);
    calls.length = 0;
    await settleSpend(store, gate.reservation, 1000);
    assert.deepEqual(calls, []);
  });

  it("works with the real memory store's negative increments", async () => {
    const store = createMemoryStore();
    const gate = await reserveSpend({ store, tenantId: "mem", limits: BUDGET, micro: 5000, now: NOW });
    assert.ok(gate.ok);
    await settleSpend(store, gate.reservation, 1200);
    assert.equal(await store.get(`mda:cost:mem:${DAY}`), "1200");
    assert.equal((await getUsageSummary(store, "mem", NOW)).costTodayUsd, 0.0012);
  });
});

describe("recordTokens", () => {
  it("counts the day's input and output tokens for three days, and never touches the spend", async () => {
    const { store, calls } = createFakeStore();
    const usage = { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 5000, cacheWriteTokens: 700 };
    await recordTokens({ store, tenantId: "t1", usage, now: NOW });
    assert.deepEqual(calls, [
      { op: "incrBy", key: `mda:tok:in:t1:${DAY}`, by: 1200, ttlSeconds: THREE_DAYS },
      { op: "incrBy", key: `mda:tok:out:t1:${DAY}`, by: 300, ttlSeconds: THREE_DAYS },
    ]);
  });

  it("skips zero counts and stores whole numbers only", async () => {
    const { store, calls } = createFakeStore();
    await recordTokens({ store, tenantId: "t1", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 9, cacheWriteTokens: 9 }, now: NOW });
    assert.deepEqual(calls, []);
    await recordTokens({ store, tenantId: "t1", usage: { inputTokens: 41.6, outputTokens: Number.NaN, cacheReadTokens: 0, cacheWriteTokens: 0 }, now: NOW });
    assert.deepEqual(calls, [{ op: "incrBy", key: `mda:tok:in:t1:${DAY}`, by: 42, ttlSeconds: THREE_DAYS }]);
  });

  it("counts on the day of the given time", async () => {
    const { store, calls } = createFakeStore();
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    await recordTokens({ store, tenantId: "t1", usage, now: Date.UTC(2026, 11, 31, 23, 59, 59) });
    assert.deepEqual(calls.map((call) => call.key), ["mda:tok:in:t1:2026-12-31", "mda:tok:out:t1:2026-12-31"]);
  });
});

describe("toMicroUsd", () => {
  it("rounds up to whole micro-USD", () => {
    assert.equal(toMicroUsd(0.0012345), 1235);
    assert.equal(toMicroUsd(1e-7), 1);
    assert.equal(toMicroUsd(0.073), 73_000);
  });

  it("does not add a phantom micro-dollar for binary float noise", () => {
    assert.equal(toMicroUsd(0.0003 + 0.0000000000000001), 300);
    assert.equal(toMicroUsd(0.1 + 0.2), 300_000);
  });

  it("is 0 for zero, negative and non-finite amounts", () => {
    for (const value of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(toMicroUsd(value), 0, String(value));
  });
});

describe("getUsageSummary", () => {
  it("reads today's and this month's counters back in USD", async () => {
    const { store, data } = createFakeStore();
    data.set(`mda:req:t1:${DAY}`, "7");
    data.set(`mda:cost:t1:${DAY}`, "1235");
    data.set(`mda:cost:t1:${MONTH}`, "50000");
    data.set(`mda:tok:in:t1:${DAY}`, "1000");
    data.set(`mda:tok:out:t1:${DAY}`, "200");
    const { costTodayUsd, costMonthUsd, ...rest } = await getUsageSummary(store, "t1", NOW);
    assert.deepEqual(rest, {
      day: DAY,
      month: MONTH,
      requestsToday: 7,
      inputTokensToday: 1000,
      outputTokensToday: 200,
      store: "memory",
    });
    // micro-USD → USD; compared with a tolerance because 1235 / 1e6 and 1235 * 1e-6 differ by an ulp.
    assert.ok(Math.abs(costTodayUsd - 0.001235) < 1e-12, String(costTodayUsd));
    assert.ok(Math.abs(costMonthUsd - 0.05) < 1e-12, String(costMonthUsd));
  });

  it("reports zeros for an unused tenant and the store kind", async () => {
    const { store } = createFakeStore("upstash");
    const summary = await getUsageSummary(store, "unused", NOW);
    assert.equal(summary.requestsToday, 0);
    assert.equal(summary.costTodayUsd, 0);
    assert.equal(summary.costMonthUsd, 0);
    assert.equal(summary.inputTokensToday, 0);
    assert.equal(summary.outputTokensToday, 0);
    assert.equal(summary.store, "upstash");
  });
});

describe("logEvent", () => {
  it("prints one JSON line tagged evt=assistant with an ISO timestamp", () => {
    const log = mock.method(console, "log", () => {});
    try {
      logEvent({ route: "chat", tenant: "t1", inTok: 42, ok: true, missing: undefined, stop: null });
      assert.equal(log.mock.callCount(), 1);
      const [line] = log.mock.calls[0].arguments;
      assert.equal(typeof line, "string");
      const parsed = JSON.parse(String(line)) as Record<string, unknown>;
      assert.equal(parsed.evt, "assistant");
      assert.equal(parsed.route, "chat");
      assert.equal(parsed.inTok, 42);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.stop, null);
      assert.ok(!("missing" in parsed));
      assert.equal(typeof parsed.ts, "string");
      assert.equal(new Date(String(parsed.ts)).toISOString(), parsed.ts);
    } finally {
      log.mock.restore();
    }
  });
});
