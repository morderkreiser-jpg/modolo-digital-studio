// Opening and closing sessions (lib/voice/server/session.ts) below the HTTP layer: what the token
// carries, the state written for live modes, a store that cannot keep it, closing exactly once,
// the grace for late end reports, a state lost between instances, and the sinks that refuse to
// promise a hand-over that cannot happen.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createMemoryStore } from "@/lib/assistant/server/store";
import { getDemoTenant } from "@/lib/voice/demos";
import { getVoiceEnv } from "@/lib/voice/server/env";
import { usageSnapshot } from "@/lib/voice/server/limits";
import {
  closeSession,
  createSessionSinks,
  END_GRACE_SECONDS,
  finishSession,
  isSessionClosed,
  loadOrRecoverState,
  openSession,
} from "@/lib/voice/server/session";
import { loadState } from "@/lib/voice/server/state";
import type { SendEmail } from "@/lib/voice/server/summary";
import { MAX_EXPIRED_GRACE_SECONDS, verifySessionToken, type SessionClaims } from "@/lib/voice/server/token";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { createFakeStore } from "../assistant/fixtures";
import { captureLogs, localEnv, post, sessionBody, TEST_SECRET, testDeps } from "./voice-fixtures";

const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);
const RESEND = { apiKey: "re_test_key", from: "Studio <test@example.ch>" };

let restoreEnv: () => void = () => undefined;
beforeEach(() => {
  captureLogs();
  restoreEnv = localEnv();
});
afterEach(() => {
  restoreEnv();
  mock.restoreAll();
});

function request(headers: Record<string, string> = {}): Request {
  return post("/api/voice/session", sessionBody(), headers);
}

async function claimsOf(token: string, now = T0): Promise<SessionClaims> {
  const verified = verifySessionToken(token, TEST_SECRET, now);
  assert.ok(verified.ok);
  return verified.claims;
}

describe("openSession", () => {
  it("signs tenant, session, mode, language and channel into the token, and keeps the reservation in the state", async () => {
    const deps = testDeps({ now: () => T0 });
    const opened = await openSession(request({ "x-real-ip": "198.51.100.4" }), sessionBody(), deps);
    assert.ok(opened.ok);
    const claims = await claimsOf(opened.grant.sessionToken);
    assert.equal(claims.tid, "modolo");
    assert.equal(claims.mode, "local");
    assert.equal(claims.loc, "de");
    assert.equal(claims.ch, "web");
    assert.equal(claims.exp - claims.iat, 180 + 60);
    assert.match(claims.ip ?? "", /^[0-9a-f]{32}$/, "a salted hash, never the address");

    const state = await loadState(deps.store, claims.sid);
    assert.equal(state?.reservation?.sessionId, claims.sid);
    // One lease of minutes, not the whole call: an abandoned session must not keep three
    // minutes of the day (review finding sicurezza/F4). Each turn extends it.
    assert.equal(state?.reservation?.reservedSeconds, 60);
    assert.equal(state?.startedAt, T0);
  });

  it("keeps no state for an example: nothing to settle, nothing said", async () => {
    const deps = testDeps({ now: () => T0 });
    const opened = await openSession(request(), sessionBody({ mode: "scripted" }), deps);
    assert.ok(opened.ok);
    const claims = await claimsOf(opened.grant.sessionToken);
    assert.equal(await loadState(deps.store, claims.sid), null);
  });

  it("refuses a live session whose state the store cannot keep, and gives the reservation back", async () => {
    const { store } = createFakeStore("upstash", { setResult: false });
    const opened = await openSession(request(), sessionBody(), { store, now: () => T0, resend: null });
    assert.deepEqual(opened, { ok: false, status: 503, error: "unavailable" });
    const usage = await usageSnapshot(store, "modolo", T0);
    assert.equal(usage.running, 0);
    assert.equal(usage.minutesToday, 0);
  });
});

