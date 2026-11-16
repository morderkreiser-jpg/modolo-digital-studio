// Environment parsing (lib/assistant/server/env.ts) under a fully controlled process.env:
// defaults, kill switches, clamps, ignored junk, store selection and the limit/AI precedence.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { canDeliverLeads, getAssistantEnv, resolveAiSettings, resolveLimits } from "@/lib/assistant/server/env";
import { DEFAULT_LIMITS } from "@/lib/assistant/types";
import { makeTenant, setAssistantEnv } from "./fixtures";
import type { AssistantEnvKey } from "./fixtures";

const KEY = "sk-ant-test-0123456789";
let restore: (() => void) | null = null;

/** Run getAssistantEnv() with exactly these assistant variables set. */
function envWith(vars: Partial<Record<AssistantEnvKey, string>>) {
  restore?.();
  restore = setAssistantEnv(vars);
  return getAssistantEnv();
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe("getAssistantEnv: enablement", () => {
  it("is disabled without an API key", () => {
    const env = envWith({});
    assert.equal(env.enabled, false);
    assert.equal(env.disabledReason, "no_api_key");
    assert.equal(env.apiKey, null);
  });

  it("is enabled with defaults when only the API key is set", () => {
    const env = envWith({ ANTHROPIC_API_KEY: KEY });
    assert.equal(env.enabled, true);
    assert.equal(env.disabledReason, null);
    assert.equal(env.apiKey, KEY);
    assert.equal(env.model, "claude-haiku-5-5");
    assert.equal(env.advancedModel, null);
    assert.equal(env.routing, null);
    assert.equal(env.effort, null);
    assert.equal(env.maxOutputTokens, null);
    assert.equal(env.timeoutMs, 30_000);
    assert.equal(env.adminToken, null);
    assert.deepEqual(env.limits, {});
    assert.equal(env.leadRetentionDays, null);
    assert.equal(env.leadTo, null);
    assert.equal(env.leadCopy, false);
    assert.equal(env.resend, null);
    assert.deepEqual(env.store, { kind: "memory" });
  });

  it("ASSISTANT_ENABLED=false is a kill switch; any other value leaves it on", () => {
    const off = envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_ENABLED: "false" });
    assert.equal(off.enabled, false);
    assert.equal(off.disabledReason, "flag");
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_ENABLED: "true" }).enabled, true);
  });

  it("reads process.env on every call", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY }).enabled, true);
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(getAssistantEnv().enabled, false);
  });
});

describe("getAssistantEnv: models, effort, tokens, timeout", () => {
  it("passes valid model, routing and effort settings through", () => {
    const env = envWith({
      ANTHROPIC_API_KEY: KEY,
      ASSISTANT_MODEL: "claude-sonnet-5-5",
      ASSISTANT_MODEL_ADVANCED: "claude-opus-5-5",
      ASSISTANT_MODEL_ROUTING: "auto",
      ASSISTANT_EFFORT: "medium",
    });
    assert.equal(env.model, "claude-sonnet-5-5");
    assert.equal(env.advancedModel, "claude-opus-5-5");
    assert.equal(env.routing, "auto");
    assert.equal(env.effort, "medium");
  });

  it("ignores unknown routing and effort values", () => {
    const env = envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_MODEL_ROUTING: "turbo", ASSISTANT_EFFORT: "max" });
    assert.equal(env.routing, null);
    assert.equal(env.effort, null);
  });

  it("clamps ASSISTANT_MAX_OUTPUT_TOKENS to 256..4096", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_MAX_OUTPUT_TOKENS: "100" }).maxOutputTokens, 256);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_MAX_OUTPUT_TOKENS: "99999" }).maxOutputTokens, 4096);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_MAX_OUTPUT_TOKENS: "2048" }).maxOutputTokens, 2048);
  });

  it("clamps ASSISTANT_TIMEOUT_MS to 5000..120000", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_TIMEOUT_MS: "10" }).timeoutMs, 5000);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_TIMEOUT_MS: "999999" }).timeoutMs, 120_000);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_TIMEOUT_MS: "45000" }).timeoutMs, 45_000);
  });

  it("ignores non-numeric token and timeout values", () => {
    const env = envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_MAX_OUTPUT_TOKENS: "lots", ASSISTANT_TIMEOUT_MS: "soon" });
    assert.equal(env.maxOutputTokens, null);
    assert.equal(env.timeoutMs, 30_000);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_MAX_OUTPUT_TOKENS: "" }).maxOutputTokens, null);
  });
});

