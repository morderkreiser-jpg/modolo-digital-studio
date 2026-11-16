// In-memory KV store (lib/assistant/server/store.ts): counters, TTLs, the key cap and the
// process singleton. The Upstash REST variant has its own file (store-upstash.test.ts) because
// getStore() picks its backend once per process.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createMemoryStore, getStore } from "@/lib/assistant/server/store";
import { setAssistantEnv } from "./fixtures";

async function liveKeys(store: ReturnType<typeof createMemoryStore>, keys: string[]): Promise<number> {
  let live = 0;
  for (const key of keys) if ((await store.get(key)) !== null) live += 1;
  return live;
}

describe("createMemoryStore", () => {
  it("is a memory-kind store", () => {
    assert.equal(createMemoryStore().kind, "memory");
  });

  it("incrBy creates a missing key at `by`, then accumulates (micro-USD sized steps too)", async () => {
    const store = createMemoryStore();
    assert.equal(await store.incrBy("mda:test:a", 1, 60), 1);
    assert.equal(await store.incrBy("mda:test:a", 2, 60), 3);
    assert.equal(await store.incrBy("mda:test:a", 1_500_000, 60), 1_500_003);
    assert.equal(Number(await store.get("mda:test:a")), 1_500_003);
  });

  it("incrBy takes negative whole-number deltas, like Redis INCRBY (spend settlements)", async () => {
    const store = createMemoryStore();
    assert.equal(await store.incrBy("mda:test:settle", 1835, 60), 1835);
    assert.equal(await store.incrBy("mda:test:settle", -1727, 60), 108);
    assert.equal(await store.incrBy("mda:test:settle", -108, 60), 0);
    assert.equal(await store.incrBy("mda:test:settle", -2.9, 60), -2, "fractions are truncated toward zero");
    assert.equal(await store.get("mda:test:settle"), "-2");
    assert.equal(await store.incrBy("mda:test:fresh", -5, 60), -5, "a missing key starts from zero");
  });

  it("counts concurrent increments exactly once each", async () => {
    const store = createMemoryStore();
    const results = await Promise.all(Array.from({ length: 50 }, () => store.incrBy("mda:test:burst", 1, 60)));
    assert.deepEqual(
      [...results].sort((a, b) => a - b),
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    assert.equal(Number(await store.get("mda:test:burst")), 50);
  });

  it("get returns null for missing keys; set stores, overwrites and reports success", async () => {
    const store = createMemoryStore();
    assert.equal(await store.get("mda:test:missing"), null);
    assert.equal(await store.set("mda:test:s", "one", 60), true);
    assert.equal(await store.get("mda:test:s"), "one");
    assert.equal(await store.set("mda:test:s", '{"json":true}', 60), true);
    assert.equal(await store.get("mda:test:s"), '{"json":true}');
    assert.equal(await store.get("mda:test:other"), null);
  });

  it("expires keys after their TTL; incrBy sets the TTL only when it creates the key", async () => {
    const store = createMemoryStore();
    await store.set("mda:test:short", "v", 1);
    await store.set("mda:test:renewed", "old", 1);
    await store.set("mda:test:renewed", "new", 3600); // SET replaces value and TTL
    await store.set("mda:test:long", "kept", 3600);
    assert.equal(await store.incrBy("mda:test:counter", 1, 1), 1);
    // Existing key: the TTL stays the one set at creation (SET ... NX + INCRBY semantics).
    assert.equal(await store.incrBy("mda:test:counter", 1, 3600), 2);
    assert.equal(await store.get("mda:test:short"), "v");

    await delay(1300);

    assert.equal(await store.get("mda:test:short"), null);
    assert.equal(await store.get("mda:test:counter"), null, "incrBy must not extend the TTL of an existing key");
    assert.equal(await store.incrBy("mda:test:counter", 5, 60), 5, "an expired counter restarts from zero");
    assert.equal(await store.get("mda:test:renewed"), "new");
    assert.equal(await store.get("mda:test:long"), "kept");
  });

  it("is bounded: never holds more than maxKeys keys and keeps counting the active one", async () => {
    const store = createMemoryStore(5);
    const keys = Array.from({ length: 20 }, (_, i) => `mda:test:k${i}`);
    for (const key of keys) await store.set(key, "1", 3600);
    const live = await liveKeys(store, keys);
    assert.ok(live >= 1 && live <= 5, `live keys after overflow: ${live}`);
    // A full store must not silently stop counting (that would disable rate limits under a flood).
    assert.equal(await store.incrBy("mda:test:hot", 1, 3600), 1);
    assert.equal(await store.incrBy("mda:test:hot", 1, 3600), 2);
  });

  it("defaults to a 10 000-key bound", async () => {
    const store = createMemoryStore();
    const keys = Array.from({ length: 10_100 }, (_, i) => `mda:test:d${i}`);
    for (const key of keys) await store.set(key, "1", 3600);
    const live = await liveKeys(store, keys);
    assert.ok(live >= 1 && live <= 10_000, `live keys: ${live}`);
  });
});

describe("getStore", () => {
  it("returns one memory store per process when no Upstash env is configured", () => {
    const restore = setAssistantEnv({});
    try {
      const first = getStore();
      assert.equal(first.kind, "memory");
      assert.equal(getStore(), first);
    } finally {
      restore();
    }
  });
});
