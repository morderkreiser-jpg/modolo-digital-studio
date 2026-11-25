// Regression tests of the second review that are not about
// abuse of the limits (those are in limits-abuse.test.ts): the stage a page mounts (N1), the
// realtime prompt's opening hours (S2-5), the tool route's time budget and delivery ids (S2-7),
// and a lead whose email went unanswered (S2-8). Nothing calls a real provider or sends email.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { DEMO_TENANTS, scriptsFor } from "@/lib/voice/demos";
import { availableModes } from "@/lib/voice/server/env";
import {
  handleSessionRequest,
  handleToolRequest,
  TOOL_DELIVERY_HEADER,
  TOOL_LOCK_WAIT_MS,
  TOOL_SIGNATURE_HEADER,
  TOOL_TIMESTAMP_HEADER,
  type VoiceDeps,
} from "@/lib/voice/server/handlers";
import { voiceStageSetup } from "@/lib/voice/server/mount-config";
import type { RealtimeProvider } from "@/lib/voice/server/providers";
import { createSessionSinks } from "@/lib/voice/server/session";
import { EMAIL_TIMEOUT_MS, sendWithResend, type SendEmail } from "@/lib/voice/server/summary";
import { signWebhook, wasSeen } from "@/lib/voice/server/webhook";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { executeTool, type ToolContext, type ToolSinks } from "@/lib/voice/tools/execute";
import { DEFAULT_VOICE_LIMITS, type CallSummary, type SessionGrant } from "@/lib/voice/types";
import {
  captureLogs,
  importVoiceRoute,
  post,
  readGrant,
  sessionBody,
  setVoiceEnv,
  TEST_SECRET,
  testDeps,
  WEBHOOK_SECRET,
} from "./voice-fixtures";

/** Wednesday 2 December 2026, 10:00 in Zurich. */
const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);
const RESEND = { apiKey: "re_test_key", from: "Modolo Digital Studio <test@example.ch>" };
const LEAD_INPUT = {
  task: "project_request",
  fields: { service: "website", problem: "Eine neue Website für ein Café" },
  name: "Anna Muster",
  email: "anna@example.ch",
  summary: "Website",
};

let restoreEnv: () => void = () => undefined;
beforeEach(() => {
  captureLogs();
});
afterEach(() => {
  restoreEnv();
  restoreEnv = () => undefined;
  mock.restoreAll();
});

function realtimeEnv(extra: Parameters<typeof setVoiceEnv>[0] = {}): () => void {
  return setVoiceEnv({
    VOICE_ENABLED: "true",
    VOICE_MODE: "realtime",
    VOICE_PROVIDER: "mock",
    VOICE_SESSION_SECRET: TEST_SECRET,
    VOICE_PROVIDER_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...extra,
  });
}

async function open(deps: VoiceDeps, body: Record<string, unknown>): Promise<SessionGrant> {
  const response = await handleSessionRequest(post("/api/voice/session", body), deps);
  assert.equal(response.status, 200, `session refused: ${await response.clone().text()}`);
  return readGrant(response);
}

function signed(body: unknown, now: number, delivery: string): Request {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(now / 1000);
  return new Request("https://site.example/api/voice/tool", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [TOOL_TIMESTAMP_HEADER]: String(timestamp),
      [TOOL_SIGNATURE_HEADER]: signWebhook(WEBHOOK_SECRET, timestamp, raw),
      [TOOL_DELIVERY_HEADER]: delivery,
    },
    body: raw,
  });
}

// ---------------------------------------------------------------------------------------------
// N1: the stage a page mounts offers what the session route grants
// ---------------------------------------------------------------------------------------------

