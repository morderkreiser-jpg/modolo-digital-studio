// Abuse and cost gates of the assistant endpoints: who may call (origin), how often (per IP, per
// browser session, per tenant and day) and whether the estimated spend of the day and the month
// still fits the budget. Server-only.
//
// Raw IPs are never stored: callers hash rateLimitSubject(ip) with hashId() and a server-side
// salt, and every IP-keyed counter expires within a day.
import { createHash } from "node:crypto";
import type { AssistantLimits, TenantConfig } from "@/lib/assistant/types";
import type { KVStore } from "./store";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Daily counters outlive their day a little so a late read (usage summary) still finds them.
const DAY_COUNTER_TTL = 3 * DAY;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * The visitor's public IP as seen by Vercel, or null when unknown (local dev, unexpected proxy).
 * Callers must treat null as "no IP limit", never as one shared bucket.
 *
 * Same rules as lib/rate-limit.ts (copied, not imported, so the assistant stays portable):
 * x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for; Vercel overwrites these and does
 * not forward client-supplied values, and only the first entry of a list is used.
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

/** Pseudonymous id: sha256(salt + ":" + value), first 32 hex chars. */
export function hashId(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

/**
 * What an IP rate limit counts: an IPv4 address as it is, an IPv6 address by its /64 prefix. A
 * single subscriber or server controls a whole /64 and could take a fresh address from it for
 * every request, so per-address IPv6 limits would stop nobody. IPv4-mapped IPv6 (::ffff:a.b.c.d)
 * counts as its IPv4 address. Tolerates the decorations proxies add: brackets, a port, a zone id.
 * Anything that is not an IP address comes back as given, so it still gets a bucket of its own.
 */
export function rateLimitSubject(ip: string): string {
  let text = ip.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(text); // [2001:db8::1]:443
  if (bracketed) text = bracketed[1];
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text); // 203.0.113.7:51234
  if (withPort) text = withPort[1];

  const v4 = parseIpv4(text);
  if (v4 !== null) return v4.join(".");

  const zone = text.indexOf("%"); // fe80::1%eth0
  const words = parseIpv6(zone === -1 ? text : text.slice(0, zone));
  if (words === null) return ip;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join(".");
  }
  const prefix = words.slice(0, 4).map((word) => word.toString(16).padStart(4, "0"));
  return `${prefix.join(":")}::/64`;
}

/**
 * Browser calls must come from the site itself, an origin the tenant allows, or (outside
 * production) localhost. Requests without an Origin header are not from a browser page and are
 * let through: the per-IP, session and budget limits still apply to them.
 */
export function isOriginAllowed(request: Request, tenant: TenantConfig): boolean {
  const header = request.headers.get("origin");
  if (header === null || header.trim() === "") return true;
  // "null" (sandboxed iframes, some redirects) and malformed values never match anything.
  const origin = toOrigin(header.trim());
  if (origin === null) return false;
  if (origin === toOrigin(request.url)) return true;
  if (tenant.allowedOrigins.some((allowed) => toOrigin(allowed) === origin)) return true;
  return process.env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin);
}

