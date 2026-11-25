// Voice configuration (lib/voice/server/env.ts) under a fully controlled process.env: defaults,
// the on switch, fallbacks for junk, the session secret, degradation of modes, limit precedence
// and clamping. Also the log guard (lib/voice/server/log.ts), which env.ts is the first user of.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  availableModes,
  DEFAULT_VOICE_MAX_OUTPUT_TOKENS,
  DEFAULT_VOICE_MODEL,
  getVoiceEnv,
  resetVoiceEnvForTests,
  resolveVoiceLimits,
  voiceCostChfPerMinute,
  VOICE_LIMIT_RANGES,
  type VoiceEnv,
} from "@/lib/voice/server/env";
import { isSensitiveLogField, logVoiceEvent, sanitizeVoiceLogFields } from "@/lib/voice/server/log";
import { DEFAULT_VOICE_LIMITS, type VoiceLimits } from "@/lib/voice/types";

const ENV_KEYS = [
  "VOICE_ENABLED",
  "VOICE_MODE",
  "VOICE_BRAIN",
  "VOICE_MODEL",
  "VOICE_MAX_OUTPUT_TOKENS",
  "VOICE_SESSION_SECRET",
  "VOICE_PROVIDER",
  "VOICE_PROVIDER_API_KEY",
  "VOICE_COST_CHF_PER_MINUTE",
  "VOICE_ALERT_EMAIL",
  "VOICE_LAB",
  "VOICE_MAX_CALL_SECONDS",
  "VOICE_MINUTES_PER_DAY",
  "VOICE_MINUTES_PER_MONTH",
  "VOICE_BUDGET_CHF_PER_MONTH",
  "VOICE_MAX_CONCURRENT",
  "ANTHROPIC_API_KEY",
  "ASSISTANT_HASH_SALT",
  "NODE_ENV",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const SECRET = "test-secret-0123456789-abcdefghijkl"; // 35 characters
const KEY = "sk-ant-test-0123456789";
// Next types NODE_ENV as read-only; tests need to set it.
const mutableEnv: Record<string, string | undefined> = process.env;
const saved = new Map<string, string | undefined>();
let logLines: string[] = [];

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, mutableEnv[key]);
  logLines = [];
  mock.method(console, "log", (line: unknown) => {
    logLines.push(String(line));
  });
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  mock.restoreAll();
  resetVoiceEnvForTests();
});

/** getVoiceEnv() with exactly these variables set (and a fresh cache). */
function envWith(vars: Partial<Record<EnvKey, string>>): VoiceEnv {
  for (const key of ENV_KEYS) delete mutableEnv[key];
  for (const [key, value] of Object.entries(vars)) mutableEnv[key] = value;
  resetVoiceEnvForTests();
  return getVoiceEnv();
}

function warnings(name: string): Array<Record<string, unknown>> {
  return logLines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((event) => event.warn === name);
}

describe("getVoiceEnv: defaults", () => {
  it("is off, scripted and safe when nothing is set", () => {
    const env = envWith({});
    assert.equal(env.enabled, false);
    assert.equal(env.mode, "scripted");
    assert.equal(env.requestedMode, "scripted");
    assert.equal(env.degradedReason, null);
    assert.equal(env.brain, "anthropic");
    assert.equal(env.anthropicApiKey, null);
    assert.equal(env.model, DEFAULT_VOICE_MODEL);
    assert.equal(env.model, "claude-haiku-5-5");
    assert.equal(env.maxOutputTokens, DEFAULT_VOICE_MAX_OUTPUT_TOKENS);
    assert.equal(env.maxOutputTokens, 400);
    assert.equal(env.provider, "none");
    assert.equal(env.providerApiKey, null);
    assert.equal(env.costChfPerMinute, null);
    assert.equal(env.alertEmail, null);
    assert.equal(env.lab, false);
    assert.deepEqual(env.limits, {});
    assert.equal(env.production, false);
    assert.deepEqual(availableModes(env), ["scripted"]);
  });

  it("is switched on only by a clear yes", () => {
    for (const on of ["true", "TRUE", " 1 ", "on", "yes"]) {
      assert.equal(envWith({ VOICE_ENABLED: on }).enabled, true, on);
    }
    for (const off of ["false", "0", "off", "no", "", "ture", "enabled"]) {
      assert.equal(envWith({ VOICE_ENABLED: off }).enabled, false, off);
    }
  });

  it("reads the environment once and caches it until reset", () => {
    const first = envWith({ VOICE_ENABLED: "true" });
    mutableEnv.VOICE_ENABLED = "false";
    assert.equal(getVoiceEnv(), first);
    assert.equal(getVoiceEnv().enabled, true);
    resetVoiceEnvForTests();
    assert.equal(getVoiceEnv().enabled, false);
  });
});

