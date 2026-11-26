// The OpenAI settings of the voice configuration (lib/voice/server/env.ts): the provider key and
// its fallback, the VOICE_OPENAI_* defaults, junk and clamping, the cost cap per model, and the
// log line of an ignored setting. Placeholder keys only; nothing here talks to OpenAI.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  DEFAULT_OPENAI_MAX_CALL_USD,
  getVoiceEnv,
  OPENAI_REALTIME_MODELS,
  type OpenAiSettings,
  type VoiceEnv,
} from "@/lib/voice/server/env";
import { captureLogs, setVoiceEnv, TEST_OPENAI_KEY, TEST_SECRET, type VoiceTestEnvKey } from "./voice-fixtures";

const OTHER_KEY = "test-provider-key-not-real";

let restoreEnv: (() => void) | null = null;

// Every test starts with the log lines collected rather than printed; a test that reads them takes
// its own capture.
beforeEach(() => {
  captureLogs();
});

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  mock.restoreAll();
});

/** getVoiceEnv() with exactly these variables set (and a fresh cache). */
function envWith(vars: Partial<Record<VoiceTestEnvKey, string>>): VoiceEnv {
  restoreEnv?.();
  restoreEnv = setVoiceEnv(vars);
  return getVoiceEnv();
}

function ignored(lines: readonly string[]): unknown[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.warn === "voice_setting_ignored")
    .map((event) => event.kind);
}

const DEFAULTS: OpenAiSettings = {
  model: "gpt-realtime-2.1",
  host: "api.openai.com",
  voice: "marin",
  turn: { type: "semantic_vad", eagerness: "low" },
  reasoning: null,
  transcribe: "gpt-transcribe",
  noise: "near_field",
  speed: null,
  maxOutputTokens: 1024,
  maxResponses: 80,
  maxCallUsd: 2,
};

const realtime = { VOICE_ENABLED: "true", VOICE_MODE: "realtime", VOICE_PROVIDER: "openai", VOICE_SESSION_SECRET: TEST_SECRET } as const;

describe("getVoiceEnv: the openai provider", () => {
  it("realtime with openai needs a key", () => {
    const lines = captureLogs();
    const keyless = envWith(realtime);
    assert.equal(keyless.provider, "openai");
    assert.equal(keyless.providerApiKey, null);
    assert.equal(keyless.mode, "scripted");
    assert.equal(keyless.degradedReason, "no_provider_key");
    const degraded = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((event) => event.warn === "voice_mode_degraded");
    assert.equal(degraded.length, 1);
    assert.equal(degraded[0].reason, "no_provider_key");

    const keyed = envWith({ ...realtime, VOICE_PROVIDER_API_KEY: OTHER_KEY });
    assert.equal(keyed.mode, "realtime");
    assert.equal(keyed.degradedReason, null);
    assert.equal(keyed.providerApiKey, OTHER_KEY);
    // A blank key is no key.
    assert.equal(envWith({ ...realtime, VOICE_PROVIDER_API_KEY: "   " }).degradedReason, "no_provider_key");
    // The provider name is read like every other choice.
    assert.equal(envWith({ ...realtime, VOICE_PROVIDER: " OpenAI ", OPENAI_API_KEY: TEST_OPENAI_KEY }).mode, "realtime");
  });

  it("OPENAI_API_KEY is a fallback for openai only", () => {
    const fallback = envWith({ ...realtime, OPENAI_API_KEY: TEST_OPENAI_KEY });
    assert.equal(fallback.providerApiKey, TEST_OPENAI_KEY);
    assert.equal(fallback.mode, "realtime");
    // VOICE_PROVIDER_API_KEY comes first when both are set.
    assert.equal(envWith({ ...realtime, OPENAI_API_KEY: TEST_OPENAI_KEY, VOICE_PROVIDER_API_KEY: OTHER_KEY }).providerApiKey, OTHER_KEY);
    // Another provider never picks it up.
    for (const provider of ["mock", "none"]) {
      const env = envWith({ ...realtime, VOICE_PROVIDER: provider, OPENAI_API_KEY: TEST_OPENAI_KEY });
      assert.equal(env.providerApiKey, null, provider);
    }
    // And an unknown provider name is "none", without the key either.
    const typo = envWith({ ...realtime, VOICE_PROVIDER: "open-ai", OPENAI_API_KEY: TEST_OPENAI_KEY });
    assert.equal(typo.provider, "none");
    assert.equal(typo.providerApiKey, null);
    assert.equal(typo.degradedReason, "no_provider");
  });
});