/** UTC calendar day, e.g. "2026-11-15". */
export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** UTC calendar month, e.g. "2026-11". */
export function utcMonth(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

/**
 * Fixed-window counter: one hit of `key` in the current window of `windowSeconds`. A denied hit
 * still counts, so hammering never resets the window. `retryAfter` is the number of seconds until
 * the window ends (at least 1).
 */
export async function hitWindow(
  store: KVStore,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
  const length = Number.isFinite(windowSeconds) ? Math.max(1, Math.floor(windowSeconds)) : 1;
  const nowSeconds = now / 1000;
  const bucket = Math.floor(nowSeconds / length);
  // A few seconds of slack so a counter never expires while its window is still running.
  const count = await store.incrBy(`mda:rl:${key}:${bucket}`, 1, length + 5);
  const retryAfter = Math.max(1, Math.ceil((bucket + 1) * length - nowSeconds));
  return { allowed: count <= limit, count, retryAfter };
}

export type ChatGate =
  | { ok: true; remaining: number }
  | { ok: false; code: "rate_limited" | "session_limit" | "budget_exhausted"; retryAfter?: number };

/**
 * Decides whether one more chat message may reach the model. Checks run cheapest and most
 * specific first and stop at the first refusal, so a request refused by an earlier gate does not
 * consume the later quotas:
 *   1. IP per minute / hour / day (skipped when the IP is unknown)
 *   2. user messages in this browser session (24 h)
 *   3. requests of the whole tenant today
 *   4. estimated spend today and this month (micro-USD kept by usage.ts). Only a spend already at
 *      the budget is refused here; whether this request still fits is decided by reserveSpend().
 */
export async function checkChatAllowance(args: {
  store: KVStore;
  tenantId: string;
  limits: AssistantLimits;
  ipHash: string | null;
  sessionId: string;
  now?: number;
}): Promise<ChatGate> {
  const { store, tenantId, limits, ipHash, sessionId } = args;
  const now = args.now ?? Date.now();

  if (ipHash !== null) {
    const windows: Array<[limit: number, seconds: number]> = [
      [limits.ipPerMinute, MINUTE],
      [limits.ipPerHour, HOUR],
      [limits.ipPerDay, DAY],
    ];
    for (const [limit, seconds] of windows) {
      const hit = await hitWindow(store, `chat:${tenantId}:ip:${ipHash}:${seconds}`, limit, seconds, now);
      if (!hit.allowed) return { ok: false, code: "rate_limited", retryAfter: hit.retryAfter };
    }
  }

  const sessionCount = await store.incrBy(`mda:sess:${tenantId}:${sessionId}`, 1, DAY);
  if (sessionCount > limits.maxUserMessagesPerSession) return { ok: false, code: "session_limit" };

  const day = utcDay(now);
  const requestsToday = await store.incrBy(`mda:req:${tenantId}:${day}`, 1, DAY_COUNTER_TTL);
  if (requestsToday > limits.tenantRequestsPerDay) {
    return { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcDay(now) };
  }

  const [spentToday, spentThisMonth] = await Promise.all([
    store.get(`mda:cost:${tenantId}:${day}`),
    store.get(`mda:cost:${tenantId}:${utcMonth(now)}`),
  ]);
  // The month first: when both are spent, waiting for tomorrow would not help.
  if (toMicroUsd(spentThisMonth) >= limits.tenantBudgetUsdPerMonth * 1e6) {
    return { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcMonth(now) };
  }
  if (toMicroUsd(spentToday) >= limits.tenantBudgetUsdPerDay * 1e6) {
    return { ok: false, code: "budget_exhausted", retryAfter: secondsUntilNextUtcDay(now) };
  }

  return { ok: true, remaining: Math.max(0, limits.maxUserMessagesPerSession - sessionCount) };
}

/** Seconds until the next UTC day starts (at least 1): the Retry-After of a spent daily budget. */
export function secondsUntilNextUtcDay(now: number = Date.now()): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/** Seconds until the next UTC month starts (at least 1): the Retry-After of a spent monthly budget. */
export function secondsUntilNextUtcMonth(now: number = Date.now()): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function toOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function toMicroUsd(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Dotted-quad IPv4 as its four octets (leading zeros allowed), or null. */
function parseIpv4(text: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** An IPv6 address (RFC 4291 text forms: "::" compression, an IPv4 tail) as its 8 hextets, or null. */
function parseIpv6(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;
  const head = toHextets(halves[0], !compressed);
  const tail = compressed ? toHextets(halves[1], true) : [];
  if (head === null || tail === null) return null;
  // "::" stands for at least one hextet of zeros.
  const zeros = 8 - head.length - tail.length;
  if (compressed ? zeros < 1 : zeros !== 0) return null;
  return [...head, ...Array.from({ length: compressed ? zeros : 0 }, () => 0), ...tail];
}

/** Colon-separated hextets; the last group may be an IPv4 address (two hextets) when allowed. */
function toHextets(part: string, ipv4TailAllowed: boolean): number[] | null {
  if (part === "") return [];
  const groups = part.split(":");
  const hextets: number[] = [];
  for (const [index, group] of groups.entries()) {
    if (ipv4TailAllowed && index === groups.length - 1 && group.includes(".")) {
      const octets = parseIpv4(group);
      if (octets === null) return null;
      hextets.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    } else if (/^[0-9a-f]{1,4}$/.test(group)) {
      hextets.push(Number.parseInt(group, 16));
    } else {
      return null;
    }
  }
  return hextets;
}