describe("getVoiceEnv: junk falls back to defaults", () => {
  it("ignores unknown enum values", () => {
    const env = envWith({ VOICE_MODE: "turbo", VOICE_BRAIN: "gpt", VOICE_PROVIDER: "acme" });
    assert.equal(env.requestedMode, "scripted");
    assert.equal(env.brain, "anthropic");
    assert.equal(env.provider, "none");
  });

  it("accepts enum values in any case and with spaces", () => {
    const env = envWith({ VOICE_MODE: " LOCAL ", VOICE_BRAIN: "Mock" });
    assert.equal(env.mode, "local");
    assert.equal(env.brain, "mock");
  });

  it("ignores a malformed model id", () => {
    assert.equal(envWith({ VOICE_MODEL: "claude haiku" }).model, DEFAULT_VOICE_MODEL);
    assert.equal(envWith({ VOICE_MODEL: "claude-sonnet-5-5" }).model, "claude-sonnet-5-5");
  });

  it("clamps the output tokens to 100-1200 and ignores non-numbers", () => {
    assert.equal(envWith({ VOICE_MAX_OUTPUT_TOKENS: "50" }).maxOutputTokens, 100);
    assert.equal(envWith({ VOICE_MAX_OUTPUT_TOKENS: "5000" }).maxOutputTokens, 1200);
    assert.equal(envWith({ VOICE_MAX_OUTPUT_TOKENS: "600" }).maxOutputTokens, 600);
    for (const junk of ["abc", "1e3", "0x200", "12abc"]) {
      assert.equal(envWith({ VOICE_MAX_OUTPUT_TOKENS: junk }).maxOutputTokens, 400, junk);
    }
  });

  it("takes a cost per minute only when it is plausible", () => {
    assert.equal(envWith({ VOICE_COST_CHF_PER_MINUTE: "0.12" }).costChfPerMinute, 0.12);
    for (const junk of ["0", "-0.1", "abc", "50", "1e-1"]) {
      assert.equal(envWith({ VOICE_COST_CHF_PER_MINUTE: junk }).costChfPerMinute, null, junk);
    }
  });

  it("takes the alert email only when it is an address", () => {
    assert.equal(envWith({ VOICE_ALERT_EMAIL: "ops@example.com" }).alertEmail, "ops@example.com");
    assert.equal(envWith({ VOICE_ALERT_EMAIL: "not an email" }).alertEmail, null);
  });

  it("switches the lab page on like the feature itself", () => {
    assert.equal(envWith({ VOICE_LAB: "true" }).lab, true);
    assert.equal(envWith({ VOICE_LAB: "maybe" }).lab, false);
  });

  it("reads the limit overrides, ignoring negative numbers and junk", () => {
    const env = envWith({
      VOICE_MAX_CALL_SECONDS: "240",
      VOICE_MINUTES_PER_DAY: "60",
      VOICE_MINUTES_PER_MONTH: "-5",
      VOICE_BUDGET_CHF_PER_MONTH: "12.5",
      VOICE_MAX_CONCURRENT: "three",
    });
    assert.deepEqual(env.limits, { maxCallSeconds: 240, minutesPerDay: 60, budgetChfPerMonth: 12.5 });
  });
});

