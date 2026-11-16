// Abuse controls (lib/assistant/server/guard.ts): hashing, client IP, origin policy, UTC keys,
// the fixed-window limiter and the chat allowance gate. Time is injected (`now`), never waited.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  checkChatAllowance,
  clientIp,
  hashId,
  hitWindow,
  isOriginAllowed,
  rateLimitSubject,
  secondsUntilNextUtcDay,
  secondsUntilNextUtcMonth,
  utcDay,
  utcMonth,
} from "@/lib/assistant/server/guard";
import { createFakeStore, makeLimits, makeTenant, withNodeEnv } from "./fixtures";

const API_URL = "https://site.example/api/assistant/chat";
/** 2026-11-15 10:30:00 UTC: 30 min before the hour bucket ends, 13.5 h before the UTC day ends. */
const NOW = Date.UTC(2026, 10, 15, 10, 30, 0);
const DAY = "2026-11-15";
const MONTH = "2026-11";

function request(headers: Record<string, string> = {}, url = API_URL): Request {
  return new Request(url, { method: "POST", headers });
}

describe("hashId", () => {
  it("is sha256(salt + ':' + value) in hex, truncated to 32 characters", () => {
    const expected = createHash("sha256").update("salt-1:203.0.113.7").digest("hex").slice(0, 32);
    assert.equal(hashId("203.0.113.7", "salt-1"), expected);
    assert.match(hashId("x", "y"), /^[0-9a-f]{32}$/);
  });

  it("is deterministic, salt-dependent and value-dependent", () => {
    assert.equal(hashId("203.0.113.7", "salt-1"), hashId("203.0.113.7", "salt-1"));
    assert.notEqual(hashId("203.0.113.7", "salt-1"), hashId("203.0.113.7", "salt-2"));
    assert.notEqual(hashId("203.0.113.7", "salt-1"), hashId("203.0.113.8", "salt-1"));
  });
});

