// Where the voice module keeps what. Server-only.
//
// Two kinds of keys live in the KV store, and they must not share one bounded memory:
//   - keys ANYONE can create for free: the per-IP rate-limit windows. Every IPv6 /64 is a new
//     subject, and a scripted example costs nothing, so a script can create them by the thousand.
//   - keys only an ADMITTED live session can create, plus the per-tenant and global counters: the
//     minutes, the spend, the running sessions, the settlement ledger, the per-session locks and
//     caps, the session state. Their number is bounded by the minute and spend ceilings.
//
// The in-memory store (lib/assistant/server/store.ts, the default when Upstash is not configured)
// keeps 10'000 keys and drops the least recently used ones when full. With both kinds in it, a
// flood of free rate-limit keys pushed the spend and minute counters out and so reset the budget
// (review finding sicurezza/F6). So with the memory store, the second kind goes to a COMPANION
// memory store of its own, which free keys never reach. With Upstash both kinds share the one
// persistent store: it does not evict like that, and it is the same for every instance.
//
// The chat's store module stays untouched: the companion is an ordinary createMemoryStore().
import { createMemoryStore, getStore, type KVStore } from "@/lib/assistant/server/store";

/**
 * Keys the accounting store holds at most. Per admitted session there are about ten (ledger,
 * markers, lock slots, caps, state); every session is charged at least a lease of minutes, so the
 * daily minute ceilings bound how many sessions there can be. Far above what they allow by default.
 */
export const ACCOUNTING_STORE_MAX_KEYS = 20_000;

// One companion per shared memory store, kept on globalThis like the chat's own singleton so that
// module re-evaluation (dev HMR, several bundles) does not forget the counters.
const COMPANIONS = Symbol.for("mva.voice.accounting-stores");
type CompanionHolder = { [COMPANIONS]?: WeakMap<KVStore, KVStore> };

/**
 * The store for accounting and admitted-session keys, given the shared store: the shared store
 * itself when it is Upstash, otherwise its own companion memory store (see the header).
 */
export function accountingStoreFor(shared: KVStore): KVStore {
  if (shared.kind !== "memory") return shared;
  const holder = globalThis as typeof globalThis & CompanionHolder;
  const companions = (holder[COMPANIONS] ??= new WeakMap<KVStore, KVStore>());
  let companion = companions.get(shared);
  if (companion === undefined) {
    companion = createMemoryStore(ACCOUNTING_STORE_MAX_KEYS);
    companions.set(shared, companion);
  }
  return companion;
}

/** The two stores of a request: what the routes were given (tests), else the production ones. */
export function voiceStores(deps: { store?: KVStore; accountingStore?: KVStore }): { shared: KVStore; accounting: KVStore } {
  const shared = deps.store ?? getStore();
  return { shared, accounting: deps.accountingStore ?? accountingStoreFor(shared) };
}