describe("getAssistantEnv: limits and secrets", () => {
  it("maps the four limit variables", () => {
    const env = envWith({
      ANTHROPIC_API_KEY: KEY,
      ASSISTANT_DAILY_BUDGET_USD: "2.5",
      ASSISTANT_MONTHLY_BUDGET_USD: "40",
      ASSISTANT_DAILY_REQUEST_LIMIT: "500",
      ASSISTANT_SESSION_MESSAGE_LIMIT: "12",
    });
    assert.deepEqual(env.limits, {
      tenantBudgetUsdPerDay: 2.5,
      tenantBudgetUsdPerMonth: 40,
      tenantRequestsPerDay: 500,
      maxUserMessagesPerSession: 12,
    });
  });

  it("ignores invalid limit values instead of applying them", () => {
    const env = envWith({
      ANTHROPIC_API_KEY: KEY,
      ASSISTANT_DAILY_BUDGET_USD: "-5",
      ASSISTANT_MONTHLY_BUDGET_USD: "a lot",
      ASSISTANT_DAILY_REQUEST_LIMIT: "-1",
      ASSISTANT_SESSION_MESSAGE_LIMIT: "many",
    });
    assert.deepEqual(env.limits, {});
  });

  it("uses ASSISTANT_HASH_SALT verbatim when set", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_HASH_SALT: "custom-salt" }).hashSalt, "custom-salt");
  });

  it("derives a stable salt from the API key without exposing the key", () => {
    const first = envWith({ ANTHROPIC_API_KEY: KEY }).hashSalt;
    const again = envWith({ ANTHROPIC_API_KEY: KEY }).hashSalt;
    const other = envWith({ ANTHROPIC_API_KEY: `${KEY}-other` }).hashSalt;
    assert.ok(first.length >= 16);
    assert.equal(first, again);
    assert.notEqual(first, other);
    assert.ok(!first.includes(KEY) && !first.includes("0123456789"), "the salt must not contain the key");
  });

  it("falls back to the development salt without key and salt", () => {
    assert.equal(envWith({}).hashSalt, "mda-dev-salt");
  });

  it("accepts an admin token only from 24 characters", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_ADMIN_TOKEN: "short-token" }).adminToken, null);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_ADMIN_TOKEN: "a".repeat(23) }).adminToken, null);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_ADMIN_TOKEN: "a".repeat(24) }).adminToken, "a".repeat(24));
  });
});

describe("getAssistantEnv: leads and delivery", () => {
  it("reads the lead retention override and ignores junk", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_RETENTION_DAYS: "30" }).leadRetentionDays, 30);
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_RETENTION_DAYS: "forever" }).leadRetentionDays, null);
  });

  it("accepts ASSISTANT_LEAD_TO only when it is an email address", () => {
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_TO: "leads@example.ch" }).leadTo, "leads@example.ch");
    assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_TO: "not-an-email" }).leadTo, null);
  });

  it("configures Resend from RESEND_API_KEY with CONTACT_FROM or the default sender", () => {
    assert.deepEqual(envWith({ ANTHROPIC_API_KEY: KEY, RESEND_API_KEY: "re_test_1" }).resend, {
      apiKey: "re_test_1",
      from: "Modolo Digital Studio <onboarding@resend.dev>",
    });
    assert.deepEqual(
      envWith({ ANTHROPIC_API_KEY: KEY, RESEND_API_KEY: "re_test_1", CONTACT_FROM: "Studio <info@example.ch>" }).resend,
      { apiKey: "re_test_1", from: "Studio <info@example.ch>" },
    );
  });

  it("selects Upstash from either env pair, and only when URL and token are both set", () => {
    const kv = envWith({ ANTHROPIC_API_KEY: KEY, KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "kv-token" });
    assert.deepEqual(kv.store, { kind: "upstash", url: "https://kv.example", token: "kv-token" });
    const upstash = envWith({
      ANTHROPIC_API_KEY: KEY,
      UPSTASH_REDIS_REST_URL: "https://up.example",
      UPSTASH_REDIS_REST_TOKEN: "up-token",
    });
    assert.deepEqual(upstash.store, { kind: "upstash", url: "https://up.example", token: "up-token" });
    assert.deepEqual(envWith({ ANTHROPIC_API_KEY: KEY, KV_REST_API_URL: "https://kv.example" }).store, { kind: "memory" });
    assert.deepEqual(envWith({ ANTHROPIC_API_KEY: KEY, UPSTASH_REDIS_REST_TOKEN: "up-token" }).store, { kind: "memory" });
  });

  it("turns the stored lead copy on only for ASSISTANT_LEAD_COPY=true (trimmed, any case)", () => {
    for (const value of ["true", "TRUE", "True", " true\n"]) {
      assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_COPY: value }).leadCopy, true, JSON.stringify(value));
    }
    for (const value of ["", "false", "1", "yes", "on", "truthy", "true1", "t"]) {
      assert.equal(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_COPY: value }).leadCopy, false, JSON.stringify(value));
    }
  });
});

