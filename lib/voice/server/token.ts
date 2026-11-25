// Stateless session tokens of the voice endpoints. Server-only.
//
// Format: base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, first part)). A compact,
// JWT-like token without the header: there is exactly one algorithm, so there is nothing for an
// attacker to negotiate ("alg: none" and key confusion do not exist here).
//
// What a token is and is not:
//   - It proves that OUR server admitted this session for this tenant, mode, locale and channel
//     until `exp`. Changing any byte breaks the signature.
//   - It is not a capability to spend: every turn still goes through admitTurn() (per-session
//     turn cap, keyed by the session id), and the reservation made at admission caps the minutes.
//     A leaked or replayed token therefore only reaches what is left of its own session, and only
//     until it expires.
//   - It carries no personal data. `ip` is the salted hash of the rate-limit subject, so a route
//     can refuse a token presented from somewhere else if it wants to.
//
// Verification order, cheapest first: type and length → shape of the string → signature (constant
// time) → strict shape of the claims → time. The claims are parsed only after the signature
// matched, so JSON.parse never sees attacker-chosen bytes.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isVoiceLocale, type VoiceChannel, type VoiceLocale, type VoiceMode } from "@/lib/voice/types";
import { MIN_SESSION_SECRET_LENGTH } from "./env";

export interface SessionClaims {
  v: 1;
  /** Tenant id. */
  tid: string;
  /** Random session id (newSessionId()). */
  sid: string;
  mode: VoiceMode;
  loc: VoiceLocale;
  ch: VoiceChannel;
  /** Issued at, unix seconds. */
  iat: number;
  /** Expires at, unix seconds (the token is refused from this second on). */
  exp: number;
  /** Salted hash of the IP rate-limit subject (hashId(rateLimitSubject(ip), salt)). */
  ip?: string;
}

export type TokenVerification =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "not_yet_valid" };

/** Longest token accepted. A real one is about 250 characters; anything far longer is junk. */
export const MAX_SESSION_TOKEN_LENGTH = 1024;
/** Longest lifetime a token may claim (exp - iat). Sessions last minutes, not hours. */
export const MAX_SESSION_TOKEN_LIFETIME_SECONDS = 3 * 3600;
/** Tolerated clock difference between instances for `iat` in the future. */
export const TOKEN_CLOCK_SKEW_SECONDS = 30;

// 32 bytes of HMAC-SHA256 are always 43 base64url characters without padding.
const SIGNATURE_CHARS = 43;
const TOKEN_RE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;
const TENANT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const IP_HASH_RE = /^[0-9a-f]{16,64}$/;
const MODES: readonly VoiceMode[] = ["scripted", "local", "realtime"];
const CHANNELS: readonly VoiceChannel[] = ["web", "phone"];
const CLAIM_KEYS = new Set(["v", "tid", "sid", "mode", "loc", "ch", "iat", "exp", "ip"]);

/** 128 random bits, base64url (22 characters). */
export function newSessionId(): string {
  return randomBytes(16).toString("base64url");
}

/** Looks like a session id (newSessionId() or a provider's id of similar shape). */
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}

/** Looks like a tenant id: lowercase letters, digits and dashes. */
export function isTenantId(value: unknown): value is string {
  return typeof value === "string" && TENANT_ID_RE.test(value);
}

/**
 * Signs `claims`. Only the known claim fields are written, in a fixed order, so extra properties
 * on the object passed in never travel. Throws (RangeError) only on a programming error: a secret
 * shorter than MIN_SESSION_SECRET_LENGTH, which getVoiceEnv() never hands out. Signing with a weak
 * key must be impossible rather than silently produce a forgeable token.
 */
export function signSessionToken(claims: SessionClaims, secret: string): string {
  if (!isStrongSecret(secret)) throw new RangeError("Session secret too short");
  const ordered: SessionClaims = {
    v: claims.v,
    tid: claims.tid,
    sid: claims.sid,
    mode: claims.mode,
    loc: claims.loc,
    ch: claims.ch,
    iat: claims.iat,
    exp: claims.exp,
  };
  if (claims.ip !== undefined) ordered.ip = claims.ip;
  const payload = Buffer.from(JSON.stringify(ordered), "utf8").toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/** Longest grace verifySessionToken() grants an expired token (see `acceptExpiredForSeconds`). */
export const MAX_EXPIRED_GRACE_SECONDS = 15 * 60;

/**
 * Checks a token received from the browser. `now` is unix MILLISECONDS (Date.now()), like every
 * other clock in this module. Never throws.
 *
 * `acceptExpiredForSeconds` (at most MAX_EXPIRED_GRACE_SECONDS) still accepts a token that expired
 * less than that long ago. Only for closing a session: an end report that arrives a little late
 * (a beacon sent as the page closes, a tab woken from sleep) must still settle the reservation and
 * hand over the call summary. Every route that STARTS work verifies without it.
 */
export function verifySessionToken(
  token: unknown,
  secret: string,
  now: number = Date.now(),
  options: { acceptExpiredForSeconds?: number } = {},
): TokenVerification {
  if (typeof token !== "string" || token.length > MAX_SESSION_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const match = TOKEN_RE.exec(token);
  if (!match) return { ok: false, reason: "malformed" };
  const [, payload, signature] = match;

  // A weak or missing secret verifies nothing, whatever the token says.
  if (!isStrongSecret(secret)) return { ok: false, reason: "bad_signature" };
  // Compared as canonical base64url text, not decoded bytes: base64 decoders ignore the unused
  // low bits of the last character, so several spellings decode to the same bytes. Comparing the
  // text accepts exactly one spelling.
  const expected = Buffer.from(mac(payload, secret), "ascii");
  const given = Buffer.from(signature, "ascii");
  if (expected.length !== SIGNATURE_CHARS || given.length !== SIGNATURE_CHARS || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }

  const claims = parseClaims(payload);
  if (claims === null) return { ok: false, reason: "malformed" };

  const nowSeconds = Math.floor(now / 1000);
  if (claims.iat > nowSeconds + TOKEN_CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };
  const grace = expiredGrace(options.acceptExpiredForSeconds);
  if (nowSeconds >= claims.exp + grace) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

function expiredGrace(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_EXPIRED_GRACE_SECONDS, Math.floor(value));
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function isStrongSecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SESSION_SECRET_LENGTH;
}

/** The claims, if the payload is exactly a SessionClaims object; null for anything else. */
function parseClaims(payload: string): SessionClaims | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !CLAIM_KEYS.has(key))) return null;

  const { v, tid, sid, mode, loc, ch, iat, exp, ip } = record;
  if (v !== 1) return null;
  if (!isTenantId(tid) || !isSessionId(sid)) return null;
  if (!MODES.includes(mode as VoiceMode)) return null;
  if (!isVoiceLocale(loc)) return null;
  if (!CHANNELS.includes(ch as VoiceChannel)) return null;
  if (!isUnixSeconds(iat) || !isUnixSeconds(exp)) return null;
  if (exp <= iat || exp - iat > MAX_SESSION_TOKEN_LIFETIME_SECONDS) return null;
  if (ip !== undefined && (typeof ip !== "string" || !IP_HASH_RE.test(ip))) return null;

  const claims: SessionClaims = {
    v: 1,
    tid,
    sid,
    mode: mode as VoiceMode,
    loc,
    ch: ch as VoiceChannel,
    iat,
    exp,
  };
  if (ip !== undefined) claims.ip = ip;
  return claims;
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