describe("clientIp", () => {
  it("returns null without any IP header", () => {
    assert.equal(clientIp(request()), null);
  });

  it("takes the first, trimmed entry of x-forwarded-for", () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
    assert.equal(clientIp(request({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1, 10.0.0.2" })), "203.0.113.7");
  });

  it("prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", () => {
    const all = { "x-vercel-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2", "x-forwarded-for": "198.51.100.3" };
    assert.equal(clientIp(request(all)), "198.51.100.1");
    assert.equal(clientIp(request({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "198.51.100.3" })), "198.51.100.2");
  });

  it("accepts IPv6 literals and caps the length at 64 characters", () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
    const long = clientIp(request({ "x-forwarded-for": "a:".repeat(60) }));
    assert.ok(long !== null && long.length <= 64, String(long));
  });

  it("rejects junk instead of turning it into a shared bucket", () => {
    for (const junk of ["unknown", "", " , 203.0.113.7", "<script>", "1.2.3", "evil.example", "localhost"]) {
      assert.equal(clientIp(request({ "x-forwarded-for": junk })), null, JSON.stringify(junk));
    }
  });
});

describe("rateLimitSubject", () => {
  const subject = rateLimitSubject;

  it("keeps an IPv4 address as it is (canonical form)", () => {
    assert.equal(subject("203.0.113.7"), "203.0.113.7");
    assert.equal(subject(" 203.0.113.7 "), "203.0.113.7");
    assert.equal(subject("203.000.113.007"), "203.0.113.7");
    assert.notEqual(subject("203.0.113.7"), subject("203.0.113.8"));
  });

  it("drops the port a proxy may append to an IPv4 address", () => {
    assert.equal(subject("203.0.113.7:51234"), "203.0.113.7");
  });

  it("counts an IPv4-mapped IPv6 address as its IPv4 address, in every notation", () => {
    for (const mapped of [
      "::ffff:203.0.113.7",
      "::FFFF:203.0.113.7",
      "0:0:0:0:0:ffff:203.0.113.7",
      "0000:0000:0000:0000:0000:ffff:cb00:7107",
      "::ffff:cb00:7107",
      "[::ffff:203.0.113.7]",
      "[::ffff:203.0.113.7]:443",
      "::ffff:203.0.113.7%eth0",
    ]) {
      assert.equal(subject(mapped), "203.0.113.7", mapped);
    }
  });

  it("counts IPv6 by its /64: every address one subscriber can pick shares one subject", () => {
    const expected = "2001:0db8:abcd:0012::/64";
    for (const address of [
      "2001:db8:abcd:12::1",
      "2001:db8:abcd:12:ffff:ffff:ffff:ffff",
      "2001:db8:abcd:12:1a2b:3c4d:5e6f:7081",
      "2001:0DB8:ABCD:0012:0000:0000:0000:0001",
      "2001:db8:abcd:12::",
      "2001:db8:abcd:12:0:0:0:1",
      "2001:db8:abcd:12::192.0.2.1",
      "[2001:db8:abcd:12::1]",
      "[2001:db8:abcd:12::1]:8443",
      "2001:db8:abcd:12::1%eth0",
      "[2001:db8:abcd:12::1%25eth0]:443",
    ]) {
      assert.equal(subject(address), expected, address);
    }
  });

  it("keeps different /64 prefixes apart", () => {
    const base = subject("2001:db8:abcd:12::1");
    for (const other of ["2001:db8:abcd:13::1", "2001:db8:abcd::1", "2001:db9:abcd:12::1", "2001:db8:abce:12::1"]) {
      assert.notEqual(subject(other), base, other);
    }
  });

  it("expands '::' wherever it stands", () => {
    assert.equal(subject("2001:db8::1"), "2001:0db8:0000:0000::/64");
    assert.equal(subject("::1"), "0000:0000:0000:0000::/64");
    assert.equal(subject("::"), "0000:0000:0000:0000::/64");
    assert.equal(subject("fe80::1"), "fe80:0000:0000:0000::/64");
    assert.equal(subject("1:2:3:4:5:6:7::"), "0001:0002:0003:0004::/64");
    assert.equal(subject("1::8"), "0001:0000:0000:0000::/64");
  });

  it("returns anything that is not an IP address unchanged (a bucket of its own)", () => {
    for (const junk of [
      "a:".repeat(32),
      "1:2:3",
      "1:::2",
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7::8",
      "1::2::3",
      "12345::1",
      "g::1",
      "999.1.1.1",
      "1.2.3.4::",
      ":1:2:3:4:5:6:7",
    ]) {
      assert.equal(subject(junk), junk, junk);
    }
  });

  it("puts one /64 into one rate-limit bucket once hashed, as the routes do", async () => {
    const { store } = createFakeStore();
    const limits = makeLimits({ ipPerMinute: 2, ipPerHour: 100, ipPerDay: 100, maxUserMessagesPerSession: 100 });
    const gate = (ip: string, n: number) =>
      checkChatAllowance({
        store,
        tenantId: "t1",
        limits,
        ipHash: hashId(rateLimitSubject(ip), "salt"),
        sessionId: `session-v6-${String(n).padStart(8, "0")}`,
        now: NOW,
      });
    // A rotating client: a fresh address of its /64 for every request.
    assert.equal((await gate("2001:db8:abcd:12::1", 1)).ok, true);
    assert.equal((await gate("2001:db8:abcd:12::2", 2)).ok, true);
    const third = await gate("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd", 3);
    assert.equal(third.ok ? null : third.code, "rate_limited");
    assert.equal((await gate("2001:db8:abcd:99::1", 4)).ok, true, "another /64 is another visitor");
  });
});

describe("isOriginAllowed", () => {
  const tenant = makeTenant({ allowedOrigins: ["https://www.fixture.example"] });
  const allowed = (origin: string | null, url = API_URL) =>
    isOriginAllowed(request(origin === null ? {} : { origin }, url), tenant);

  it("allows requests without an Origin header (non-browser clients; limits still apply)", () => {
    assert.equal(allowed(null), true);
  });

  it("allows same-origin requests and the tenant's allowed origins", () => {
    assert.equal(allowed("https://site.example"), true);
    assert.equal(allowed("https://www.fixture.example"), true);
  });

  it("rejects foreign, opaque and look-alike origins", () => {
    for (const origin of [
      "https://evil.example",
      "null",
      "http://site.example", // scheme differs
      "https://site.example:8443", // port differs
      "https://site.example.evil.example",
      "https://fixture.example", // not the listed www origin
      "https://www.fixture.example.evil.example",
    ]) {
      assert.equal(allowed(origin), false, origin);
    }
  });

  it("allows localhost and 127.0.0.1 origins only outside production", () => {
    const local = ["http://localhost:3000", "http://127.0.0.1:5173", "https://localhost", "http://localhost"];
    withNodeEnv("development", () => {
      for (const origin of local) assert.equal(allowed(origin), true, `development: ${origin}`);
      for (const origin of ["http://localhost.evil.example", "http://127.0.0.1.nip.io", "http://evil.example"]) {
        assert.equal(allowed(origin), false, `development look-alike: ${origin}`);
      }
    });
    withNodeEnv("production", () => {
      for (const origin of local) assert.equal(allowed(origin), false, `production: ${origin}`);
      // Same-origin still wins when the deployment itself is served from localhost.
      assert.equal(allowed("http://localhost:3000", "http://localhost:3000/api/assistant/chat"), true);
    });
  });
});

describe("utcDay / utcMonth", () => {
  it("format the UTC calendar day and month with zero padding", () => {
    assert.equal(utcDay(Date.UTC(2026, 0, 5, 12)), "2026-01-05");
    assert.equal(utcMonth(Date.UTC(2026, 0, 5, 12)), "2026-01");
    assert.equal(utcDay(NOW), DAY);
    assert.equal(utcMonth(NOW), MONTH);
  });

  it("use UTC, not local or Zurich time, around midnight", () => {
    // 23:30 UTC is already the next day in Zurich; the budget day must not move.
    assert.equal(utcDay(Date.UTC(2026, 10, 15, 23, 30)), "2026-11-15");
    assert.equal(utcMonth(Date.UTC(2026, 10, 30, 23, 59, 59)), "2026-11");
    assert.equal(utcDay(Date.UTC(2026, 11, 1, 0, 0, 0)), "2026-12-01");
  });

  it("default to the current time", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2027, 1, 28, 23, 59, 59) });
    assert.equal(utcDay(), "2027-02-28");
    assert.equal(utcMonth(), "2027-02");
  });
});

