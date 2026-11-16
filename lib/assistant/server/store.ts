// Tiny key-value store behind the assistant's counters (rate limits, sessions, spend) and the
// optional stored copy of quote requests. Server-only.
//
//   memory  — the default. Per process, like lib/rate-limit.ts: on Vercel a burst usually lands on
//             a few warm instances and IS counted, but a fresh instance starts from zero. A
//             dampener, not a guarantee.
//   upstash — Upstash Redis through its REST API (Vercel KV speaks the same API), shared by every
//             instance. Plain fetch, no SDK.
//
// The store NEVER throws. When Upstash fails, counters are served by the in-memory store and
// Upstash is retried after a short cool-down, so an outage degrades limits to per-instance instead
// of breaking (or slowing down) the chat. `set` is the one exception to the fallback: it reports
// failure instead, because its caller stores personal data (quote requests) that must never sit
// in process memory.
//
// Keys are namespaced ("mda:...") by the callers, not here.
import { getAssistantEnv, type AssistantEnv } from "./env";
import { logEvent } from "./usage";

export interface KVStore {
  readonly kind: "memory" | "upstash";
  /**
   * Atomic increment by a whole number, which may be negative (the settlement of a spend
   * reservation gives back what a reply did not use); creates the key with the TTL when absent.
   * Returns the new value.
   */
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  /** false when the value could not be stored. */
  set(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

const DEFAULT_MAX_KEYS = 10_000;
const REMOTE_TIMEOUT_MS = 2_000;
// After an Upstash failure, skip it for a while: with a 2 s timeout per call and several counters
// per chat request, retrying on every call during an outage would add seconds to each answer.
const REMOTE_COOL_DOWN_MS = 30_000;
const FAILURE_LOG_INTERVAL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------------------------

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * Bounded in-memory store with lazy expiry. When full it drops expired keys first, then the least
 * recently used ones: the few hot accounting keys (today's spend, request count) are touched on
 * every request and survive a flood of one-off session/IP keys.
 */
export function createMemoryStore(maxKeys: number = DEFAULT_MAX_KEYS): KVStore {
  const capacity = Number.isFinite(maxKeys) ? Math.max(1, Math.floor(maxKeys)) : DEFAULT_MAX_KEYS;
  // Map iteration order is insertion order; re-inserting on access turns it into LRU order.
  const entries = new Map<string, MemoryEntry>();

  function read(key: string, now: number): MemoryEntry | null {
    const entry = entries.get(key);
    if (!entry) return null;
    entries.delete(key);
    if (entry.expiresAt <= now) return null;
    entries.set(key, entry);
    return entry;
  }

  function write(key: string, entry: MemoryEntry, now: number): void {
    entries.delete(key);
    if (entries.size >= capacity) makeRoom(now);
    entries.set(key, entry);
  }

  // Frees a small batch (1%) at once so that a stream of new keys does not pay for a full sweep
  // on every single insert.
  function makeRoom(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    const target = capacity - Math.max(1, Math.floor(capacity / 100));
    for (const key of entries.keys()) {
      if (entries.size <= target) break;
      entries.delete(key);
    }
  }

  return {
    kind: "memory",
    async incrBy(key, by, ttlSeconds) {
      const now = Date.now();
      const current = read(key, now);
      const value = (current ? toInteger(current.value) : 0) + toDelta(by);
      // Like Redis INCRBY, an existing key keeps its original expiry.
      const expiresAt = current ? current.expiresAt : now + toTtlSeconds(ttlSeconds) * 1000;
      write(key, { value: String(value), expiresAt }, now);
      return value;
    },
    async get(key) {
      return read(key, Date.now())?.value ?? null;
    },
    async set(key, value, ttlSeconds) {
      const now = Date.now();
      write(key, { value, expiresAt: now + toTtlSeconds(ttlSeconds) * 1000 }, now);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Upstash REST store (throws on failure; only ever used through the resilient wrapper)
// ---------------------------------------------------------------------------------------------

interface RemoteStore {
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

/** Why a remote call failed, as a short code that is safe to log (no URL, no token). */
class StoreFailure extends Error {
  reason: string;

  constructor(reason: string) {
    super(`Upstash store failure: ${reason}`);
    this.name = "StoreFailure";
    this.reason = reason;
  }
}

function createUpstashStore(baseUrl: string, token: string): RemoteStore {
  const endpoint = `${baseUrl}/pipeline`;

  // One HTTP round trip per operation: the pipeline endpoint takes an array of commands and
  // answers with an array of {result} | {error}, in order.
  async function pipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StoreFailure(isTimeout(error) ? "timeout" : "network");
    }
    if (!response.ok) {
      // Release the connection: an unread body keeps it busy until garbage collection.
      response.body?.cancel().catch(() => undefined);
      throw new StoreFailure(`http_${response.status}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new StoreFailure(isTimeout(error) ? "timeout" : "bad_response");
    }
    if (!Array.isArray(payload) || payload.length !== commands.length) {
      throw new StoreFailure("bad_response");
    }
    return payload.map((item: unknown) => {
      if (!isRecord(item)) throw new StoreFailure("bad_response");
      if (item.error !== undefined && item.error !== null) throw new StoreFailure("command_error");
      if (!("result" in item)) throw new StoreFailure("bad_response");
      return item.result;
    });
  }

  return {
    async incrBy(key, by, ttlSeconds) {
      // SET NX creates the key with its TTL only when absent; INCRBY then never touches the TTL.
      const [, count] = await pipeline([
        ["SET", key, "0", "EX", toTtlSeconds(ttlSeconds), "NX"],
        ["INCRBY", key, toDelta(by)],
      ]);
      const value = typeof count === "number" ? count : typeof count === "string" ? Number(count) : NaN;
      if (!Number.isFinite(value)) throw new StoreFailure("bad_response");
      return value;
    },
    async get(key) {
      const [value] = await pipeline([["GET", key]]);
      if (value === null) return null;
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      throw new StoreFailure("bad_response");
    },
    async set(key, value, ttlSeconds) {
      const [result] = await pipeline([["SET", key, value, "EX", toTtlSeconds(ttlSeconds)]]);
      return result === "OK";
    },
  };
}

function createResilientStore(remote: RemoteStore, fallback: KVStore): KVStore {
  let pausedUntil = 0;
  let lastLoggedAt = Number.NEGATIVE_INFINITY;
  let unloggedFailures = 0;

  function remoteAvailable(): boolean {
    return Date.now() >= pausedUntil;
  }

  // Logged once per outage window, never with the URL or the token.
  function trip(op: string, error: unknown): void {
    const now = Date.now();
    pausedUntil = now + REMOTE_COOL_DOWN_MS;
    unloggedFailures += 1;
    if (now - lastLoggedAt < FAILURE_LOG_INTERVAL_MS) return;
    logEvent({
      warn: "store_fallback",
      op,
      reason: error instanceof StoreFailure ? error.reason : "unexpected",
      failures: unloggedFailures,
    });
    lastLoggedAt = now;
    unloggedFailures = 0;
  }

  return {
    kind: "upstash",
    async incrBy(key, by, ttlSeconds) {
      if (remoteAvailable()) {
        try {
          return await remote.incrBy(key, by, ttlSeconds);
        } catch (error) {
          trip("incrBy", error);
        }
      }
      return fallback.incrBy(key, by, ttlSeconds);
    },
    async get(key) {
      if (remoteAvailable()) {
        try {
          return await remote.get(key);
        } catch (error) {
          trip("get", error);
        }
      }
      return fallback.get(key);
    },
    async set(key, value, ttlSeconds) {
      // No memory fallback on purpose: see the header comment.
      if (!remoteAvailable()) return false;
      try {
        return await remote.set(key, value, ttlSeconds);
      } catch (error) {
        trip("set", error);
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Process singleton
// ---------------------------------------------------------------------------------------------

// Parked on globalThis so the counters survive module re-evaluation (dev HMR, several bundles).
const MEMORY_STORE = Symbol.for("mda.assistant.memory-store");
type MemoryHolder = { [MEMORY_STORE]?: KVStore };

function processMemoryStore(): KVStore {
  const holder = globalThis as typeof globalThis & MemoryHolder;
  return (holder[MEMORY_STORE] ??= createMemoryStore());
}

let active: { config: AssistantEnv["store"]; store: KVStore } | null = null;

/** The process-wide store for the configuration currently in the environment. */
export function getStore(): KVStore {
  const config = getAssistantEnv().store;
  if (active && sameStoreConfig(active.config, config)) return active.store;
  const store =
    config.kind === "upstash"
      ? createResilientStore(createUpstashStore(config.url, config.token), processMemoryStore())
      : processMemoryStore();
  active = { config, store };
  return store;
}

function sameStoreConfig(a: AssistantEnv["store"], b: AssistantEnv["store"]): boolean {
  if (a.kind === "memory" || b.kind === "memory") return a.kind === b.kind;
  return a.url === b.url && a.token === b.token;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Redis INCRBY only takes integers: normalize instead of failing the whole operation.
function toDelta(by: number): number {
  return Number.isFinite(by) ? Math.trunc(by) : 0;
}

function toTtlSeconds(ttlSeconds: number): number {
  return Number.isFinite(ttlSeconds) ? Math.max(1, Math.ceil(ttlSeconds)) : 1;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
