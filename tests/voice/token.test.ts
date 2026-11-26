// Session tokens (lib/voice/server/token.ts): round trip, tampering of every claim, foreign
// secrets, trailing junk, non-canonical encodings, strict claim shapes and the clock.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { hashId } from "@/lib/assistant/server/guard";
import {
  isSessionId,
  isTenantId,
  MAX_SESSION_TOKEN_LENGTH,
  newSessionId,
  signSessionToken,
  verifySessionToken,
  type SessionClaims,
} from "@/lib/voice/server/token";

const SECRET = "voice-test-secret-0123456789-abcdefghij";
const OTHER_SECRET = "voice-test-secret-9876543210-zyxwvutsrq";
/** 2026-11-25 12:00:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const NOW_S = NOW / 1000;

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    v: 1,
    tid: "demo-umzug",
    sid: "AAAAAAAAAAAAAAAAAAAAAA",
    mode: "local",
    loc: "de",
    ch: "web",
    iat: NOW_S,
    exp: NOW_S + 240,
    ip: hashId("203.0.113.7", "salt"),
    ...overrides,
  };
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
}

/** The token with its payload replaced, keeping the ORIGINAL signature (what an attacker can do). */
function withPayload(token: string, payload: unknown): string {
  const signature = token.split(".")[1];
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;
}

/** A correctly signed token around an arbitrary payload, to test the claim checks behind the MAC. */
function forge(payload: unknown, secret: string = SECRET): string {
  const encoded = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

describe("newSessionId", () => {
  it("is 128 random bits in base64url", () => {
    const id = newSessionId();
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(Buffer.from(id, "base64url").length, 16);
    assert.ok(isSessionId(id));
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 2000 }, newSessionId));
    assert.equal(ids.size, 2000);
  });
});

describe("isTenantId / isSessionId", () => {
  it("accept the documented shapes only", () => {
    assert.ok(isTenantId("demo-umzug"));
    assert.ok(!isTenantId("Demo"));
    assert.ok(!isTenantId("a:b"));
    assert.ok(!isTenantId(""));
    assert.ok(!isSessionId("short"));
    assert.ok(!isSessionId("x".repeat(65)));
    assert.ok(!isSessionId("abc def ghi jkl mno pqr"));
  });
});

describe("signSessionToken + verifySessionToken", () => {
  it("round-trips the claims", () => {
    const token = signSessionToken(claims(), SECRET);
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    assert.ok(token.length < 400, String(token.length));
    assert.deepEqual(verifySessionToken(token, SECRET, NOW), { ok: true, claims: claims() });
  });

  it("works without the optional ip claim", () => {
    const rest = claims();
    delete rest.ip;
    const token = signSessionToken(rest, SECRET);
    const result = verifySessionToken(token, SECRET, NOW);
    assert.ok(result.ok);
    assert.equal("ip" in result.claims, false);
  });

  it("writes only the known claims, whatever object it is given", () => {
    const extra = { ...claims(), admin: true, limits: { maxCallSeconds: 9999 } } as SessionClaims;
    const payload = decodePayload(signSessionToken(extra, SECRET));
    assert.deepEqual(Object.keys(payload), ["v", "tid", "sid", "mode", "loc", "ch", "iat", "exp", "ip"]);
  });

  it("refuses to sign with a weak secret", () => {
    assert.throws(() => signSessionToken(claims(), "too-short"), RangeError);
    assert.throws(() => signSessionToken(claims(), ""), RangeError);
  });

  it("verifies nothing with a weak or missing secret", () => {
    const token = signSessionToken(claims(), SECRET);
    for (const secret of ["", "short", undefined as unknown as string]) {
      assert.deepEqual(verifySessionToken(token, secret, NOW), { ok: false, reason: "bad_signature" });
    }
  });

  it("refuses a token signed with another secret", () => {
    const token = signSessionToken(claims(), OTHER_SECRET);
    assert.deepEqual(verifySessionToken(token, SECRET, NOW), { ok: false, reason: "bad_signature" });
  });

  it("refuses a change of any single claim", () => {
    const token = signSessionToken(claims(), SECRET);
    const changes: Record<keyof SessionClaims, unknown> = {
      v: 2,
      tid: "demo-restaurant",
      sid: "BBBBBBBBBBBBBBBBBBBBBB",
      mode: "realtime",
      loc: "it",
      ch: "phone",
      iat: NOW_S - 1,
      exp: NOW_S + 3600,
      ip: hashId("198.51.100.1", "salt"),
    };
    for (const [field, value] of Object.entries(changes)) {
      const tampered = withPayload(token, { ...decodePayload(token), [field]: value });
      assert.deepEqual(verifySessionToken(tampered, SECRET, NOW), { ok: false, reason: "bad_signature" }, field);
    }
  });

  it("refuses a payload with a claim removed or added", () => {
    const token = signSessionToken(claims(), SECRET);
    const withoutIp = decodePayload(token);
    delete withoutIp.ip;
    assert.equal(verifySessionToken(withPayload(token, withoutIp), SECRET, NOW).ok, false);
    assert.equal(verifySessionToken(withPayload(token, { ...decodePayload(token), admin: true }), SECRET, NOW).ok, false);
  });

  it("refuses a flipped bit in the signature", () => {
    const token = signSessionToken(claims(), SECRET);
    const [payload, signature] = token.split(".");
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    assert.deepEqual(verifySessionToken(`${payload}.${flipped}`, SECRET, NOW), { ok: false, reason: "bad_signature" });
  });

  it("refuses a second spelling of the same signature bytes", () => {
    const token = signSessionToken(claims(), SECRET);
    const [payload, signature] = token.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // The last of 43 characters carries 4 bits of the MAC and 2 unused bits: toggling an unused
    // bit gives a different string that decodes to the very same bytes.
    const last = alphabet.indexOf(signature[42]);
    const twin = signature.slice(0, 42) + alphabet[last ^ 1];
    assert.deepEqual(Buffer.from(twin, "base64url"), Buffer.from(signature, "base64url"));
    assert.deepEqual(verifySessionToken(`${payload}.${twin}`, SECRET, NOW), { ok: false, reason: "bad_signature" });
  });

  it("refuses trailing junk and other decorations", () => {
    const token = signSessionToken(claims(), SECRET);
    const variants = [
      `${token}x`,
      `${token}.x`,
      `${token}.`,
      `${token} `,
      ` ${token}`,
      `${token}\n`,
      `${token}=`,
      `x${token}`,
      token.replace(".", ".."),
      token.split(".")[0],
      `.${token.split(".")[1]}`,
    ];
    for (const variant of variants) {
      const result = verifySessionToken(variant, SECRET, NOW);
      assert.equal(result.ok, false, JSON.stringify(variant));
    }
    assert.deepEqual(verifySessionToken(`${token}x`, SECRET, NOW), { ok: false, reason: "malformed" });
    assert.deepEqual(verifySessionToken(`${token}.x`, SECRET, NOW), { ok: false, reason: "malformed" });
  });

  it("refuses anything that is not a token-sized string", () => {
    for (const junk of [undefined, null, 42, {}, [], "", ".", "a.b"]) {
      assert.deepEqual(verifySessionToken(junk, SECRET, NOW), { ok: false, reason: "malformed" }, JSON.stringify(junk));
    }
    const long = `${"A".repeat(MAX_SESSION_TOKEN_LENGTH)}.${"A".repeat(43)}`;
    assert.deepEqual(verifySessionToken(long, SECRET, NOW), { ok: false, reason: "malformed" });
  });
});

