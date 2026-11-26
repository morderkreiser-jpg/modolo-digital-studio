// Verification of webhooks that a voice provider sends TO us (tool calls during a conversation,
// end-of-call reports). Server-only.
//
// Scheme: hex HMAC-SHA256 over `${timestamp}.${rawBody}` with a secret shared with the provider,
// sent in two headers (the adapter maps the provider's header names onto these arguments). The
// signature covers the RAW body exactly as received: parsing and re-serialising JSON changes bytes
// (key order, spacing, unicode escapes), so the route must read the body as text, verify, and only
// then JSON.parse it.
//
// Three defences, cheapest first:
//   - shape: both headers present, a plain unix-seconds timestamp, a 64-hex-digit signature;
//   - freshness: the timestamp within `toleranceSeconds` of now, in both directions, so a captured
//     request cannot be replayed tomorrow and a forged far-future timestamp buys nothing;
//   - authenticity: the HMAC, compared in constant time.
// Inside the tolerance window a captured request could still be replayed: seenBefore() closes that
// gap with the provider's delivery id.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { KVStore } from "@/lib/assistant/server/store";

export type WebhookVerification = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "bad_signature" };

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
/** A shorter shared secret is treated as no secret: nothing verifies against it. */
export const MIN_WEBHOOK_SECRET_LENGTH = 16;

const MAX_TOLERANCE_SECONDS = 3600;
const TIMESTAMP_RE = /^\d{1,12}$/;
// Optional "sha256=" prefix, as several providers send it.
const SIGNATURE_RE = /^(?:sha256=)?([0-9a-f]{64})$/i;
const MIN_SEEN_TTL = 600;
const MAX_SEEN_TTL = 30 * 86_400;

/** Hex HMAC-SHA256 of `${timestamp}.${rawBody}`. For tests and for our own outgoing webhooks. */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/**
 * Checks one incoming webhook. `now` is unix milliseconds (Date.now()); the timestamp header is
 * unix seconds. Never throws.
 */
export function verifyWebhook(args: {
  secret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  toleranceSeconds?: number;
  now?: number;
}): WebhookVerification {
  const timestampText = args.timestampHeader?.trim() ?? "";
  const signatureText = args.signatureHeader?.trim() ?? "";
  if (timestampText === "" || signatureText === "") return { ok: false, reason: "missing" };
  if (!TIMESTAMP_RE.test(timestampText)) return { ok: false, reason: "malformed" };
  const signature = SIGNATURE_RE.exec(signatureText);
  if (!signature) return { ok: false, reason: "malformed" };
  if (typeof args.rawBody !== "string") return { ok: false, reason: "malformed" };

  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor((args.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance(args.toleranceSeconds)) return { ok: false, reason: "stale" };

  // A missing or short secret (a configuration error) must fail closed, never verify.
  if (typeof args.secret !== "string" || args.secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    return { ok: false, reason: "bad_signature" };
  }
  const expected = Buffer.from(signWebhook(args.secret, timestamp, args.rawBody), "hex");
  const given = Buffer.from(signature[1].toLowerCase(), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

/**
 * Replay protection: true when this delivery id was already processed (or is being processed by
 * a parallel delivery), false the first time. Call it only AFTER verifyWebhook() succeeded, or a
 * forger could burn real ids in advance. Keep `ttlSeconds` above the timestamp tolerance: older
 * replays are refused as stale anyway. An empty id cannot be deduplicated and counts as seen.
 *
 * The id is hashed into the key: it comes from the outside and has no length or character limit.
 * Prefix it with the provider ("mock:<id>") when ids could repeat across providers.
 */
export async function seenBefore(store: KVStore, id: string, ttlSeconds: number): Promise<boolean> {
  if (typeof id !== "string" || id === "") return true;
  const ttl = Number.isFinite(ttlSeconds) ? Math.min(MAX_SEEN_TTL, Math.max(MIN_SEEN_TTL, Math.ceil(ttlSeconds))) : MIN_SEEN_TTL;
  return (await store.incrBy(seenKey(id), 1, ttl)) > 1;
}

/**
 * True when seenBefore() already marked this id; marks nothing. For a delivery whose action must
 * run before it counts as done: look with wasSeen() first, mark with seenBefore() after. Only
 * race-free when something else (the session's lock) keeps two deliveries of the id apart. An
 * empty id counts as seen, as in seenBefore().
 */
export async function wasSeen(store: KVStore, id: string): Promise<boolean> {
  if (typeof id !== "string" || id === "") return true;
  const value = await store.get(seenKey(id));
  return value !== null && Number.parseInt(value, 10) > 0;
}

function seenKey(id: string): string {
  return `mva:wh:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

function tolerance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  return Math.min(MAX_TOLERANCE_SECONDS, Math.max(1, Math.floor(value)));
}
