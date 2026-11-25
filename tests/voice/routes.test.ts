// The voice endpoints called directly with Request objects (lib/voice/server/handlers.ts, which
// the route files under app/api/voice/ wrap): switch, tenant, origin, honeypot, body limits, the
// admission gates (rate limit, busy, budget), the turn stream, expiry and the time limit, the end
// report (also as a text/plain beacon, idempotent) and the signed tool webhook.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  handleEndRequest,
  handleSessionRequest,
  handleToolRequest,
  handleTurnRequest,
  TOOL_DELIVERY_HEADER,
  TOOL_SIGNATURE_HEADER,
  TOOL_TIMESTAMP_HEADER,
  type VoiceDeps,
} from "@/lib/voice/server/handlers";
import { createMockProvider } from "@/lib/voice/server/providers/mock";
import { loadState } from "@/lib/voice/server/state";
import { signWebhook } from "@/lib/voice/server/webhook";
import { usageSnapshot } from "@/lib/voice/server/limits";
import type { SendEmail } from "@/lib/voice/server/summary";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { DEFAULT_VOICE_LIMITS, type SessionGrant } from "@/lib/voice/types";
import {
  captureLogs,
  localEnv,
  post,
  readError,
  readEvents,
  readGrant,
  sessionBody,
  setVoiceEnv,
  spoken,
  TEST_SECRET,
  testDeps,
  WEBHOOK_SECRET,
} from "./voice-fixtures";

/** Wednesday 2 December 2026, 10:00 in Zurich. */
const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);
const RESEND = { apiKey: "re_test_key", from: "Modolo Digital Studio <test@example.ch>" };
const LEAD_UTTERANCE = "Ich möchte eine Offerte für eine Website. Mein Name ist Anna Muster, meine E-Mail ist anna@example.ch";

let restoreEnv: () => void = () => undefined;
let logs: string[] = [];
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  restoreEnv();
  restoreEnv = () => undefined;
  mock.restoreAll();
});

async function open(deps: VoiceDeps, body: Record<string, unknown> = sessionBody(), headers: Record<string, string> = {}): Promise<SessionGrant> {
  const response = await handleSessionRequest(post("/api/voice/session", body, headers), deps);
  assert.equal(response.status, 200, `session refused: ${await response.clone().text()}`);
  return readGrant(response);
}

function turnRequest(token: string, text: string, extra: Record<string, unknown> = {}): Request {
  return post("/api/voice/turn", { sessionToken: token, text, locale: "de", ...extra });
}

function emailRecorder(): SendEmail & { sent: Parameters<SendEmail>[0][] } {
  const sent: Parameters<SendEmail>[0][] = [];
  const send = (async (email) => {
    sent.push(email);
    return true;
  }) as SendEmail & { sent: Parameters<SendEmail>[0][] };
  send.sent = sent;
  return send;
}