describe("secondsUntilNextUtcDay / secondsUntilNextUtcMonth", () => {
  it("count the seconds to the next UTC day and month, rounded up", () => {
    assert.equal(secondsUntilNextUtcDay(NOW), 48_600);
    assert.equal(secondsUntilNextUtcMonth(NOW), 15 * 86_400 + 48_600);
    assert.equal(secondsUntilNextUtcDay(Date.UTC(2026, 10, 15)), 86_400);
    assert.equal(secondsUntilNextUtcMonth(Date.UTC(2026, 11, 31, 12)), 12 * 3600, "December rolls over into the next year");
  });

  it("never answer less than 1 second", () => {
    assert.equal(secondsUntilNextUtcDay(Date.UTC(2026, 10, 16) - 1), 1);
    assert.equal(secondsUntilNextUtcMonth(Date.UTC(2026, 11, 1) - 1), 1);
  });
});

describe("hitWindow", () => {
  // 60_015_000 ms = bucket 1000 of a 60 s window, 45 s before it ends.
  const T = 60_015_000;

  it("allows up to the limit, then denies with the seconds left in the window", async () => {
    const { store } = createFakeStore();
    assert.deepEqual(pick(await hitWindow(store, "chat:ip:abc", 2, 60, T)), { allowed: true, count: 1 });
    assert.deepEqual(pick(await hitWindow(store, "chat:ip:abc", 2, 60, T)), { allowed: true, count: 2 });
    const denied = await hitWindow(store, "chat:ip:abc", 2, 60, T);
    assert.deepEqual(denied, { allowed: false, count: 3, retryAfter: 45 });
  });

  it("uses the contract key `mda:rl:${key}:${bucket}` with TTL windowSeconds + 5", async () => {
    const { store, calls } = createFakeStore();
    await hitWindow(store, "lead:t1:ip:abc", 5, 60, T);
    assert.deepEqual(calls[0], { op: "incrBy", key: "mda:rl:lead:t1:ip:abc:1000", by: 1, ttlSeconds: 65 });
  });

  it("starts a fresh count in the next window", async () => {
    const { store } = createFakeStore();
    await hitWindow(store, "k", 1, 60, T);
    assert.equal((await hitWindow(store, "k", 1, 60, T)).allowed, false);
    const next = await hitWindow(store, "k", 1, 60, 60_060_000);
    assert.deepEqual(pick(next), { allowed: true, count: 1 });
  });

  it("reports retryAfter of at least 1 second, up to the full window", async () => {
    // Limit 0 denies the first hit, so retryAfter is always computed.
    const { store } = createFakeStore();
    assert.equal((await hitWindow(store, "edge", 0, 60, 60_059_999)).retryAfter, 1);
    assert.equal((await hitWindow(store, "start", 0, 60, 60_000_000)).retryAfter, 60);
    assert.equal((await hitWindow(store, "hour", 0, 3600, NOW)).retryAfter, 1800);
  });

  function pick(result: { allowed: boolean; count: number }) {
    return { allowed: result.allowed, count: result.count };
  }
});

