// Realtime provider seam (lib/voice/server/providers/): provider selection, the mock provider,
// and openProviderSession() with its breaker, timeout and result checks.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createMemoryStore } from "@/lib/assistant/server/store";
import { BREAKER_FAILURE_THRESHOLD, BREAKER_OPEN_SECONDS, isOpen } from "@/lib/voice/server/breaker";
import type { VoiceEnv } from "@/lib/voice/server/env";
import { getRealtimeProvider, openProviderSession } from "@/lib/voice/server/providers";
import { createMockProvider, MOCK_TOKEN_TTL_SECONDS } from "@/lib/voice/server/providers/mock";
import type { CreateWebSessionArgs, RealtimeProvider } from "@/lib/voice/server/providers/types";
import type { VoiceToolDefinition } from "@/lib/voice/types";
import { createFakeStore } from "../assistant/fixtures";

/** 2026-11-25 12:00:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const SYSTEM_PROMPT = "You are the AI assistant of a fictional moving company. Secret rule 42.";

const TOOL: VoiceToolDefinition = {
  name: "check_availability",
  description: "Free slots on a day.",
  inputSchema: { type: "object", properties: { date: { type: "string" } }, required: ["date"], additionalProperties: false },
};

function session(overrides: Partial<CreateWebSessionArgs> = {}): Omit<CreateWebSessionArgs, "signal"> {
  return {
    tenantId: "demo-umzug",
    sessionId: "AAAAAAAAAAAAAAAAAAAAAA",
    locale: "de",
    maxSeconds: 180,
    systemPrompt: SYSTEM_PROMPT,
    greeting: "Grüezi, hier ist der digitale Assistent. Ich bin eine KI.",
    tools: [TOOL],
    toolWebhookUrl: "https://example.test/api/voice/tool",
    ...overrides,
  };
}

function envWithProvider(provider: VoiceEnv["provider"]): VoiceEnv {
  return { provider } as VoiceEnv;
}

let logLines: string[] = [];
beforeEach(() => {
  logLines = [];
  mock.method(console, "log", (line: unknown) => {
    logLines.push(String(line));
  });
});
afterEach(() => {
  mock.restoreAll();
});

describe("getRealtimeProvider", () => {
  it("returns null for 'none'", () => {
    assert.equal(getRealtimeProvider(envWithProvider("none")), null);
  });

  it("returns one mock instance per process for 'mock'", () => {
    const first = getRealtimeProvider(envWithProvider("mock"));
    assert.ok(first !== null);
    assert.equal(first.id, "mock");
    assert.equal(getRealtimeProvider(envWithProvider("mock")), first);
  });

  it("returns null for anything unknown", () => {
    assert.equal(getRealtimeProvider(envWithProvider("acme" as VoiceEnv["provider"])), null);
  });
});

describe("mock provider", () => {
  it("hands out an obviously fake, short-lived token", async () => {
    const provider = createMockProvider({ now: () => NOW });
    const result = await provider.createWebSession(session());
    assert.deepEqual(result, {
      ok: true,
      token: "mock_AAAAAAAAAAAAAAAAAAAAAA",
      expiresAt: NOW + MOCK_TOKEN_TTL_SECONDS * 1000,
      params: { provider: "mock" },
    });
  });

  it("records what it was asked, without the prompt text", async () => {
    const provider = createMockProvider();
    await provider.createWebSession(session());
    assert.deepEqual(provider.calls, [
      {
        tenantId: "demo-umzug",
        sessionId: "AAAAAAAAAAAAAAAAAAAAAA",
        locale: "de",
        maxSeconds: 180,
        toolNames: ["check_availability"],
        systemPromptChars: SYSTEM_PROMPT.length,
        greetingChars: session().greeting.length,
        toolWebhookUrl: "https://example.test/api/voice/tool",
      },
    ]);
    assert.ok(!JSON.stringify(provider.calls).includes("Secret rule"));
  });

  it("fails on command and recovers", async () => {
    const provider = createMockProvider();
    for (const code of ["unavailable", "upstream", "timeout"] as const) {
      provider.failWith(code);
      assert.deepEqual(await provider.createWebSession(session()), { ok: false, code });
    }
    provider.failWith(null);
    assert.equal((await provider.createWebSession(session())).ok, true);
  });

  it("gives up when its signal aborts while it is slow", async () => {
    const provider = createMockProvider({ delayMs: 5_000 });
    const controller = new AbortController();
    const pending = provider.createWebSession({ ...session(), signal: controller.signal });
    controller.abort();
    assert.deepEqual(await pending, { ok: false, code: "timeout" });
  });

  it("remembers ended sessions", async () => {
    const provider = createMockProvider();
    await provider.endSession?.("mock_AAAAAAAAAAAAAAAAAAAAAA");
    assert.deepEqual(provider.ended, ["mock_AAAAAAAAAAAAAAAAAAAAAA"]);
  });
});

describe("openProviderSession", () => {
  it("passes a successful session through", async () => {
    const provider = createMockProvider({ now: () => NOW });
    const result = await openProviderSession({ provider, store: createMemoryStore(), session: session(), now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.token, "mock_AAAAAAAAAAAAAAAAAAAAAA");
    const line = logLines.map((text) => JSON.parse(text) as Record<string, unknown>).find((event) => event.op === "provider_session");
    assert.equal(line?.outcome, "ok");
    assert.ok(!logLines.join("\n").includes("Secret rule") && !logLines.join("\n").includes("mock_AAAA"));
  });

  it("opens the breaker after repeated upstream failures and then stops calling the provider", async () => {
    const store = createMemoryStore();
    const provider = createMockProvider({ failWith: "upstream" });
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i++) {
      const result = await openProviderSession({ provider, store, session: session(), now: NOW + i * 1000 });
      assert.deepEqual(result, { ok: false, code: "upstream" });
    }
    assert.equal(await isOpen(store, "demo-umzug", "mock", NOW + 5000), true);
    assert.ok(logLines.some((line) => line.includes("breaker_opened")));

    const callsBefore = provider.calls.length;
    provider.failWith(null);
    const refused = await openProviderSession({ provider, store, session: session(), now: NOW + 6000 });
    assert.deepEqual(refused, { ok: false, code: "unavailable" });
    assert.equal(provider.calls.length, callsBefore);

    // After the open period the provider is tried again, and a success closes the breaker.
    const later = NOW + (BREAKER_OPEN_SECONDS + 10) * 1000;
    const retried = await openProviderSession({ provider, store, session: session(), now: later });
    assert.equal(retried.ok, true);
    assert.equal(await isOpen(store, "demo-umzug", "mock", later), false);
  });

  it("keeps one tenant's open breaker away from the others", async () => {
    const store = createMemoryStore();
    const provider = createMockProvider({ failWith: "timeout" });
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i++) {
      await openProviderSession({ provider, store, session: session(), now: NOW });
    }
    provider.failWith(null);
    const other = await openProviderSession({ provider, store, session: session({ tenantId: "demo-salon" }), now: NOW });
    assert.equal(other.ok, true);
  });

  it("cuts a slow provider at the timeout and counts it as a failure", async () => {
    const { store, data } = createFakeStore();
    const provider = createMockProvider({ delayMs: 5_000 });
    const started = Date.now();
    const result = await openProviderSession({ provider, store, session: session(), timeoutMs: 100, now: NOW });
    assert.deepEqual(result, { ok: false, code: "timeout" });
    assert.ok(Date.now() - started < 2_000);
    assert.ok([...data.keys()].some((key) => key.startsWith("mva:brk:demo-umzug:mock:f:")));
  });

  it("cuts an adapter that ignores its signal", async () => {
    const stuck: RealtimeProvider = { id: "stuck", createWebSession: () => new Promise(() => undefined) };
    const result = await openProviderSession({ provider: stuck, store: createMemoryStore(), session: session(), timeoutMs: 100 });
    assert.deepEqual(result, { ok: false, code: "timeout" });
  });

  it("does not blame the provider when the caller went away", async () => {
    const { store, data } = createFakeStore();
    const provider = createMockProvider({ delayMs: 5_000 });
    const controller = new AbortController();
    const pending = openProviderSession({ provider, store, session: session(), signal: controller.signal, now: NOW });
    setTimeout(() => controller.abort(), 20);
    assert.deepEqual(await pending, { ok: false, code: "timeout" });
    assert.ok(![...data.keys()].some((key) => key.includes(":f:")));
  });

  it("does not count 'unavailable' (no call was made) against the provider", async () => {
    const { store, data } = createFakeStore();
    const provider = createMockProvider({ failWith: "unavailable" });
    for (let i = 0; i < 10; i++) await openProviderSession({ provider, store, session: session(), now: NOW });
    assert.ok(![...data.keys()].some((key) => key.includes(":f:")));
  });

  it("turns a throwing adapter into 'upstream'", async () => {
    const throwing: RealtimeProvider = {
      id: "throwing",
      createWebSession: () => {
        throw new Error("boom with sk-secret-key inside");
      },
    };
    const result = await openProviderSession({ provider: throwing, store: createMemoryStore(), session: session() });
    assert.deepEqual(result, { ok: false, code: "upstream" });
    assert.ok(!logLines.join("\n").includes("sk-secret-key"));
  });

  it("turns a malformed adapter answer into 'upstream'", async () => {
    const answers: unknown[] = [
      null,
      "token",
      { ok: true },
      { ok: true, token: "", expiresAt: NOW },
      { ok: true, token: "t".repeat(5000), expiresAt: NOW },
      { ok: true, token: "tok", expiresAt: "soon" },
      { ok: true, token: "tok", expiresAt: NOW, params: { region: 1 } },
      { ok: true, token: "tok", expiresAt: NOW, params: ["x"] },
      { ok: false, code: "teapot" },
    ];
    for (const answer of answers) {
      const odd = { id: "odd", createWebSession: async () => answer } as unknown as RealtimeProvider;
      const result = await openProviderSession({ provider: odd, store: createMemoryStore(), session: session() });
      assert.deepEqual(result, { ok: false, code: "upstream" }, JSON.stringify(answer));
    }
  });

  it("passes only string params through", async () => {
    const good: RealtimeProvider = {
      id: "good",
      createWebSession: async () => ({ ok: true, token: "tok", expiresAt: NOW, params: { region: "eu" } }),
    };
    const result = await openProviderSession({ provider: good, store: createMemoryStore(), session: session() });
    assert.deepEqual(result, { ok: true, token: "tok", expiresAt: NOW, params: { region: "eu" } });
  });
});
