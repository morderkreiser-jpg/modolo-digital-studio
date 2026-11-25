// Incoming provider webhooks (lib/voice/server/webhook.ts): signature over the raw body, missing
// and malformed headers, stale and future timestamps, foreign secrets, and replay protection.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { createMemoryStore } from "@/lib/assistant/server/store";
import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS, seenBefore, signWebhook, verifyWebhook } from "@/lib/voice/server/webhook";
import { createFakeStore } from "../assistant/fixtures";

const SECRET = "whsec_test_0123456789abcdef";
/** 2026-11-25 12:00:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const TS = NOW / 1000;
const BODY = '{"type":"tool_call","id":"call_1","name":"check_availability","input":{"date":"2026-12-03"}}';

function verify(overrides: Partial<Parameters<typeof verifyWebhook>[0]> = {}) {
  return verifyWebhook({
    secret: SECRET,
    timestampHeader: String(TS),
    signatureHeader: signWebhook(SECRET, TS, BODY),
    rawBody: BODY,
    now: NOW,
    ...overrides,
  });
}

describe("signWebhook", () => {
  it("is the hex HMAC-SHA256 of timestamp + '.' + raw body", () => {
    const expected = createHmac("sha256", SECRET).update(`${TS}.${BODY}`).digest("hex");
    assert.equal(signWebhook(SECRET, TS, BODY), expected);
    assert.match(signWebhook(SECRET, TS, BODY), /^[0-9a-f]{64}$/);
  });
});

describe("verifyWebhook", () => {
  it("accepts a correctly signed, fresh delivery", () => {
    assert.deepEqual(verify(), { ok: true });
  });

  it("accepts the sha256= prefix, upper-case hex and surrounding spaces", () => {
    const signature = signWebhook(SECRET, TS, BODY);
    assert.deepEqual(verify({ signatureHeader: `sha256=${signature}` }), { ok: true });
    assert.deepEqual(verify({ signatureHeader: signature.toUpperCase() }), { ok: true });
    assert.deepEqual(verify({ signatureHeader: ` ${signature} `, timestampHeader: ` ${TS} ` }), { ok: true });
  });

  it("reports missing headers", () => {
    for (const overrides of [
      { timestampHeader: null },
      { signatureHeader: null },
      { timestampHeader: "" },
      { signatureHeader: "  " },
    ]) {
      assert.deepEqual(verify(overrides), { ok: false, reason: "missing" }, JSON.stringify(overrides));
    }
  });

  it("reports malformed headers", () => {
    const signature = signWebhook(SECRET, TS, BODY);
    for (const overrides of [
      { timestampHeader: "yesterday" },
      { timestampHeader: `${TS}.5` },
      { timestampHeader: `-${TS}` },
      { timestampHeader: String(NOW) }, // milliseconds, 13 digits
      { signatureHeader: signature.slice(0, 63) },
      { signatureHeader: `${signature}0` },
      { signatureHeader: signature.replace(/[0-9a-f]$/, "g") },
      { signatureHeader: `md5=${signature}` },
      { signatureHeader: `${signature},${signature}` },
    ]) {
      assert.deepEqual(verify(overrides), { ok: false, reason: "malformed" }, JSON.stringify(overrides));
    }
  });

  it("refuses timestamps outside the tolerance, in the past and in the future", () => {
    const tolerance = DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
    for (const offset of [-tolerance - 1, tolerance + 1, -86_400, 86_400 * 365]) {
      const ts = TS + offset;
      const result = verify({ timestampHeader: String(ts), signatureHeader: signWebhook(SECRET, ts, BODY) });
      assert.deepEqual(result, { ok: false, reason: "stale" }, String(offset));
    }
    for (const offset of [-tolerance, tolerance]) {
      const ts = TS + offset;
      assert.deepEqual(verify({ timestampHeader: String(ts), signatureHeader: signWebhook(SECRET, ts, BODY) }), { ok: true });
    }
  });

  it("honours a custom tolerance", () => {
    const ts = TS - 61;
    const signed = { timestampHeader: String(ts), signatureHeader: signWebhook(SECRET, ts, BODY) };
    assert.deepEqual(verify({ ...signed, toleranceSeconds: 60 }), { ok: false, reason: "stale" });
    assert.deepEqual(verify({ ...signed, toleranceSeconds: 120 }), { ok: true });
    // Junk tolerance falls back to the default.
    assert.deepEqual(verify({ ...signed, toleranceSeconds: Number.NaN }), { ok: true });
  });

  it("refuses a changed body, even by one character or by re-serialising the same JSON", () => {
    assert.deepEqual(verify({ rawBody: BODY.replace("2026-12-03", "2026-12-04") }), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verify({ rawBody: `${BODY} ` }), { ok: false, reason: "bad_signature" });
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 1);
    assert.deepEqual(verify({ rawBody: reserialised }), { ok: false, reason: "bad_signature" });
  });

  it("refuses a signature for another timestamp", () => {
    const signature = signWebhook(SECRET, TS - 10, BODY);
    assert.deepEqual(verify({ signatureHeader: signature }), { ok: false, reason: "bad_signature" });
  });

  it("refuses a signature made with another secret", () => {
    const signature = signWebhook("whsec_other_0123456789abcdef", TS, BODY);
    assert.deepEqual(verify({ signatureHeader: signature }), { ok: false, reason: "bad_signature" });
  });

  it("fails closed when our own secret is missing or too short", () => {
    for (const secret of ["", "short", undefined as unknown as string]) {
      const signature = signWebhook(secret ?? "", TS, BODY);
      assert.deepEqual(verify({ secret, signatureHeader: signature }), { ok: false, reason: "bad_signature" });
    }
  });

  it("uses the real clock by default", () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyWebhook({
      secret: SECRET,
      timestampHeader: String(ts),
      signatureHeader: signWebhook(SECRET, ts, BODY),
      rawBody: BODY,
    });
    assert.deepEqual(result, { ok: true });
  });
});

describe("seenBefore", () => {
  it("is false the first time and true for every repeat", async () => {
    const store = createMemoryStore();
    assert.equal(await seenBefore(store, "evt_1", 3600), false);
    assert.equal(await seenBefore(store, "evt_1", 3600), true);
    assert.equal(await seenBefore(store, "evt_1", 3600), true);
    assert.equal(await seenBefore(store, "evt_2", 3600), false);
  });

  it("lets only one of two parallel deliveries through", async () => {
    const store = createMemoryStore();
    const results = await Promise.all([seenBefore(store, "evt_x", 3600), seenBefore(store, "evt_x", 3600)]);
    assert.deepEqual(results.sort(), [false, true]);
  });

  it("treats an empty id as seen: it cannot be deduplicated", async () => {
    const { store, calls } = createFakeStore();
    assert.equal(await seenBefore(store, "", 3600), true);
    assert.equal(calls.length, 0);
  });

  it("hashes the id into an mva: key and keeps the TTL within bounds", async () => {
    const { store, calls } = createFakeStore();
    const id = "a very long id with spaces, colons: and more ".repeat(20);
    await seenBefore(store, id, 1);
    await seenBefore(store, "evt_2", 1e9);
    await seenBefore(store, "evt_3", Number.NaN);
    assert.match(calls[0].key, /^mva:wh:[0-9a-f]{32}$/);
    assert.ok(!calls[0].key.includes("spaces"));
    assert.equal(calls[0].ttlSeconds, 600);
    assert.equal(calls[1].ttlSeconds, 30 * 86_400);
    assert.equal(calls[2].ttlSeconds, 600);
  });

  it("closes the replay window together with verifyWebhook", async () => {
    const store = createMemoryStore();
    const delivery = { signatureHeader: signWebhook(SECRET, TS, BODY), timestampHeader: String(TS), rawBody: BODY };
    // First delivery: authentic and new.
    assert.deepEqual(verify(delivery), { ok: true });
    assert.equal(await seenBefore(store, "mock:call_1", 2 * DEFAULT_WEBHOOK_TOLERANCE_SECONDS), false);
    // The same request captured and replayed a minute later: still authentic, but already seen.
    assert.deepEqual(verify({ ...delivery, now: NOW + 60_000 }), { ok: true });
    assert.equal(await seenBefore(store, "mock:call_1", 2 * DEFAULT_WEBHOOK_TOLERANCE_SECONDS), true);
    // Replayed after the tolerance: refused before the store is even asked.
    assert.deepEqual(verify({ ...delivery, now: NOW + (DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 1) * 1000 }), {
      ok: false,
      reason: "stale",
    });
  });
});