describe("verifySessionToken: strict claims behind a valid signature", () => {
  const base = claims() as unknown as Record<string, unknown>;
  const invalid: Array<[string, unknown]> = [
    ["not JSON", "not json at all"],
    ["an array", [1, 2, 3]],
    ["null", null],
    ["version 2", { ...base, v: 2 }],
    ["version as text", { ...base, v: "1" }],
    ["unknown claim", { ...base, role: "admin" }],
    ["missing tenant", { ...base, tid: undefined }],
    ["upper-case tenant", { ...base, tid: "Demo" }],
    ["tenant with a colon", { ...base, tid: "demo:x" }],
    ["short session id", { ...base, sid: "abc" }],
    ["unknown mode", { ...base, mode: "premium" }],
    ["unknown locale", { ...base, loc: "es" }],
    ["unknown channel", { ...base, ch: "sms" }],
    ["fractional iat", { ...base, iat: NOW_S + 0.5 }],
    ["iat as text", { ...base, iat: String(NOW_S) }],
    ["exp before iat", { ...base, exp: NOW_S - 1 }],
    ["exp equal to iat", { ...base, exp: NOW_S }],
    ["lifetime over 3 hours", { ...base, exp: NOW_S + 3 * 3600 + 1 }],
    ["ip that is not a hash", { ...base, ip: "203.0.113.7" }],
  ];
  for (const [label, payload] of invalid) {
    it(`refuses ${label}`, () => {
      assert.deepEqual(verifySessionToken(forge(payload), SECRET, NOW), { ok: false, reason: "malformed" });
    });
  }

  it("accepts the forged control payload, so the cases above fail for their own reason", () => {
    assert.equal(verifySessionToken(forge(base), SECRET, NOW).ok, true);
  });
});

describe("verifySessionToken: time", () => {
  it("is valid until the second before exp, expired from exp on", () => {
    const token = signSessionToken(claims(), SECRET);
    assert.equal(verifySessionToken(token, SECRET, (NOW_S + 239) * 1000 + 999).ok, true);
    assert.deepEqual(verifySessionToken(token, SECRET, (NOW_S + 240) * 1000), { ok: false, reason: "expired" });
    assert.deepEqual(verifySessionToken(token, SECRET, NOW + 86_400_000), { ok: false, reason: "expired" });
  });

  it("tolerates 30 seconds of clock difference on iat, not more", () => {
    const token = signSessionToken(claims({ iat: NOW_S + 30, exp: NOW_S + 300 }), SECRET);
    assert.equal(verifySessionToken(token, SECRET, NOW).ok, true);
    const early = signSessionToken(claims({ iat: NOW_S + 31, exp: NOW_S + 300 }), SECRET);
    assert.deepEqual(verifySessionToken(early, SECRET, NOW), { ok: false, reason: "not_yet_valid" });
  });

  it("checks the signature before the clock: an expired forgery is a bad signature", () => {
    const token = signSessionToken(claims(), OTHER_SECRET);
    assert.deepEqual(verifySessionToken(token, SECRET, NOW + 86_400_000), { ok: false, reason: "bad_signature" });
  });

  it("uses the real clock by default", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signSessionToken(claims({ iat: now, exp: now + 60 }), SECRET);
    assert.equal(verifySessionToken(token, SECRET).ok, true);
  });
});