describe("POST /api/voice/session", () => {
  it("is unavailable while voice is switched off", async () => {
    restoreEnv = setVoiceEnv({ VOICE_SESSION_SECRET: TEST_SECRET });
    const response = await handleSessionRequest(post("/api/voice/session", sessionBody()), testDeps());
    assert.equal(response.status, 503);
    assert.deepEqual(await readError(response), { ok: false, error: "unavailable" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("refuses an unknown tenant, broken JSON and a body that is too large", async () => {
    restoreEnv = localEnv();
    const deps = testDeps();
    const unknown = await handleSessionRequest(post("/api/voice/session", sessionBody({ tenant: "nobody" })), deps);
    assert.equal(unknown.status, 400);
    assert.equal((await readError(unknown)).error, "bad_request");
    const broken = await handleSessionRequest(post("/api/voice/session", "{tenant:"), deps);
    assert.equal(broken.status, 400);
    const huge = await handleSessionRequest(post("/api/voice/session", sessionBody({ page: "x".repeat(10_000) })), deps);
    assert.equal(huge.status, 413);
    assert.equal((await readError(huge)).error, "too_large");
  });

  it("checks the origin like the chat: foreign refused, own and allowed ones pass", async () => {
    restoreEnv = localEnv();
    const deps = testDeps();
    const foreign = await handleSessionRequest(post("/api/voice/session", sessionBody(), { Origin: "https://evil.example" }), deps);
    assert.equal(foreign.status, 403);
    assert.equal((await readError(foreign)).error, "forbidden");
    await open(deps, sessionBody(), { Origin: "https://site.example" });
    await open(deps, sessionBody(), { Origin: "https://www.modolodigitalstudio.ch" });
  });

  it("refuses a filled honeypot", async () => {
    restoreEnv = localEnv();
    const response = await handleSessionRequest(post("/api/voice/session", sessionBody({ hp: "I am a bot" })), testDeps());
    assert.equal(response.status, 403);
    assert.equal((await readError(response)).error, "forbidden");
  });

  it("grants a signed local session with the limits, and a lesser mode when asked for one not offered", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps);
    assert.equal(grant.mode, "local");
    assert.equal(grant.locale, "de");
    assert.equal(grant.expiresAt, Math.floor(T0 / 1000) * 1000 + (DEFAULT_VOICE_LIMITS.maxCallSeconds + 60) * 1000);
    assert.deepEqual(grant.limits, { maxCallSeconds: 180, warnBeforeEndSeconds: 20, silenceTimeoutSeconds: 25, maxTurnChars: 600 });
    assert.equal(grant.realtime, undefined);
    assert.match(grant.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);

    const lesser = await open(deps, sessionBody({ mode: "realtime" }));
    assert.equal(lesser.mode, "scripted");
    // A language the tenant speaks is kept; one it does not speak falls back to its default.
    assert.equal((await open(deps, sessionBody({ locale: "fr", mode: "scripted" }))).locale, "fr");
    assert.equal((await open(deps, sessionBody({ tenant: "demo-maler", locale: "it", mode: "scripted" }))).locale, "de");
  });

  it("turns away a busy tenant, then the same IP once its hourly sessions are used", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const ip = { "x-real-ip": "203.0.113.7" };
    await open(deps, sessionBody(), ip);
    await open(deps, sessionBody(), ip);
    const busy = await handleSessionRequest(post("/api/voice/session", sessionBody(), ip), deps);
    assert.equal(busy.status, 503);
    assert.deepEqual(await readError(busy), { ok: false, error: "busy", retryAfter: 30 });
    assert.equal(busy.headers.get("retry-after"), "30");
    const limited = await handleSessionRequest(post("/api/voice/session", sessionBody(), ip), deps);
    assert.equal(limited.status, 429);
    assert.equal((await readError(limited)).error, "rate_limited");
    // Examples have their own, larger allowance: the same visitor can still watch one.
    assert.equal((await open(deps, sessionBody({ mode: "scripted" }), ip)).mode, "scripted");
    // Nothing of the address is in any log line.
    assert.equal(logs.some((line) => line.includes("203.0.113.7")), false);
  });

  it("refuses a session that the monthly budget cannot cover", async () => {
    // A local session no longer reserves a minute price (0.06 CHF for 3 minutes before): it is
    // admitted when the month can pay for one model turn, which 0.001 CHF cannot.
    restoreEnv = localEnv({ VOICE_BUDGET_CHF_PER_MONTH: "0.001" });
    const response = await handleSessionRequest(post("/api/voice/session", sessionBody()), testDeps({ now: () => T0 }));
    assert.equal(response.status, 503);
    assert.equal((await readError(response)).error, "budget_exhausted");
    assert.ok(Number(response.headers.get("retry-after")) > 0);
  });

  it("hands out a realtime grant through the provider, and gives the reservation back when it fails", async () => {
    restoreEnv = setVoiceEnv({ VOICE_ENABLED: "true", VOICE_MODE: "realtime", VOICE_PROVIDER: "mock", VOICE_SESSION_SECRET: TEST_SECRET });
    const provider = createMockProvider({ now: () => T0 });
    const deps = testDeps({ now: () => T0, provider });
    const grant = await open(deps, sessionBody({ mode: "realtime" }));
    assert.equal(grant.mode, "realtime");
    assert.equal(grant.realtime?.provider, "mock");
    assert.match(grant.realtime?.token ?? "", /^mock_/);
    assert.equal(provider.calls[0].tenantId, "modolo");
    assert.equal(provider.calls[0].toolWebhookUrl, "https://site.example/api/voice/tool");
    assert.deepEqual(provider.calls[0].toolNames, ["create_lead", "end_call"]);

    provider.failWith("upstream");
    const failed = await handleSessionRequest(post("/api/voice/session", sessionBody({ mode: "realtime" })), deps);
    assert.equal(failed.status, 502);
    assert.equal((await readError(failed)).error, "upstream");
    // Only the successful session still counts as running.
    assert.equal((await usageSnapshot(deps.store, "modolo", T0)).running, 1);
  });
});

describe("POST /api/voice/turn", () => {
  it("speaks the greeting on the opening turn, as Server-Sent Events", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps);
    const response = await handleTurnRequest(turnRequest(grant.sessionToken, "", { opening: true }), deps);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const events = await readEvents(response);
    assert.equal(events[0].type, "start");
    assert.equal(spoken(events), MODOLO_VOICE_TENANT.greeting.de);
    assert.deepEqual(events[events.length - 1], { type: "done", ended: false, remainingTurns: 24, remainingSeconds: 180 });
  });

  it("refuses a request it cannot pass on when the tenant has no email service, and says so", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 }); // resend: null
    const grant = await open(deps);
    const events = await readEvents(await handleTurnRequest(turnRequest(grant.sessionToken, LEAD_UTTERANCE), deps));
    assert.deepEqual(
      events.filter((event) => event.type === "tool"),
      [
        { type: "tool", name: "create_lead", status: "started" },
        { type: "tool", name: "create_lead", status: "failed" },
      ],
    );
    assert.match(spoken(events), /\[Testantwort\] Das hat nicht geklappt \(unavailable\)/);
    assert.equal(logs.some((line) => line.includes("anna@example.ch") || line.includes("Anna Muster")), false, "no personal data in logs");
  });

  // The request used to reach the business only with the summary at the end of the session, so a
  // call that never reported its end lost it (integration report). It now goes out at once, and
  // the end report sends it no second time.
  it("takes a request, mails it at once, keeps it in the state and sends it only once", async () => {
    restoreEnv = localEnv();
    const send = emailRecorder();
    const deps = testDeps({ now: () => T0, resend: RESEND, sendEmail: send });
    const grant = await open(deps);
    await readEvents(await handleTurnRequest(turnRequest(grant.sessionToken, "", { opening: true }), deps));
    const events = await readEvents(await handleTurnRequest(turnRequest(grant.sessionToken, LEAD_UTTERANCE), deps));
    assert.ok(events.some((event) => event.type === "handoff" && event.handoff.kind === "written"));
    assert.deepEqual(events[events.length - 1], { type: "done", ended: false, remainingTurns: 23, remainingSeconds: 180 });
    assert.equal(send.sent.length, 1, "the request went out while the call ran");
    assert.match(send.sent[0].text, /während eines Gesprächs aufgenommen/);

    const sid = JSON.parse(Buffer.from(grant.sessionToken.split(".")[0], "base64url").toString("utf8")).sid as string;
    const state = await loadState(deps.store, sid);
    assert.equal(state?.outcomes.length, 1);
    assert.equal(state?.turns, 1);

    const ended = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "user" }), deps);
    assert.equal(ended.status, 200);
    assert.deepEqual(await ended.json(), { ok: true });
    assert.equal(send.sent.length, 1, "the end report did not send it again");
    assert.equal(send.sent[0].to, MODOLO_VOICE_TENANT.notifyEmail);
    assert.match(send.sent[0].subject, /Anfrage: Projektanfrage, Referenz LD-[2-9A-Z]{4}$/);
    assert.equal(await loadState(deps.store, sid), null, "the state is gone");

    // A second end report changes nothing and sends nothing.
    const again = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "unload" }), deps);
    assert.deepEqual(await again.json(), { ok: true });
    assert.equal(send.sent.length, 1);
    // And the closed session takes no more turns.
    const late = await handleTurnRequest(turnRequest(grant.sessionToken, "Noch etwas"), deps);
    assert.equal(late.status, 401);
    assert.equal((await readError(late)).error, "expired");
  });

  it("closes the session itself when the assistant ends the call", async () => {
    restoreEnv = localEnv();
    const send = emailRecorder();
    const deps = testDeps({ now: () => T0, resend: RESEND, sendEmail: send });
    const grant = await open(deps);
    await readEvents(await handleTurnRequest(turnRequest(grant.sessionToken, LEAD_UTTERANCE), deps));
    const events = await readEvents(await handleTurnRequest(turnRequest(grant.sessionToken, "Danke, tschüss"), deps));
    assert.deepEqual(events[events.length - 1], { type: "done", ended: true, remainingTurns: 22, remainingSeconds: 180 });
    assert.equal(send.sent.length, 1, "the request went out, and the closing sent it no second time");
    assert.equal((await usageSnapshot(deps.store, "modolo", T0)).running, 0, "the concurrency slot is free");
    const report = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "assistant" }), deps);
    assert.equal(report.status, 200);
    assert.equal(send.sent.length, 1);
  });

  it("refuses an expired token, a turn after the time is up, and a token of another mode", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps);
    // 3 minutes 1 second later: the token is still valid (grace for connecting), the call is not.
    const late = await handleTurnRequest(turnRequest(grant.sessionToken, "Hallo"), { ...deps, now: () => T0 + 181_000 });
    assert.equal(late.status, 429);
    assert.equal((await readError(late)).error, "session_limit");
    // 5 minutes later the token itself has expired.
    const expired = await handleTurnRequest(turnRequest(grant.sessionToken, "Hallo"), { ...deps, now: () => T0 + 300_000 });
    assert.equal(expired.status, 401);
    assert.equal((await readError(expired)).error, "expired");
    // An example's token cannot run a turn.
    const scripted = await open(deps, sessionBody({ mode: "scripted" }));
    const refused = await handleTurnRequest(turnRequest(scripted.sessionToken, "Hallo"), deps);
    assert.equal(refused.status, 403);
  });

  it("refuses an empty utterance and one longer than maxTurnChars", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps);
    assert.equal((await handleTurnRequest(turnRequest(grant.sessionToken, "   "), deps)).status, 400);
    const long = await handleTurnRequest(turnRequest(grant.sessionToken, "a".repeat(601)), deps);
    assert.equal(long.status, 413);
    assert.equal((await handleTurnRequest(post("/api/voice/turn", { sessionToken: 42, text: "Hallo" }), deps)).status, 403);
  });
});