describe("checkChatAllowance", () => {
  const open = { ipPerMinute: 100, ipPerHour: 100, ipPerDay: 100, maxUserMessagesPerSession: 100, tenantRequestsPerDay: 100 };
  let session = 0;
  const nextSession = () => `session-${String((session += 1)).padStart(12, "0")}`;

  it("allows a first message and reports the session messages left after it", async () => {
    const { store, data } = createFakeStore();
    const limits = makeLimits({ ...open, maxUserMessagesPerSession: 30 });
    const gate = await checkChatAllowance({ store, tenantId: "t1", limits, ipHash: "iphash", sessionId: "s-abcdefghijklmnop", now: NOW });
    assert.deepEqual(gate, { ok: true, remaining: 29 });
    assert.equal(data.get("mda:sess:t1:s-abcdefghijklmnop"), "1");
    assert.equal(data.get(`mda:req:t1:${DAY}`), "1");
  });

  it("keeps the session counter for 24 hours", async () => {
    const { store, calls } = createFakeStore();
    await checkChatAllowance({ store, tenantId: "t1", limits: makeLimits(open), ipHash: null, sessionId: "s-ttl-0123456789", now: NOW });
    const sessionCall = calls.find((call) => call.op === "incrBy" && call.key === "mda:sess:t1:s-ttl-0123456789");
    assert.equal(sessionCall?.ttlSeconds, 86_400);
  });

  it("enforces the per-session message cap", async () => {
    const { store } = createFakeStore();
    const limits = makeLimits({ ...open, maxUserMessagesPerSession: 2 });
    const args = { store, tenantId: "t1", limits, ipHash: null, sessionId: "s-cap-0123456789", now: NOW };
    assert.deepEqual(await checkChatAllowance(args), { ok: true, remaining: 1 });
    assert.deepEqual(await checkChatAllowance(args), { ok: true, remaining: 0 });
    const denied = await checkChatAllowance(args);
    assert.equal(denied.ok, false);
    assert.equal(denied.ok ? null : denied.code, "session_limit");
  });

  it("enforces the per-IP minute, hour and day windows with the matching retryAfter", async () => {
    const cases = [
      { limit: { ipPerMinute: 2 }, retryAfter: 60 },
      { limit: { ipPerHour: 2 }, retryAfter: 1800 },
      { limit: { ipPerDay: 2 }, retryAfter: 48_600 },
    ];
    for (const { limit, retryAfter } of cases) {
      const { store } = createFakeStore();
      const limits = makeLimits({ ...open, ...limit });
      const call = () => checkChatAllowance({ store, tenantId: "t1", limits, ipHash: "iphash", sessionId: nextSession(), now: NOW });
      assert.equal((await call()).ok, true);
      assert.equal((await call()).ok, true);
      assert.deepEqual(await call(), { ok: false, code: "rate_limited", retryAfter }, JSON.stringify(limit));
    }
  });

  it("skips IP limits when the IP is unknown (ipHash null)", async () => {
    const { store } = createFakeStore();
    const limits = makeLimits({ ...open, ipPerMinute: 1, ipPerHour: 1, ipPerDay: 1 });
    for (let i = 0; i < 3; i += 1) {
      const gate = await checkChatAllowance({ store, tenantId: "t1", limits, ipHash: null, sessionId: nextSession(), now: NOW });
      assert.equal(gate.ok, true);
    }
  });

  it("checks IP limits before the session cap", async () => {
    const { store } = createFakeStore();
    const limits = makeLimits({ ...open, ipPerMinute: 1, maxUserMessagesPerSession: 1 });
    const args = { store, tenantId: "t1", limits, ipHash: "iphash", sessionId: "s-order-012345678", now: NOW };
    assert.equal((await checkChatAllowance(args)).ok, true);
    const denied = await checkChatAllowance(args);
    assert.equal(denied.ok ? null : denied.code, "rate_limited");
  });

  it("enforces the tenant's daily request cap as budget_exhausted", async () => {
    const { store } = createFakeStore();
    const limits = makeLimits({ ...open, tenantRequestsPerDay: 2 });
    const call = () => checkChatAllowance({ store, tenantId: "t1", limits, ipHash: null, sessionId: nextSession(), now: NOW });
    assert.equal((await call()).ok, true);
    assert.equal((await call()).ok, true);
    const denied = await call();
    assert.equal(denied.ok ? null : denied.code, "budget_exhausted");
  });

  it("denies once the daily spend (integer micro-USD) exceeds the daily budget", async () => {
    const limits = makeLimits({ ...open, tenantBudgetUsdPerDay: 1, tenantBudgetUsdPerMonth: 15 });
    const under = createFakeStore();
    under.data.set(`mda:cost:t1:${DAY}`, String(500_000));
    const ok = await checkChatAllowance({ store: under.store, tenantId: "t1", limits, ipHash: null, sessionId: nextSession(), now: NOW });
    assert.equal(ok.ok, true);

    const over = createFakeStore();
    over.data.set(`mda:cost:t1:${DAY}`, String(1_000_001));
    const denied = await checkChatAllowance({ store: over.store, tenantId: "t1", limits, ipHash: null, sessionId: nextSession(), now: NOW });
    assert.equal(denied.ok ? null : denied.code, "budget_exhausted");
  });

  it("denies once the monthly spend exceeds the monthly budget, even on a fresh day", async () => {
    const limits = makeLimits({ ...open, tenantBudgetUsdPerDay: 1, tenantBudgetUsdPerMonth: 15 });
    const { store, data } = createFakeStore();
    data.set(`mda:cost:t1:${MONTH}`, String(15_000_001));
    const denied = await checkChatAllowance({ store, tenantId: "t1", limits, ipHash: null, sessionId: nextSession(), now: NOW });
    assert.equal(denied.ok ? null : denied.code, "budget_exhausted");
  });

  it("answers with the Retry-After of the budget that ran out, the month's when both did", async () => {
    const limits = makeLimits({ ...open, tenantBudgetUsdPerDay: 1, tenantBudgetUsdPerMonth: 15 });
    const toNextDay = 48_600;
    const toNextMonth = 15 * 86_400 + 48_600;
    const cases = [
      { day: 1_000_000, month: 2_000_000, retryAfter: toNextDay },
      { day: 0, month: 15_000_000, retryAfter: toNextMonth },
      { day: 1_000_000, month: 15_000_000, retryAfter: toNextMonth },
    ];
    for (const { day, month, retryAfter } of cases) {
      const { store, data } = createFakeStore();
      data.set(`mda:cost:t1:${DAY}`, String(day));
      data.set(`mda:cost:t1:${MONTH}`, String(month));
      const denied = await checkChatAllowance({ store, tenantId: "t1", limits, ipHash: null, sessionId: nextSession(), now: NOW });
      assert.deepEqual(denied, { ok: false, code: "budget_exhausted", retryAfter }, JSON.stringify({ day, month }));
    }
  });

  it("keeps budgets per tenant", async () => {
    const limits = makeLimits({ ...open, tenantBudgetUsdPerDay: 1 });
    const { store, data } = createFakeStore();
    data.set(`mda:cost:spent:${DAY}`, String(5_000_000));
    const other = await checkChatAllowance({ store, tenantId: "fresh", limits, ipHash: null, sessionId: nextSession(), now: NOW });
    assert.equal(other.ok, true);
  });
});
