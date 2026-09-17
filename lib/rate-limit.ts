// Best-effort, in-process abuse control for /api/contact. Server-only.
//
// WHY IN CODE AND NOT ONLY IN THE WAF
// A dashboard WAF rate-limit rule is the right first line, but it is out of the repo's control and
// has already proven silent in production. This module is the layer that ships with the code.
//
// WHAT IT CAN AND CANNOT DO (be honest about it)
// State lives in the Node process. On Vercel fluid compute "multiple invocations can share the same
// physical instance (a global state/process) concurrently" (https://vercel.com/docs/fluid-compute,
// "Isolation boundaries and global state"), and Vercel Functions "prioritize existing idle resources
// before allocating new ones", so a burst from one source usually lands on a small number of warm
// instances and IS counted. But nothing guarantees it: a second instance, a failover region or a
// cold start starts from zero. Treat this as a dampener that turns "500 emails" into "a handful per
// instance", NOT as a guarantee.
//
// DESIGN RULE: the owner is a sole trader — a lost message is a lost client. Every limit here fails
// OPEN: unknown IP, unparsable state or any internal error => the request is allowed through.

type Bucket = { count: number; resetAt: number };

const MAX_KEYS = 5_000; // hard cap so a spray of unique keys can't grow the map without bound

// Survive module re-evaluation (dev HMR, multiple bundles) by parking the maps on globalThis.
const STORE = Symbol.for("mds.rate-limit.store");
type Store = Map<string, Map<string, Bucket>>;
const g = globalThis as unknown as { [STORE]?: Store };
const store: Store = (g[STORE] ??= new Map());

function bucketsFor(name: string): Map<string, Bucket> {
  let m = store.get(name);
  if (!m) store.set(name, (m = new Map()));
  return m;
}

/**
 * Count one hit of `key` in the named fixed window. Returns whether it is allowed and, when it is
 * not, how many seconds until the window resets. Never throws.
 */
export function hit(
  name: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; retryAfter: number } {
  try {
    const buckets = bucketsFor(name);

    // Opportunistic sweep: only when the map has grown, so the common path stays O(1).
    if (buckets.size > MAX_KEYS) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      if (buckets.size > MAX_KEYS) buckets.clear(); // last resort: forget everything, fail open
    }

    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    if (b.count >= limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    }
    b.count += 1;
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 }; // fail open, always
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The visitor's public IP as seen by Vercel, or null when it cannot be determined (local dev,
 * unexpected infrastructure). Callers MUST treat null as "no IP limit", never as a shared bucket.
 *
 * Header order follows https://vercel.com/docs/headers/request-headers :
 *   x-vercel-forwarded-for — "identical to the x-forwarded-for header. However, x-forwarded-for
 *                             could be overwritten if you're using a proxy on top of Vercel."
 *   x-real-ip              — "identical to the x-forwarded-for header."
 *   x-forwarded-for        — "The public IP address of the client that made the request."
 * Vercel overwrites x-forwarded-for and does "not forward external IPs ... to prevent IP spoofing",
 * so on Vercel the value is trustworthy; we still take only the FIRST entry of the list.
 */
export function clientIp(request: Request): string | null {
  const raw =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for");
  if (!raw) return null;
  const first = raw.split(",")[0].trim();
  if (!first) return null;
  // Accept IPv4 and anything that looks like an IPv6 literal; reject obvious junk.
  if (!IPV4.test(first) && !first.includes(":")) return null;
  return first.slice(0, 64);
}

// ---------------------------------------------------------------------------
// Policy for the contact endpoint.
//
// Thresholds are deliberately generous for humans and tight for scripts. A real visitor sends the
// form once, twice if they mistype. Even a whole company behind one NAT will not send 5 enquiries
// in 10 minutes to a one-person studio.
// ---------------------------------------------------------------------------

const MINUTE = 60_000;

export type ContactDecision = {
  /** false => refuse the request with 429; the visitor is told to use WhatsApp/email instead. */
  notify: boolean;
  /** false => still email the owner, but send NO auto-reply to the address in the form. */
  autoReply: boolean;
  retryAfter: number;
};

/**
 * @param ip       result of clientIp(); null disables every IP-keyed limit (fail open)
 * @param toEmail  the address the auto-reply would be sent to (already validated + trimmed)
 */
export function contactPolicy(ip: string | null, toEmail: string, now = Date.now()): ContactDecision {
  const decision: ContactDecision = { notify: true, autoReply: true, retryAfter: 0 };

  if (ip) {
    // Burst limit, then a slower hourly ceiling so an attacker can't just wait out the window.
    const burst = hit("contact:ip:10m", ip, 5, 10 * MINUTE, now);
    const hourly = hit("contact:ip:1h", ip, 12, 60 * MINUTE, now);
    if (!burst.allowed || !hourly.allowed) {
      decision.notify = false;
      decision.autoReply = false;
      decision.retryAfter = Math.max(burst.retryAfter, hourly.retryAfter);
      return decision;
    }
    // Tighter ceiling on the outbound auto-reply: 2 strangers per IP per 10 minutes is plenty.
    if (!hit("autoreply:ip:10m", ip, 2, 10 * MINUTE, now).allowed) decision.autoReply = false;
  }

  // Never mail the SAME stranger twice in a day, whatever the source IP. This is the limit that
  // actually stops the mailbox-bombing use of the endpoint, and it is IP-independent by design.
  const recipient = toEmail.trim().toLowerCase();
  if (recipient && !hit("autoreply:to:24h", recipient, 1, 24 * 60 * MINUTE, now).allowed) {
    decision.autoReply = false;
  }

  // Circuit breaker for a distributed flood, where per-IP limits are useless. The owner keeps
  // receiving every notification (never lose a lead); only the outbound relay is cut.
  if (!hit("autoreply:global:1h", "all", 40, 60 * MINUTE, now).allowed) decision.autoReply = false;

  return decision;
}

/** Test/maintenance hook: drop all counters. */
export function __resetRateLimits() {
  store.clear();
}