describe("review N1: a demo stage offers only what the session route grants a demo business", () => {
  const on = { enabled: true, mode: "local" as const, lab: false, limits: {} };

  it("with voice on and the lab off, a demo business gets the written example only", () => {
    const setup = voiceStageSetup({ env: on, locale: "de", tenantId: "demo-sanitaer", scripts: scriptsFor("demo-sanitaer") });
    assert.ok(setup);
    assert.deepEqual(setup.config.modes, ["scripted"]);
    assert.ok(setup.scripts.length > 0, "its examples still play");
  });

  it("Modolo's own stage, and a demo in the lab, get the live mode", () => {
    assert.deepEqual(voiceStageSetup({ env: on, locale: "de" })?.config.modes, ["local", "scripted"]);
    const lab = voiceStageSetup({ env: { ...on, lab: true }, locale: "de", tenantId: "demo-sanitaer" });
    assert.deepEqual(lab?.config.modes, ["local", "scripted"]);
  });

  it("agrees with the session route for every tenant, in every mode", () => {
    for (const mode of ["scripted", "local", "realtime"] as const) {
      for (const lab of [false, true]) {
        for (const tenant of [MODOLO_VOICE_TENANT, ...DEMO_TENANTS]) {
          const env = { enabled: true, mode, lab, limits: {} };
          const setup = voiceStageSetup({ env, locale: "de", tenantId: tenant.id });
          assert.deepEqual(setup?.config.modes, availableModes(env, tenant), `${tenant.id} ${mode} lab=${lab}`);
        }
      }
    }
  });

  it("with voice off, plays the examples of their own business, and shows nothing without them", () => {
    const off = { ...on, enabled: false };
    const setup = voiceStageSetup({ env: off, locale: "de", tenantId: "modolo", scripts: scriptsFor("demo-coiffeur") });
    assert.equal(setup?.config.tenant, "demo-coiffeur");
    assert.deepEqual(setup?.config.modes, ["scripted"]);
    assert.equal(voiceStageSetup({ env: off, locale: "de" }), null);
    assert.equal(voiceStageSetup({ env: on, locale: "de", tenantId: "nobody" }), null);
  });
});

// ---------------------------------------------------------------------------------------------
// S2-5: the realtime prompt knows whether the business is open
// ---------------------------------------------------------------------------------------------

describe("review S2-5: the realtime provider is told whether the business is open now", () => {
  it("says closed on a Sunday evening and open on a Thursday morning, like the text-turn mode", async () => {
    restoreEnv = realtimeEnv({ VOICE_LAB: "true" });
    const prompts: string[] = [];
    const provider: RealtimeProvider = {
      id: "capture",
      confirmsCalls: true,
      async createWebSession(args) {
        prompts.push(args.systemPrompt);
        return { ok: true, token: "capture_token", expiresAt: T0 + 60_000 };
      },
    };
    // Sunday 6 December 2026, 22:00 in Zurich: the salon is closed.
    const sunday = Date.UTC(2026, 11, 6, 21, 0, 0);
    await open(testDeps({ now: () => sunday, provider }), sessionBody({ tenant: "demo-coiffeur", mode: "realtime" }));
    assert.match(prompts[0], /- Business: closed now; next opening /);
    assert.doesNotMatch(prompts[0], /- Business: open now/);
    // Thursday 3 December 2026, 10:00: open.
    await open(testDeps({ now: () => T0 + 86_400_000, provider }), sessionBody({ tenant: "demo-coiffeur", mode: "realtime" }));
    assert.match(prompts[1], /- Business: open now/);
  });
});

// ---------------------------------------------------------------------------------------------
// S2-7: the tool route's time budget, and delivery ids marked once the action is done
// ---------------------------------------------------------------------------------------------

describe("review S2-7: a tool call fits in its route's time, and its delivery counts once it is done", () => {
  it("the wait for the lock plus the slowest email leave room within maxDuration", async () => {
    // The route file imports next/server since it keeps the function alive (keep-alive.ts): it is
    // loaded through the fixture's resolve hook.
    const { maxDuration: toolRouteMaxDuration } = await importVoiceRoute("tool");
    // Two seconds of margin for the store round trips and the rest of the request.
    assert.ok(TOOL_LOCK_WAIT_MS + EMAIL_TIMEOUT_MS + 2_000 <= toolRouteMaxDuration * 1000, `${TOOL_LOCK_WAIT_MS} + ${EMAIL_TIMEOUT_MS}`);
  });

  it("the delivery id is not marked while the action runs, only after it", async () => {
    restoreEnv = realtimeEnv();
    const deps = testDeps({ now: () => T0 });
    const seenDuringAction: boolean[] = [];
    const sinks = (): ToolSinks => ({
      async lead() {
        seenDuringAction.push(await wasSeen(deps.store, "tool:delivery-lead"));
        return { ok: true, ref: "LD-TEST" };
      },
      async callback() {
        return { ok: false };
      },
      async transfer() {
        return { connected: false };
      },
    });
    const grant = await open({ ...deps, sinks }, sessionBody({ mode: "realtime" }));
    const body = { sessionToken: grant.sessionToken, call: { id: "call_lead", name: "create_lead", input: LEAD_INPUT } };
    const response = await handleToolRequest(signed(body, T0, "delivery-lead"), { ...deps, sinks });
    assert.equal(response.status, 200);
    assert.deepEqual(seenDuringAction, [false]);
    assert.equal(await wasSeen(deps.store, "tool:delivery-lead"), true);
    assert.equal((await handleToolRequest(signed(body, T0, "delivery-lead"), { ...deps, sinks })).status, 409, "a replay after it is done");
  });
});

