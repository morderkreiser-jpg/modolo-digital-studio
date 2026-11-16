// Upstash REST backend of getStore() (lib/assistant/server/store.ts), with fetch stubbed: the
// exact pipeline wire format from the contract, and "never throws" fallback on any failure.
// Separate file because getStore() chooses its backend once per process (node --test runs each
// file in its own process).
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { getStore } from "@/lib/assistant/server/store";
import type { KVStore } from "@/lib/assistant/server/store";
import { setAssistantEnv } from "./fixtures";

const KV_URL = "https://kv.fixture.example";
const KV_TOKEN = "kv-fixture-token-123";

interface PipelineCall {
  url: string;
  method: string;
  authorization: string | null;
  commands: string[][];
  hasSignal: boolean;
}

let calls: PipelineCall[] = [];
let reply: (commands: string[][]) => Promise<Response> = async () => Response.json([]);

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const parsed: unknown = JSON.parse(await request.text());
  const commands = Array.isArray(parsed) ? parsed.map((cmd) => (Array.isArray(cmd) ? cmd.map(String) : [])) : [];
  calls.push({
    url: request.url,
    method: request.method,
    authorization: request.headers.get("authorization"),
    commands,
    hasSignal: init?.signal instanceof AbortSignal,
  });
  return reply(commands);
}

let store: KVStore;
let restoreEnv: () => void;

before(() => {
  restoreEnv = setAssistantEnv({ KV_REST_API_URL: KV_URL, KV_REST_API_TOKEN: KV_TOKEN });
  mock.method(globalThis, "fetch", fakeFetch);
  store = getStore();
});

after(() => {
  mock.restoreAll();
  restoreEnv();
});

function lastCall(): PipelineCall {
  const call = calls.at(-1);
  assert.ok(call, "expected a request to the Upstash REST API");
  return call;
}

describe("getStore() with Upstash configured", () => {
  it("is an upstash-kind store", () => {
    assert.equal(store.kind, "upstash");
  });

  it("incrBy sends SET NX with TTL + INCRBY in one authenticated pipeline call", async () => {
    calls = [];
    reply = async () => Response.json([{ result: "OK" }, { result: 3 }]);
    assert.equal(await store.incrBy("mda:test:k", 3, 60), 3);
    assert.equal(calls.length, 1);
    const call = lastCall();
    assert.equal(call.url, `${KV_URL}/pipeline`);
    assert.equal(call.method, "POST");
    assert.equal(call.authorization, `Bearer ${KV_TOKEN}`);
    assert.deepEqual(call.commands, [
      ["SET", "mda:test:k", "0", "EX", "60", "NX"],
      ["INCRBY", "mda:test:k", "3"],
    ]);
    assert.ok(call.hasSignal, "the request needs a timeout signal (contract: 2 s)");
  });

  it("incrBy returns the INCRBY result when the key already existed (SET NX → null)", async () => {
    reply = async () => Response.json([{ result: null }, { result: 7 }]);
    assert.equal(await store.incrBy("mda:test:k", 1, 60), 7);
  });

  it("incrBy sends a negative delta as a signed INCRBY (spend settlements)", async () => {
    calls = [];
    reply = async () => Response.json([{ result: null }, { result: 108 }]);
    assert.equal(await store.incrBy("mda:test:settle", -1727, 86_400), 108);
    assert.deepEqual(lastCall().commands, [
      ["SET", "mda:test:settle", "0", "EX", "86400", "NX"],
      ["INCRBY", "mda:test:settle", "-1727"],
    ]);
    reply = async () => Response.json([{ result: null }, { result: "-2" }]);
    assert.equal(await store.incrBy("mda:test:settle", -2.9, 60), -2, "a string reply is parsed, sign included");
    assert.deepEqual(lastCall().commands[1], ["INCRBY", "mda:test:settle", "-2"], "fractions are truncated toward zero");
  });

  it("get uses the pipeline endpoint and returns the value or null", async () => {
    calls = [];
    reply = async () => Response.json([{ result: "42" }]);
    assert.equal(await store.get("mda:test:g"), "42");
    assert.equal(lastCall().url, `${KV_URL}/pipeline`);
    assert.deepEqual(lastCall().commands, [["GET", "mda:test:g"]]);
    reply = async () => Response.json([{ result: null }]);
    assert.equal(await store.get("mda:test:g"), null);
  });

  it("set sends SET with EX and reports success", async () => {
    calls = [];
    reply = async () => Response.json([{ result: "OK" }]);
    assert.equal(await store.set("mda:test:s", '{"a":1}', 120), true);
    assert.deepEqual(lastCall().commands, [["SET", "mda:test:s", '{"a":1}', "EX", "120"]]);
    assert.equal(lastCall().authorization, `Bearer ${KV_TOKEN}`);
  });

  // Failure tests last: an implementation may stay on its in-memory fallback after a failure.
  it("never throws on network errors, HTTP errors, bad JSON or Redis errors; keeps counting in memory", async () => {
    const logs = [mock.method(console, "log", () => {}), mock.method(console, "warn", () => {}), mock.method(console, "error", () => {})];
    const failures: Array<() => Promise<Response>> = [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("upstream down", { status: 500 }),
      async () => new Response("<html>not json</html>", { status: 200 }),
      async () => Response.json([{ error: "ERR wrong number of arguments" }, { error: "ERR" }]),
    ];
    try {
      for (const [i, failure] of failures.entries()) {
        reply = failure;
        const key = `mda:test:fallback:${i}`;
        const first = await store.incrBy(key, 1, 60);
        const second = await store.incrBy(key, 1, 60);
        assert.ok(Number.isFinite(first) && first >= 1, `failure ${i}: incrBy returned ${first}`);
        assert.equal(second, first + 1, `failure ${i}: the in-memory fallback must keep counting`);
        const value = await store.get(key);
        assert.ok(value === null || typeof value === "string", `failure ${i}: get returned ${String(value)}`);
        assert.equal(typeof (await store.set(`${key}:s`, "v", 60)), "boolean", `failure ${i}: set must resolve a boolean`);
      }
      const logged = logs.reduce((sum, method) => sum + method.mock.callCount(), 0);
      assert.ok(logged <= 1, `contract: Upstash failures are logged once, got ${logged} log lines`);
    } finally {
      for (const method of logs) method.mock.restore();
    }
  });
});