describe("getVoiceEnv: session secret", () => {
  it("uses VOICE_SESSION_SECRET when it has at least 32 characters, without a warning", () => {
    const env = envWith({ VOICE_SESSION_SECRET: SECRET });
    assert.equal(env.sessionSecret, SECRET);
    assert.equal(env.sessionSecretSource, "env");
    assert.equal(warnings("voice_session_secret_generated").length, 0);
  });

  it("outside production generates one secret per process and warns once", () => {
    const env = envWith({});
    assert.equal(env.sessionSecretSource, "generated");
    assert.ok(env.sessionSecret !== null && env.sessionSecret.length >= 32);
    assert.equal(getVoiceEnv().sessionSecret, env.sessionSecret);
    assert.equal(getVoiceEnv().sessionSecret, env.sessionSecret);
    assert.equal(warnings("voice_session_secret_generated").length, 1);
    assert.equal(warnings("voice_session_secret_generated")[0].reason, "missing");
  });

  it("treats a short secret as missing", () => {
    const env = envWith({ VOICE_SESSION_SECRET: "x".repeat(31) });
    assert.equal(env.sessionSecretSource, "generated");
    assert.notEqual(env.sessionSecret, "x".repeat(31));
    assert.equal(warnings("voice_session_secret_generated")[0].reason, "too_short");
  });

  it("a reset generates a new secret, as a restart would", () => {
    const first = envWith({}).sessionSecret;
    const second = envWith({}).sessionSecret;
    assert.notEqual(first, second);
  });

  it("in production has no secret at all when it is missing, and offers scripted only", () => {
    const env = envWith({
      NODE_ENV: "production",
      VOICE_ENABLED: "true",
      VOICE_MODE: "local",
      ANTHROPIC_API_KEY: KEY,
    });
    assert.equal(env.production, true);
    assert.equal(env.sessionSecret, null);
    assert.equal(env.sessionSecretSource, "missing");
    assert.equal(env.mode, "scripted");
    assert.equal(env.degradedReason, "no_secret");
    assert.deepEqual(availableModes(env), ["scripted"]);
    assert.equal(warnings("voice_session_secret_generated").length, 0);
  });

  it("in production works normally with a secret", () => {
    const env = envWith({
      NODE_ENV: "production",
      VOICE_MODE: "local",
      ANTHROPIC_API_KEY: KEY,
      VOICE_SESSION_SECRET: SECRET,
    });
    assert.equal(env.mode, "local");
    assert.deepEqual(availableModes(env), ["local", "scripted"]);
  });

  it("never puts the secret or a key into a log line", () => {
    envWith({ VOICE_ENABLED: "true", VOICE_MODE: "realtime", ANTHROPIC_API_KEY: KEY, VOICE_SESSION_SECRET: SECRET });
    for (const line of logLines) {
      assert.ok(!line.includes(SECRET) && !line.includes(KEY), line);
    }
  });
});

describe("getVoiceEnv: modes degrade to scripted", () => {
  it("realtime needs a provider", () => {
    const env = envWith({ VOICE_MODE: "realtime", VOICE_SESSION_SECRET: SECRET });
    assert.equal(env.requestedMode, "realtime");
    assert.equal(env.mode, "scripted");
    assert.equal(env.degradedReason, "no_provider");
    assert.deepEqual(availableModes(env), ["scripted"]);
  });

  it("realtime with the mock provider needs no key", () => {
    const env = envWith({ VOICE_MODE: "realtime", VOICE_PROVIDER: "mock", VOICE_SESSION_SECRET: SECRET });
    assert.equal(env.mode, "realtime");
    assert.equal(env.degradedReason, null);
    assert.deepEqual(availableModes(env), ["realtime", "scripted"]);
  });

  it("realtime does not fall back to local, even when local would work", () => {
    const env = envWith({ VOICE_MODE: "realtime", ANTHROPIC_API_KEY: KEY, VOICE_SESSION_SECRET: SECRET });
    assert.deepEqual(availableModes(env), ["scripted"]);
  });

  it("local needs the Anthropic key or the mock brain", () => {
    assert.equal(envWith({ VOICE_MODE: "local" }).degradedReason, "no_brain");
    assert.equal(envWith({ VOICE_MODE: "local" }).mode, "scripted");
    assert.equal(envWith({ VOICE_MODE: "local", VOICE_BRAIN: "mock" }).mode, "local");
    assert.equal(envWith({ VOICE_MODE: "local", ANTHROPIC_API_KEY: KEY }).mode, "local");
  });

  it("logs the degradation once, only when the feature is on", () => {
    envWith({ VOICE_MODE: "realtime" });
    assert.equal(warnings("voice_mode_degraded").length, 0);
    logLines = [];
    envWith({ VOICE_ENABLED: "true", VOICE_MODE: "realtime" });
    getVoiceEnv();
    const lines = warnings("voice_mode_degraded");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].requested, "realtime");
    assert.equal(lines[0].mode, "scripted");
    assert.equal(lines[0].reason, "no_provider");
    assert.equal(lines[0].route, "voice");
  });

  it("availableModes always ends with scripted", () => {
    for (const mode of ["scripted", "local", "realtime"] as const) {
      const modes = availableModes({ mode });
      assert.equal(modes[modes.length - 1], "scripted");
      assert.equal(modes[0], mode);
    }
  });
});