describe("POST /api/voice/end", () => {
  it("accepts a text/plain beacon and frees the tenant's concurrency slot", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const first = await open(deps);
    await open(deps);
    assert.equal((await handleSessionRequest(post("/api/voice/session", sessionBody()), deps)).status, 503, "busy");
    const beacon = new Request("https://site.example/api/voice/end", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ sessionToken: first.sessionToken, reason: "unload" }),
    });
    const response = await handleEndRequest(beacon, deps);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    await open(deps); // a slot is free again
  });

  it("still closes a session whose end report comes a little after the token expired", async () => {
    restoreEnv = localEnv();
    const deps = testDeps({ now: () => T0 });
    const grant = await open(deps);
    const response = await handleEndRequest(post("/api/voice/end", { sessionToken: grant.sessionToken, reason: "unload" }), {
      ...deps,
      now: () => T0 + 300_000,
    });
    assert.equal(response.status, 200);
    assert.equal((await usageSnapshot(deps.store, "modolo", T0 + 300_000)).running, 0);
  });

  it("refuses a forged token and a body that is not one", async () => {
    restoreEnv = localEnv();
    const deps = testDeps();
    assert.equal((await handleEndRequest(post("/api/voice/end", { sessionToken: "abc.def", reason: "user" }), deps)).status, 403);
    assert.equal((await handleEndRequest(post("/api/voice/end", "not json"), deps)).status, 400);
    assert.equal((await handleEndRequest(post("/api/voice/end", { reason: "user" }), deps)).status, 400);
  });
});

