// The OpenAI session configuration (lib/voice/server/providers/openai-session.ts): the exact JSON of
// the default call, every optional field left out unless set, the WebSocket variant of the
// recording tool, the function tools and the greeting instructions. Pure: nothing talks to OpenAI.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { getVoiceEnv, type OpenAiSettings } from "@/lib/voice/server/env";
import {
  buildOpenAiSession,
  GREETING_LANGUAGE,
  greetingInstructions,
  type OpenAiSessionInput,
  toOpenAiTools,
} from "@/lib/voice/server/providers/openai-session";
import { VOICE_LOCALES, type VoiceToolDefinition } from "@/lib/voice/types";
import { captureLogs, setVoiceEnv } from "./voice-fixtures";

const INSTRUCTIONS = "You are the AI assistant of a fictional moving company.";

const CALLBACK_TOOL: VoiceToolDefinition = {
  name: "request_callback",
  description: "Asks the business to call the caller back.",
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
};

const SLOTS_TOOL: VoiceToolDefinition = {
  name: "check_availability",
  description: "Free slots on a day.",
  inputSchema: {
    type: "object",
    properties: { date: { type: "string", description: "YYYY-MM-DD" }, nested: { type: "array", items: { type: "string" } } },
    required: ["date"],
    additionalProperties: false,
  },
};

let restoreEnv: (() => void) | null = null;
// The configuration's own log lines (a generated session secret) are collected, not printed.
beforeEach(() => {
  captureLogs();
});
afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  mock.restoreAll();
});

/** The settings a deployment without any VOICE_OPENAI_* variable runs with. */
function defaultSettings(): OpenAiSettings {
  restoreEnv?.();
  restoreEnv = setVoiceEnv({});
  return getVoiceEnv().openai;
}

function input(overrides: Partial<OpenAiSessionInput> = {}, settings: Partial<OpenAiSettings> = {}): OpenAiSessionInput {
  return {
    settings: { ...defaultSettings(), ...settings },
    instructions: INSTRUCTIONS,
    tools: [CALLBACK_TOOL],
    locale: "de",
    locales: ["de", "en"],
    transport: "webrtc",
    ...overrides,
  };
}

function audioInputOf(session: Record<string, unknown>): Record<string, unknown> {
  return (session.audio as { input: Record<string, unknown> }).input;
}

function audioOutputOf(session: Record<string, unknown>): Record<string, unknown> {
  return (session.audio as { output: Record<string, unknown> }).output;
}