describe("getVoiceEnv: openai settings", () => {
  it("has the documented defaults when nothing is set", () => {
    assert.deepEqual(envWith({}).openai, DEFAULTS);
    assert.equal(OPENAI_REALTIME_MODELS[0], DEFAULTS.model);
  });

  it("reads every allowed value, in any case and with spaces", () => {
    const env = envWith({
      VOICE_OPENAI_MODEL: " GPT-Realtime-2.1-Mini ",
      VOICE_OPENAI_HOST: "eu.api.openai.com",
      VOICE_OPENAI_VOICE: "Cedar",
      VOICE_OPENAI_TURN: "server_vad",
      VOICE_OPENAI_VAD_SILENCE_MS: "800",
      VOICE_OPENAI_VAD_THRESHOLD: "0.6",
      VOICE_OPENAI_VAD_PREFIX_MS: "300",
      VOICE_OPENAI_REASONING: "low",
      VOICE_OPENAI_TRANSCRIBE: "gpt-4o-mini-transcribe",
      VOICE_OPENAI_NOISE: "far_field",
      VOICE_OPENAI_SPEED: "1.1",
      VOICE_OPENAI_MAX_OUTPUT_TOKENS: "2048",
      VOICE_OPENAI_MAX_RESPONSES: "40",
      VOICE_OPENAI_MAX_CALL_USD: "0.5",
    });
    assert.deepEqual(env.openai, {
      model: "gpt-realtime-2.1-mini",
      host: "eu.api.openai.com",
      voice: "cedar",
      turn: { type: "server_vad", silenceMs: 800, threshold: 0.6, prefixMs: 300 },
      reasoning: "low",
      transcribe: "gpt-4o-mini-transcribe",
      noise: "far_field",
      speed: 1.1,
      maxOutputTokens: 2048,
      maxResponses: 40,
      maxCallUsd: 0.5,
    });
  });

  it("keeps the server_vad defaults, sends nothing unset, and reads the eagerness of semantic_vad", () => {
    assert.deepEqual(envWith({ VOICE_OPENAI_TURN: "server_vad" }).openai.turn, {
      type: "server_vad",
      silenceMs: 1200,
      threshold: null,
      prefixMs: null,
    });
    assert.deepEqual(envWith({ VOICE_OPENAI_EAGERNESS: "high" }).openai.turn, { type: "semantic_vad", eagerness: "high" });
    // The settings of the other turn type change nothing.
    assert.deepEqual(envWith({ VOICE_OPENAI_TURN: "semantic_vad", VOICE_OPENAI_VAD_SILENCE_MS: "500" }).openai.turn, DEFAULTS.turn);
  });

  it("switches transcription and noise reduction off with off", () => {
    const env = envWith({ VOICE_OPENAI_TRANSCRIBE: "off", VOICE_OPENAI_NOISE: "OFF" });
    assert.equal(env.openai.transcribe, null);
    assert.equal(env.openai.noise, null);
  });

  it("every openai setting falls back to its default and is logged once by name", () => {
    const junk: Partial<Record<VoiceTestEnvKey, string>> = {
      VOICE_OPENAI_MODEL: "gpt-4o-realtime",
      VOICE_OPENAI_HOST: "api.example.com",
      VOICE_OPENAI_VOICE: "robot",
      VOICE_OPENAI_TURN: "manual",
      VOICE_OPENAI_VAD_SILENCE_MS: "1e3",
      VOICE_OPENAI_VAD_THRESHOLD: "half",
      VOICE_OPENAI_VAD_PREFIX_MS: "0x10",
      VOICE_OPENAI_EAGERNESS: "eager",
      VOICE_OPENAI_REASONING: "max",
      VOICE_OPENAI_TRANSCRIBE: "whisper",
      VOICE_OPENAI_NOISE: "none",
      VOICE_OPENAI_SPEED: "fast",
      VOICE_OPENAI_MAX_OUTPUT_TOKENS: "12abc",
      VOICE_OPENAI_MAX_RESPONSES: "many",
      VOICE_OPENAI_MAX_CALL_USD: "$1",
    };
    const lines = captureLogs();
    const env = envWith({ ...junk, VOICE_ENABLED: "true" });
    assert.deepEqual(env.openai, DEFAULTS);
    getVoiceEnv();
    getVoiceEnv();
    assert.deepEqual([...ignored(lines)].sort(), Object.keys(junk).sort());
    for (const line of lines.filter((entry) => entry.includes("voice_setting_ignored"))) {
      // The name of the variable, never what was written in it.
      for (const value of Object.values(junk)) assert.ok(!line.includes(`"${value}"`), line);
    }

    // Unset and blank values are not typos; and with the feature off nothing is logged at all.
    const quiet = captureLogs();
    envWith({ VOICE_ENABLED: "true", VOICE_OPENAI_MODEL: "  ", VOICE_OPENAI_SPEED: "" });
    envWith(junk);
    assert.deepEqual(ignored(quiet), []);
  });

  it("numbers are clamped", () => {
    const low = envWith({
      VOICE_OPENAI_TURN: "server_vad",
      VOICE_OPENAI_VAD_SILENCE_MS: "50",
      VOICE_OPENAI_VAD_THRESHOLD: "0",
      VOICE_OPENAI_VAD_PREFIX_MS: "-20",
      VOICE_OPENAI_SPEED: "0.1",
      VOICE_OPENAI_MAX_OUTPUT_TOKENS: "10",
      VOICE_OPENAI_MAX_RESPONSES: "1",
      VOICE_OPENAI_MAX_CALL_USD: "0",
    }).openai;
    assert.deepEqual(low.turn, { type: "server_vad", silenceMs: 200, threshold: 0.1, prefixMs: 0 });
    assert.equal(low.speed, 0.25);
    assert.equal(low.maxOutputTokens, 256);
    assert.equal(low.maxResponses, 10);
    assert.equal(low.maxCallUsd, 0.05);

    const high = envWith({
      VOICE_OPENAI_TURN: "server_vad",
      VOICE_OPENAI_VAD_SILENCE_MS: "9000",
      VOICE_OPENAI_VAD_THRESHOLD: "1",
      VOICE_OPENAI_VAD_PREFIX_MS: "5000",
      VOICE_OPENAI_SPEED: "3",
      VOICE_OPENAI_MAX_OUTPUT_TOKENS: "100000",
      VOICE_OPENAI_MAX_RESPONSES: "1000",
      VOICE_OPENAI_MAX_CALL_USD: "500",
    }).openai;
    assert.deepEqual(high.turn, { type: "server_vad", silenceMs: 2000, threshold: 0.9, prefixMs: 1000 });
    assert.equal(high.speed, 1.5);
    assert.equal(high.maxOutputTokens, 4096);
    assert.equal(high.maxResponses, 400);
    assert.equal(high.maxCallUsd, 20);

    // Whole numbers are rounded; decimals are kept.
    const rounded = envWith({ VOICE_OPENAI_MAX_RESPONSES: "40.6", VOICE_OPENAI_SPEED: "1.05" }).openai;
    assert.equal(rounded.maxResponses, 41);
    assert.equal(rounded.speed, 1.05);

    // A clamped number is not a typo: no log line.
    const lines = captureLogs();
    envWith({ VOICE_ENABLED: "true", VOICE_OPENAI_MAX_RESPONSES: "1000" });
    assert.deepEqual(ignored(lines), []);
  });

  it("the cost cap default follows the model", () => {
    assert.equal(envWith({}).openai.maxCallUsd, 2);
    assert.equal(envWith({ VOICE_OPENAI_MODEL: "gpt-realtime-2.1" }).openai.maxCallUsd, 2);
    assert.equal(envWith({ VOICE_OPENAI_MODEL: "gpt-realtime-2.1-mini" }).openai.maxCallUsd, 1);
    assert.deepEqual(DEFAULT_OPENAI_MAX_CALL_USD, { "gpt-realtime-2.1": 2, "gpt-realtime-2.1-mini": 1 });
    // A model typo falls back to the default model, and so does its cap.
    assert.equal(envWith({ VOICE_OPENAI_MODEL: "gpt-realtime" }).openai.maxCallUsd, 2);
    // An explicit cap wins over the model's, and junk keeps the model's.
    assert.equal(envWith({ VOICE_OPENAI_MODEL: "gpt-realtime-2.1-mini", VOICE_OPENAI_MAX_CALL_USD: "3" }).openai.maxCallUsd, 3);
    assert.equal(envWith({ VOICE_OPENAI_MODEL: "gpt-realtime-2.1-mini", VOICE_OPENAI_MAX_CALL_USD: "lots" }).openai.maxCallUsd, 1);
  });

  it("keys never reach a log line", () => {
    const lines = captureLogs();
    // Degraded (no key for the provider chosen), with junk settings, and running with both keys.
    envWith({ ...realtime, VOICE_PROVIDER: "mock", OPENAI_API_KEY: TEST_OPENAI_KEY, VOICE_OPENAI_MODEL: TEST_OPENAI_KEY });
    envWith({ ...realtime, VOICE_SESSION_SECRET: "", OPENAI_API_KEY: TEST_OPENAI_KEY, VOICE_OPENAI_VOICE: OTHER_KEY });
    envWith({ ...realtime, OPENAI_API_KEY: TEST_OPENAI_KEY, VOICE_PROVIDER_API_KEY: OTHER_KEY, VOICE_OPENAI_HOST: TEST_OPENAI_KEY });
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(!line.includes(TEST_OPENAI_KEY) && !line.includes(OTHER_KEY) && !line.includes(TEST_SECRET), line);
    }
  });
});