describe("voiceCostChfPerMinute", () => {
  it("defaults to 0.25 for realtime, 0.02 for local and nothing for scripted", () => {
    const env = envWith({});
    assert.equal(voiceCostChfPerMinute(env, "realtime"), 0.25);
    assert.equal(voiceCostChfPerMinute(env, "local"), 0.02);
    assert.equal(voiceCostChfPerMinute(env, "scripted"), 0);
  });

  it("uses the override for the live modes only", () => {
    const env = envWith({ VOICE_COST_CHF_PER_MINUTE: "0.1" });
    assert.equal(voiceCostChfPerMinute(env, "realtime"), 0.1);
    assert.equal(voiceCostChfPerMinute(env, "local"), 0.1);
    assert.equal(voiceCostChfPerMinute(env, "scripted"), 0);
  });
});

describe("getVoiceEnv: hash salt", () => {
  it("shares ASSISTANT_HASH_SALT with the chat when it is set", () => {
    assert.equal(envWith({ ASSISTANT_HASH_SALT: "shared-salt", VOICE_SESSION_SECRET: SECRET }).hashSalt, "shared-salt");
  });

  it("is derived from the configured secret otherwise: stable, and not the secret itself", () => {
    const first = envWith({ VOICE_SESSION_SECRET: SECRET }).hashSalt;
    const second = envWith({ VOICE_SESSION_SECRET: SECRET }).hashSalt;
    assert.equal(first, second);
    assert.notEqual(first, SECRET);
    assert.match(first, /^[0-9a-f]{64}$/);
  });
});

describe("resolveVoiceLimits", () => {
  const noEnv = { limits: {} };

  it("returns the defaults without overrides", () => {
    assert.deepEqual(resolveVoiceLimits({}, noEnv), DEFAULT_VOICE_LIMITS);
  });

  it("applies tenant limits, then env limits over them", () => {
    const tenant = { limits: { maxCallSeconds: 300, minutesPerDay: 50, leadsPerSession: 1 } };
    const limits = resolveVoiceLimits(tenant, { limits: { minutesPerDay: 10 } });
    assert.equal(limits.maxCallSeconds, 300);
    assert.equal(limits.minutesPerDay, 10);
    assert.equal(limits.leadsPerSession, 1);
    assert.equal(limits.budgetChfPerMonth, DEFAULT_VOICE_LIMITS.budgetChfPerMonth);
  });

  it("ignores undefined, NaN and negative overrides", () => {
    const tenant = { limits: { maxCallSeconds: Number.NaN, minutesPerDay: -1, minutesPerMonth: undefined } };
    assert.deepEqual(resolveVoiceLimits(tenant, noEnv), DEFAULT_VOICE_LIMITS);
  });

  it("clamps every number into its sane range", () => {
    const huge: Partial<VoiceLimits> = {};
    const tiny: Partial<VoiceLimits> = {};
    for (const key of Object.keys(DEFAULT_VOICE_LIMITS) as Array<keyof VoiceLimits>) {
      huge[key] = 1e12;
      tiny[key] = 0;
    }
    const high = resolveVoiceLimits({ limits: huge }, noEnv);
    const low = resolveVoiceLimits({ limits: tiny }, noEnv);
    for (const key of Object.keys(VOICE_LIMIT_RANGES) as Array<keyof VoiceLimits>) {
      const range = VOICE_LIMIT_RANGES[key];
      assert.ok(high[key] <= range.max, `${key} high`);
      assert.ok(low[key] >= range.min, `${key} low`);
    }
    assert.equal(low.maxCallSeconds, 30);
    assert.equal(low.maxTurnsPerSession, 1);
    assert.equal(low.minutesPerDay, 0);
    assert.equal(high.maxCallSeconds, 1800);
  });

  it("keeps the end warning before the cut", () => {
    const limits = resolveVoiceLimits({ limits: { maxCallSeconds: 40, warnBeforeEndSeconds: 100 } }, noEnv);
    assert.equal(limits.maxCallSeconds, 40);
    assert.equal(limits.warnBeforeEndSeconds, 30);
  });

  it("rounds whole-number limits but keeps the budget in francs and centimes", () => {
    const limits = resolveVoiceLimits({ limits: { maxConcurrentSessions: 2.6, budgetChfPerMonth: 12.5 } }, noEnv);
    assert.equal(limits.maxConcurrentSessions, 3);
    assert.equal(limits.budgetChfPerMonth, 12.5);
  });
});