// ---------------------------------------------------------------------------------------------
// S2-8: an email service that answers too late
// ---------------------------------------------------------------------------------------------

function leadContext(sinks: ToolSinks): ToolContext & { outcomes: CallSummary["outcomes"] } {
  const outcomes: CallSummary["outcomes"] = [];
  return {
    tenant: MODOLO_VOICE_TENANT,
    sessionId: "ReviewTwoSession000001",
    locale: "de",
    channel: "web",
    now: new Date(T0),
    limits: DEFAULT_VOICE_LIMITS,
    counters: { toolCalls: 0, bookings: 0, leads: 0 },
    calendar: null,
    sinks,
    record: (outcome) => {
      outcomes.push(outcome);
    },
    outcomes,
  };
}

describe("review S2-8: a lead whose email was not confirmed in time", () => {
  it("sends Resend an idempotency key, and calls a timeout unknown rather than failed", async () => {
    const requests: Array<{ headers: Headers }> = [];
    let answer: "ok" | "timeout" | "refused" = "ok";
    mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      requests.push({ headers: new Headers(init.headers) });
      if (answer === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      return new Response("{}", { status: answer === "ok" ? 200 : 422 });
    });
    const send = sendWithResend(RESEND);
    const email = { from: RESEND.from, to: "info@example.ch", subject: "Anfrage", text: "Text", idempotencyKey: "mva-request-abc" };
    assert.equal(await send(email), true);
    assert.equal(requests[0].headers.get("idempotency-key"), "mva-request-abc");
    answer = "timeout";
    assert.equal(await send(email), "unknown");
    answer = "refused";
    assert.equal(await send(email), false);
    const { idempotencyKey: _unused, ...withoutKey } = email;
    void _unused;
    answer = "ok";
    await send(withoutKey);
    assert.equal(requests[3].headers.get("idempotency-key"), null);
  });

  it("tells the caller it is not certain, and a repeat goes out under the same key and the same reference", async () => {
    const sent: Array<Parameters<SendEmail>[0]> = [];
    let next: boolean | "unknown" = "unknown";
    const send: SendEmail = async (email) => {
      sent.push(email);
      return next;
    };
    const ctx = leadContext(createSessionSinks(MODOLO_VOICE_TENANT, RESEND, { send, session: { channel: "web", startedAt: T0 } }));
    const first = await executeTool(ctx, { id: "call_1", name: "create_lead", input: LEAD_INPUT });
    assert.equal(first.ok, false);
    assert.match(first.say, /^It is not certain that the request reached the team/);
    assert.doesNotMatch(first.say, /Nothing was passed on/);
    assert.equal(ctx.outcomes.length, 0);

    next = true;
    const second = await executeTool(ctx, { id: "call_2", name: "create_lead", input: LEAD_INPUT });
    assert.ok(second.ok, second.say);
    assert.equal(sent.length, 2);
    assert.ok(sent[0].idempotencyKey);
    assert.equal(sent[1].idempotencyKey, sent[0].idempotencyKey, "the email service sees the same request");
    assert.equal(sent[1].subject, sent[0].subject, "the same reference, so the same message");
    assert.equal(sent[1].text, sent[0].text);
    const ref = (second.data as { reference: string }).reference;
    assert.ok(sent[0].subject.includes(ref), "the caller hears the reference of the email the business has");
    assert.equal(ctx.outcomes.length, 1);
    // A third time is answered from memory: nothing more is sent.
    assert.ok((await executeTool(ctx, { id: "call_3", name: "create_lead", input: LEAD_INPUT })).ok);
    assert.equal(sent.length, 2);
  });

  it("a plain failure still says nothing was passed on", async () => {
    const send: SendEmail = async () => false;
    const ctx = leadContext(createSessionSinks(MODOLO_VOICE_TENANT, RESEND, { send, session: { channel: "web", startedAt: T0 } }));
    const outcome = await executeTool(ctx, { id: "call_1", name: "create_lead", input: LEAD_INPUT });
    assert.equal(outcome.ok, false);
    assert.match(outcome.say, /Nothing was passed on/);
  });
});