describe("closing", () => {
  it("closes once, settles the seconds really used and removes the state", async () => {
    const deps = testDeps({ now: () => T0 });
    const opened = await openSession(request(), sessionBody(), deps);
    assert.ok(opened.ok);
    const claims = await claimsOf(opened.grant.sessionToken);
    assert.equal((await usageSnapshot(deps.store, "modolo", T0)).minutesToday, 1, "one lease is reserved");

    const closed = await closeSession({ sessionToken: opened.grant.sessionToken, reason: "user" }, { ...deps, now: () => T0 + 42_000 });
    assert.deepEqual(closed, { ok: true, closed: true });
    assert.equal(await isSessionClosed(deps.store, claims.sid), true);
    assert.equal(await loadState(deps.store, claims.sid), null);
    const usage = await usageSnapshot(deps.store, "modolo", T0 + 42_000);
    assert.equal(usage.minutesToday, 42 / 60);
    assert.equal(usage.running, 0);

    assert.deepEqual(await closeSession({ sessionToken: opened.grant.sessionToken, reason: "user" }, deps), { ok: true, closed: false });
    assert.equal((await usageSnapshot(deps.store, "modolo", T0 + 42_000)).minutesToday, 42 / 60, "nothing given back twice");
  });

  it("accepts an end report within the grace period after expiry, not later", async () => {
    const deps = testDeps({ now: () => T0 });
    const opened = await openSession(request(), sessionBody(), deps);
    assert.ok(opened.ok);
    const exp = opened.grant.expiresAt;
    assert.ok(END_GRACE_SECONDS <= MAX_EXPIRED_GRACE_SECONDS);
    const tooLate = await closeSession({ sessionToken: opened.grant.sessionToken, reason: "unload" }, { ...deps, now: () => exp + (END_GRACE_SECONDS + 1) * 1000 });
    assert.deepEqual(tooLate, { ok: true, closed: false });
    const inGrace = await closeSession({ sessionToken: opened.grant.sessionToken, reason: "unload" }, { ...deps, now: () => exp + 60_000 });
    assert.deepEqual(inGrace, { ok: true, closed: true });
    // Every route that starts work still refuses the expired token.
    assert.deepEqual(verifySessionToken(opened.grant.sessionToken, TEST_SECRET, exp + 60_000), { ok: false, reason: "expired" });
  });

  // An example's token is free to get: an end report for each must not write a marker per token
  // into the accounting store (review finding sicurezza/F6).
  it("ends an example without writing anything", async () => {
    const { store, calls } = createFakeStore();
    const deps = { store, accountingStore: store, now: () => T0, resend: null };
    const opened = await openSession(request(), sessionBody({ mode: "scripted" }), deps);
    assert.ok(opened.ok);
    const before = calls.length;
    assert.deepEqual(await closeSession({ sessionToken: opened.grant.sessionToken, reason: "user" }, deps), { ok: true, closed: false });
    assert.equal(calls.length, before);
  });

  it("settles a session whose state was lost, from its token and the ledger", async () => {
    const deps = testDeps({ now: () => T0 });
    const opened = await openSession(request(), sessionBody(), deps);
    assert.ok(opened.ok);
    const claims = await claimsOf(opened.grant.sessionToken);
    await deps.store.set(`mva:state:${claims.sid}`, "", 1); // gone, as on another instance
    const closed = await closeSession({ sessionToken: opened.grant.sessionToken, reason: "user" }, { ...deps, now: () => T0 + 30_000 });
    assert.deepEqual(closed, { ok: true, closed: true });
    const usage = await usageSnapshot(deps.store, "modolo", T0 + 30_000);
    assert.equal(usage.minutesToday, 30 / 60, "the unused lease came back");
    assert.equal(usage.running, 0, "the slot is free");
  });

  it("closes a session exactly once even when two reports race", async () => {
    const deps = testDeps({ now: () => T0 });
    const opened = await openSession(request(), sessionBody(), deps);
    assert.ok(opened.ok);
    const claims = await claimsOf(opened.grant.sessionToken);
    const env = getVoiceEnv();
    const results = await Promise.all([
      finishSession({ claims, reason: "user", env, deps, now: T0 + 1000 }),
      finishSession({ claims, reason: "unload", env, deps, now: T0 + 1000 }),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
  });
});

describe("recovering and sinks", () => {
  it("starts a fresh state, without a reservation, when the state is missing", async () => {
    const store = createMemoryStore();
    const claims: SessionClaims = {
      v: 1,
      tid: "modolo",
      sid: "recoveredSession000001",
      mode: "local",
      loc: "it",
      ch: "web",
      iat: Math.floor(T0 / 1000),
      exp: Math.floor(T0 / 1000) + 240,
    };
    const state = await loadOrRecoverState(store, claims);
    assert.equal(state.sessionId, claims.sid);
    assert.equal(state.tenantId, "modolo");
    assert.equal(state.locale, "it");
    assert.equal(state.reservation, null);
    assert.equal(state.startedAt, T0);
  });

  it("refuses to take a live tenant's request that could never reach it", async () => {
    const withoutEmail = createSessionSinks(MODOLO_VOICE_TENANT, null);
    assert.deepEqual(await withoutEmail.lead(LEAD), { ok: false, ref: "" });
    assert.deepEqual(await withoutEmail.callback(CALLBACK), { ok: false });

    const demo = getDemoTenant("demo-maler");
    assert.ok(demo);
    assert.equal((await createSessionSinks(demo, null).lead(LEAD)).ok, true);
    assert.deepEqual(await withoutEmail.transfer({ tenant: "modolo", sessionId: "x", targetId: "owner" }), { connected: false });
  });

  // From the integration report: a request reached the business only with the end-of-session
  // summary, so a call that never reported its end lost it although the caller heard "passed on".
  // The sink with RESEND used to answer ok without sending anything; it now sends, and only an
  // accepted email counts.
  it("emails a live tenant's request at once, and says it was passed on only when the email was accepted", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const accepting: SendEmail = async (email) => {
      sent.push(email);
      return true;
    };
    const withEmail = createSessionSinks(MODOLO_VOICE_TENANT, RESEND, { send: accepting, session: { channel: "web", startedAt: T0 } });
    const lead = await withEmail.lead(LEAD);
    assert.equal(lead.ok, true);
    assert.match(lead.ref, /^LD-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, MODOLO_VOICE_TENANT.notifyEmail);
    assert.ok(sent[0].subject.includes(lead.ref));
    assert.match(sent[0].text, /während eines Gesprächs aufgenommen/);
    assert.ok(sent[0].text.includes("anna@example.ch"));
    assert.deepEqual(await withEmail.callback(CALLBACK), { ok: true });
    assert.equal(sent.length, 2);
    assert.ok(sent[1].text.includes("+41791234567"));

    const refusing: SendEmail = async () => false;
    const failing = createSessionSinks(MODOLO_VOICE_TENANT, RESEND, { send: refusing });
    assert.deepEqual(await failing.lead(LEAD), { ok: false, ref: "" });
    assert.deepEqual(await failing.callback(CALLBACK), { ok: false });
  });
});

const LEAD = {
  tenant: "modolo",
  sessionId: "sinkSession00000000001",
  taskId: "project_request",
  fields: {},
  contact: { name: "Anna Muster", email: "anna@example.ch" },
  summary: "Website für ein Café.",
  locale: "de" as const,
};

const CALLBACK = {
  tenant: "modolo",
  sessionId: "sinkSession00000000001",
  name: "Anna Muster",
  phone: "+41791234567",
  topic: "Website",
  locale: "de" as const,
};