describe("POST /api/voice/tool", () => {
  function signed(body: unknown, now: number, delivery: string, secret = WEBHOOK_SECRET): Request {
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(now / 1000);
    return new Request("https://site.example/api/voice/tool", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [TOOL_TIMESTAMP_HEADER]: String(timestamp),
        [TOOL_SIGNATURE_HEADER]: signWebhook(secret, timestamp, raw),
        [TOOL_DELIVERY_HEADER]: delivery,
      },
      body: raw,
    });
  }

  function realtimeEnv(): () => void {
    return setVoiceEnv({
      VOICE_ENABLED: "true",
      VOICE_MODE: "realtime",
      VOICE_PROVIDER: "mock",
      VOICE_SESSION_SECRET: TEST_SECRET,
      VOICE_PROVIDER_WEBHOOK_SECRET: WEBHOOK_SECRET,
      // The test below runs a demo business live, which only the lab allows (availableModes).
      VOICE_LAB: "true",
    });
  }

  it("does not exist without a webhook secret, or with one too short to trust", async () => {
    restoreEnv = localEnv();
    const response = await handleToolRequest(signed({}, Date.now(), "d1"), testDeps());
    assert.equal(response.status, 404);
    restoreEnv();
    restoreEnv = localEnv({ VOICE_PROVIDER_WEBHOOK_SECRET: "short" });
    assert.equal((await handleToolRequest(signed({}, Date.now(), "d2", "short"), testDeps())).status, 404);
  });

  it("runs a signed tool call for the tenant of the token, once per delivery", async () => {
    restoreEnv = realtimeEnv();
    const now = T0;
    const deps = testDeps({ now: () => now, provider: createMockProvider() });
    const grant = await open(deps, sessionBody({ tenant: "demo-coiffeur", mode: "realtime" }));
    const tomorrow = "2026-12-03"; // a Thursday: the salon is open
    const body = {
      sessionToken: grant.sessionToken,
      // A "tenant" here is ignored: the token decides.
      tenant: "modolo",
      call: { id: "call_1", name: "check_availability", input: { service: "women_cut", date: tomorrow } },
    };
    const response = await handleToolRequest(signed(body, now, "delivery-1"), deps);
    assert.equal(response.status, 200);
    const result = (await response.json()) as { ok: boolean; callId: string; result: { ok: boolean; code?: string; say: string } };
    assert.equal(result.ok, true);
    assert.equal(result.callId, "call_1");
    // The coiffeur's own calendar answered (a Modolo token would get not_enabled).
    assert.equal(result.result.ok, true);
    assert.match(result.result.say, /^Free start times for /);

    const replay = await handleToolRequest(signed(body, now, "delivery-1"), deps);
    assert.equal(replay.status, 409);
  });

  it("refuses a bad signature and a token that is not a realtime session's", async () => {
    restoreEnv = realtimeEnv();
    const now = Date.now();
    const deps = testDeps({ now: () => now, provider: createMockProvider() });
    const grant = await open(deps, sessionBody({ mode: "scripted" }));
    const body = { sessionToken: grant.sessionToken, call: { id: "c", name: "end_call", input: { reason: "caller_done" } } };
    const forged = await handleToolRequest(signed(body, now, "d-forged", "another-secret-0123456789"), deps);
    assert.equal(forged.status, 401);
    const wrongMode = await handleToolRequest(signed(body, now, "d-mode"), deps);
    assert.equal(wrongMode.status, 403);
  });
});