describe("log guard", () => {
  it("flags the names that suggest content, personal data or secrets", () => {
    const sensitive = [
      "text",
      "transcript",
      "name",
      "phone",
      "email",
      "contact",
      "message",
      "input",
      "ip",
      "IP",
      "callerName",
      "full_name",
      "phoneNumber",
      "customerEmail",
      "contactInfo",
      "lastMessage",
      "userText",
      "transcriptChars",
      "ipHash",
      "clientIp",
      "client-ip",
      "sessionToken",
      "apiKey",
      "sessionSecret",
      "address",
      "body",
    ];
    for (const field of sensitive) assert.equal(isSensitiveLogField(field), true, field);
  });

  it("lets the usual ids, codes, counts and timings through", () => {
    const safe = [
      "tenant",
      "mode",
      "code",
      "outcome",
      "reason",
      "provider",
      "ms",
      "turns",
      "inTok",
      "description",
      "skip",
      "errorName",
      "toolName",
      "locale",
      "durationSeconds",
      "warn",
    ];
    for (const field of safe) assert.equal(isSensitiveLogField(field), false, field);
  });

  it("drops sensitive fields and non-primitive values, counts them, and cuts long strings", () => {
    const clean = sanitizeVoiceLogFields({
      tenant: "demo-umzug",
      callerName: "Anna Muster",
      phone: "+41 79 000 00 00",
      details: { anything: "goes" },
      list: [1, 2],
      reason: "x".repeat(500),
      ok: true,
      count: 3,
      nothing: null,
      skipped: undefined,
    });
    assert.equal(clean.tenant, "demo-umzug");
    assert.equal(clean.ok, true);
    assert.equal(clean.count, 3);
    assert.equal(clean.nothing, null);
    assert.equal("callerName" in clean, false);
    assert.equal("phone" in clean, false);
    assert.equal("details" in clean, false);
    assert.equal("list" in clean, false);
    assert.equal("skipped" in clean, false);
    assert.equal(clean.dropped, 4);
    assert.ok(typeof clean.reason === "string" && clean.reason.length <= 201);
  });

  it("does not let a caller overwrite the route or the event name", () => {
    const clean = sanitizeVoiceLogFields({ route: "chat", evt: "fake", ts: "never", dropped: 99 });
    assert.deepEqual(clean, {});
  });

  it("writes one JSON line on the chat assistant's channel, with route voice and nothing personal", () => {
    logVoiceEvent({ tenant: "demo-umzug", outcome: "ok", text: "Ich heisse Anna", email: "anna@example.com", ip: "203.0.113.7" });
    assert.equal(logLines.length, 1);
    const event = JSON.parse(logLines[0]) as Record<string, unknown>;
    assert.equal(event.evt, "assistant");
    assert.equal(event.route, "voice");
    assert.equal(event.tenant, "demo-umzug");
    assert.equal(event.dropped, 3);
    assert.ok(!logLines[0].includes("Anna") && !logLines[0].includes("example.com") && !logLines[0].includes("203.0.113.7"));
  });

  it("never throws, whatever it is given", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.doesNotThrow(() => logVoiceEvent({ circular, big: BigInt(1), fn: () => 1, sym: Symbol("x") }));
  });
});