describe("buildOpenAiSession", () => {
  it("builds the default WebRTC session exactly", () => {
    const session = buildOpenAiSession(input());
    const expected = {
      type: "realtime",
      model: "gpt-realtime-2.1",
      instructions: INSTRUCTIONS,
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: "gpt-transcribe", languages: ["de", "en"] },
          noise_reduction: { type: "near_field" },
          turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true },
        },
        output: { voice: "marin" },
      },
      tools: [
        {
          type: "function",
          name: "request_callback",
          description: "Asks the business to call the caller back.",
          parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
        },
      ],
      tool_choice: "auto",
      max_output_tokens: 1024,
      truncation: "auto",
    };
    assert.deepEqual(session, expected);
    // The key order too: the serialised session is pinned byte for byte.
    assert.equal(JSON.stringify(session), JSON.stringify(expected));
  });

  it("sends only audio as output modality", () => {
    for (const transport of ["webrtc", "websocket"] as const) {
      assert.deepEqual(buildOpenAiSession(input({ transport })).output_modalities, ["audio"]);
    }
  });

  it("leaves tracing, reasoning, speed, threshold and prefix out unless set", () => {
    const serverVad: OpenAiSettings["turn"] = { type: "server_vad", silenceMs: 1200, threshold: null, prefixMs: null };
    const plain = buildOpenAiSession(input({}, { turn: serverVad }));
    assert.equal("tracing" in plain, false);
    assert.equal("reasoning" in plain, false);
    assert.equal("speed" in audioOutputOf(plain), false);
    assert.deepEqual(audioInputOf(plain).turn_detection, {
      type: "server_vad",
      silence_duration_ms: 1200,
      create_response: true,
      interrupt_response: true,
    });

    const tuned = buildOpenAiSession(
      input({}, { turn: { type: "server_vad", silenceMs: 800, threshold: 0.6, prefixMs: 300 }, reasoning: "low", speed: 1.1 }),
    );
    assert.equal("tracing" in tuned, false);
    assert.deepEqual(tuned.reasoning, { effort: "low" });
    assert.deepEqual(audioOutputOf(tuned), { voice: "marin", speed: 1.1 });
    assert.deepEqual(audioInputOf(tuned).turn_detection, {
      type: "server_vad",
      silence_duration_ms: 800,
      threshold: 0.6,
      prefix_padding_ms: 300,
      create_response: true,
      interrupt_response: true,
    });
  });

  it("never sends idle_timeout_ms, and uses eagerness only with semantic_vad", () => {
    const turns: OpenAiSettings["turn"][] = [
      { type: "server_vad", silenceMs: 1200, threshold: 0.5, prefixMs: 200 },
      { type: "semantic_vad", eagerness: "high" },
      { type: "semantic_vad", eagerness: null },
    ];
    for (const turn of turns) {
      const session = buildOpenAiSession(input({}, { turn }));
      assert.ok(!JSON.stringify(session).includes("idle_timeout_ms"), turn.type);
      const detection = audioInputOf(session).turn_detection as Record<string, unknown>;
      if (turn.type === "server_vad") {
        assert.equal("eagerness" in detection, false);
      } else {
        assert.equal("silence_duration_ms" in detection, false);
        assert.equal("threshold" in detection, false);
        assert.equal("prefix_padding_ms" in detection, false);
      }
    }
    const withoutEagerness = buildOpenAiSession(input({}, { turn: { type: "semantic_vad", eagerness: null } }));
    assert.deepEqual(audioInputOf(withoutEagerness).turn_detection, {
      type: "semantic_vad",
      create_response: true,
      interrupt_response: true,
    });
    const eager = buildOpenAiSession(input({}, { turn: { type: "semantic_vad", eagerness: "high" } }));
    assert.equal((audioInputOf(eager).turn_detection as Record<string, unknown>).eagerness, "high");
  });

  it("omits transcription or noise reduction when switched off", () => {
    const session = buildOpenAiSession(input({}, { transcribe: null, noise: null }));
    const audioInput = audioInputOf(session);
    assert.equal("transcription" in audioInput, false);
    assert.equal("noise_reduction" in audioInput, false);
    assert.deepEqual(Object.keys(audioInput), ["turn_detection"]);
    const far = buildOpenAiSession(input({}, { noise: "far_field" }));
    assert.deepEqual(audioInputOf(far).noise_reduction, { type: "far_field" });
  });

  it("gives gpt-transcribe every language of the tenant, the session's first, and the older model only the session's", () => {
    const newer = buildOpenAiSession(input({ locale: "it", locales: ["de", "it", "en", "it"] }));
    assert.deepEqual(audioInputOf(newer).transcription, { model: "gpt-transcribe", languages: ["it", "de", "en"] });

    const single = buildOpenAiSession(input({ locale: "fr", locales: [] }));
    assert.deepEqual(audioInputOf(single).transcription, { model: "gpt-transcribe", languages: ["fr"] });

    const older = buildOpenAiSession(input({ locale: "it", locales: ["de", "it"] }, { transcribe: "gpt-4o-mini-transcribe" }));
    assert.deepEqual(audioInputOf(older).transcription, { model: "gpt-4o-mini-transcribe", language: "it" });
  });

  it("adds the PCM formats and manual turns for the WebSocket variant", () => {
    const session = buildOpenAiSession(input({ transport: "websocket" }));
    const format = { type: "audio/pcm", rate: 24000 };
    assert.deepEqual(audioInputOf(session), {
      format,
      transcription: { model: "gpt-transcribe", languages: ["de", "en"] },
      noise_reduction: { type: "near_field" },
      turn_detection: null,
    });
    assert.deepEqual(audioOutputOf(session), { format, voice: "marin" });
    // Everything else is the WebRTC session's.
    const webrtc = buildOpenAiSession(input());
    assert.deepEqual({ ...session, audio: null }, { ...webrtc, audio: null });
    assert.equal("format" in audioInputOf(webrtc), false);
    assert.equal("format" in audioOutputOf(webrtc), false);
  });

  it("follows the model, the voice and the output token limit of the settings", () => {
    const session = buildOpenAiSession(input({}, { model: "gpt-realtime-2.1-mini", voice: "cedar", maxOutputTokens: 2048 }));
    assert.equal(session.model, "gpt-realtime-2.1-mini");
    assert.deepEqual(audioOutputOf(session), { voice: "cedar" });
    assert.equal(session.max_output_tokens, 2048);
  });
});

describe("toOpenAiTools", () => {
  it("turns tool definitions into function tools without changing their schema", () => {
    const before = JSON.stringify([CALLBACK_TOOL, SLOTS_TOOL]);
    const tools = toOpenAiTools([CALLBACK_TOOL, SLOTS_TOOL]);
    assert.deepEqual(tools, [
      { type: "function", name: "request_callback", description: CALLBACK_TOOL.description, parameters: CALLBACK_TOOL.inputSchema },
      { type: "function", name: "check_availability", description: SLOTS_TOOL.description, parameters: SLOTS_TOOL.inputSchema },
    ]);
    assert.equal(JSON.stringify([CALLBACK_TOOL, SLOTS_TOOL]), before);
    for (const tool of tools) assert.match(tool.name, /^[a-zA-Z0-9_-]+$/);
    assert.deepEqual(toOpenAiTools([]), []);
    assert.deepEqual(buildOpenAiSession(input({ tools: [] })).tools, []);
  });
});

describe("greetingInstructions", () => {
  it("quotes the greeting word for word in the locale's language", () => {
    const greeting = "Grüezi, hier ist der digitale Assistent. Ich bin eine KI.";
    assert.equal(
      greetingInstructions(greeting, "de"),
      `Speak exactly this greeting, word for word, in Swiss Standard German, and nothing else. Do not add or change any word: "${greeting}"`,
    );
    assert.equal(
      greetingInstructions("Ciao, sono l'assistente digitale.", "it"),
      `Speak exactly this greeting, word for word, in Italian, and nothing else. Do not add or change any word: "Ciao, sono l'assistente digitale."`,
    );
    assert.deepEqual(GREETING_LANGUAGE, { de: "Swiss Standard German", it: "Italian", en: "English", fr: "French" });
    for (const locale of VOICE_LOCALES) assert.ok(greetingInstructions("x", locale).includes(` in ${GREETING_LANGUAGE[locale]}, `));
  });
});