describe("canDeliverLeads", () => {
  const KV = { KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "kv-token" } as const;

  it("is true with Resend, whatever the store", () => {
    assert.equal(canDeliverLeads(envWith({ ANTHROPIC_API_KEY: KEY, RESEND_API_KEY: "re_test_1" })), true);
    assert.equal(canDeliverLeads(envWith({ ANTHROPIC_API_KEY: KEY, RESEND_API_KEY: "re_test_1", ...KV })), true);
  });

  it("counts Upstash as a channel only with the ASSISTANT_LEAD_COPY opt-in (privacy by default)", () => {
    assert.equal(canDeliverLeads(envWith({ ANTHROPIC_API_KEY: KEY, ...KV })), false, "Upstash for the counters alone");
    assert.equal(canDeliverLeads(envWith({ ANTHROPIC_API_KEY: KEY, ...KV, ASSISTANT_LEAD_COPY: "true" })), true);
  });

  it("is false without any channel, and the opt-in alone does not make one", () => {
    assert.equal(canDeliverLeads(envWith({ ANTHROPIC_API_KEY: KEY })), false);
    assert.equal(canDeliverLeads(envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_LEAD_COPY: "true" })), false);
  });
});

describe("resolveLimits", () => {
  it("layers DEFAULT_LIMITS ← tenant.limits ← env limits", () => {
    const tenant = makeTenant({ limits: { ipPerMinute: 3, maxUserMessagesPerSession: 10, tenantBudgetUsdPerDay: 2 } });
    const env = envWith({ ANTHROPIC_API_KEY: KEY, ASSISTANT_SESSION_MESSAGE_LIMIT: "4" });
    const limits = resolveLimits(tenant, env);
    assert.deepEqual(limits, { ...DEFAULT_LIMITS, ipPerMinute: 3, maxUserMessagesPerSession: 4, tenantBudgetUsdPerDay: 2 });
  });

  it("returns the defaults for a tenant without overrides and a bare env", () => {
    assert.deepEqual(resolveLimits(makeTenant(), envWith({ ANTHROPIC_API_KEY: KEY })), DEFAULT_LIMITS);
  });
});

describe("resolveAiSettings", () => {
  it("defaults to the fast model, low effort, 2048 output tokens and 30 s", () => {
    const ai = resolveAiSettings(makeTenant(), envWith({ ANTHROPIC_API_KEY: KEY }));
    assert.deepEqual(ai, {
      model: "claude-haiku-5-5",
      advancedModel: null,
      routing: "fast",
      effort: "low",
      maxOutputTokens: 2048,
      timeoutMs: 30_000,
    });
  });

  it("uses the tenant's AI settings when the env is silent, and the env when it is not", () => {
    const tenant = makeTenant({ ai: { rules: [], effort: "medium", maxOutputTokens: 900, routing: "auto" } });
    const fromTenant = resolveAiSettings(tenant, envWith({ ANTHROPIC_API_KEY: KEY }));
    assert.equal(fromTenant.effort, "medium");
    assert.equal(fromTenant.maxOutputTokens, 900);
    assert.equal(fromTenant.routing, "auto");

    const env = envWith({
      ANTHROPIC_API_KEY: KEY,
      ASSISTANT_EFFORT: "high",
      ASSISTANT_MAX_OUTPUT_TOKENS: "2000",
      ASSISTANT_MODEL_ROUTING: "advanced",
      ASSISTANT_MODEL_ADVANCED: "claude-sonnet-5-5",
      ASSISTANT_TIMEOUT_MS: "20000",
    });
    assert.deepEqual(resolveAiSettings(tenant, env), {
      model: "claude-haiku-5-5",
      advancedModel: "claude-sonnet-5-5",
      routing: "advanced",
      effort: "high",
      maxOutputTokens: 2000,
      timeoutMs: 20_000,
    });
  });
});
