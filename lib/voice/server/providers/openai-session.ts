// The session configuration of an OpenAI realtime call, built from our settings. Pure, no I/O:
// shared by the OpenAI provider, the call route and the recording test tool, so all three send
// the same session.
//
// OpenAI refuses unknown fields (400 unknown_parameter), so nothing outside the fields below is
// ever sent. Optional settings that are null are left out, and OpenAI's own default applies.
// Never sent on purpose:
//   - `tracing`: its default is off, and the call controller's read-back checks that it stays off;
//   - `idle_timeout_ms`: refused with semantic_vad, and with server_vad it makes OpenAI inject a
//     message of its own and start a response nobody asked for.
import type { VoiceLocale, VoiceToolDefinition } from "@/lib/voice/types";
import type { OpenAiSettings } from "../env";

export interface OpenAiSessionInput {
  settings: OpenAiSettings;
  instructions: string;
  tools: VoiceToolDefinition[];
  /** The session's language: the greeting's, and the transcription's with the older model. */
  locale: VoiceLocale;
  /** The tenant's languages (the session's first); the transcription may follow any of them. */
  locales: VoiceLocale[];
  /** "webrtc": the browser carries the audio; "websocket": the recording tool appends PCM itself. */
  transport: "webrtc" | "websocket";
}

/** The language a greeting is spoken in, as the model is told. */
export const GREETING_LANGUAGE: Record<VoiceLocale, string> = {
  de: "Swiss Standard German",
  it: "Italian",
  en: "English",
  fr: "French",
};

/** Raw 16-bit PCM at 24 kHz, the format the recording tool sends and receives. */
const PCM_FORMAT = { type: "audio/pcm", rate: 24000 } as const;

/** The `session` of POST /v1/realtime/calls (and of session.update on a direct WebSocket). */
export function buildOpenAiSession(input: OpenAiSessionInput): Record<string, unknown> {
  const { settings, transport } = input;
  const websocket = transport === "websocket";

  const audioInput: Record<string, unknown> = {};
  if (websocket) audioInput.format = { ...PCM_FORMAT };
  const transcription = transcriptionOf(settings, input.locale, input.locales);
  if (transcription) audioInput.transcription = transcription;
  if (settings.noise !== null) audioInput.noise_reduction = { type: settings.noise };
  // The recording tool commits its turns itself.
  audioInput.turn_detection = websocket ? null : turnDetectionOf(settings.turn);

  const audioOutput: Record<string, unknown> = {};
  if (websocket) audioOutput.format = { ...PCM_FORMAT };
  audioOutput.voice = settings.voice;
  if (settings.speed !== null) audioOutput.speed = settings.speed;

  const session: Record<string, unknown> = {
    type: "realtime",
    model: settings.model,
    instructions: input.instructions,
    // Audio only: asking for text and audio together made the call creation time out.
    output_modalities: ["audio"],
    audio: { input: audioInput, output: audioOutput },
    tools: toOpenAiTools(input.tools),
    tool_choice: "auto",
    // Counts audio tokens (about 20 per second of speech) and reasoning.
    max_output_tokens: settings.maxOutputTokens,
    truncation: "auto",
  };
  if (settings.reasoning !== null) session.reasoning = { effort: settings.reasoning };
  return session;
}

/** Our tool definitions as OpenAI function tools; the schema is passed on unchanged. */
export function toOpenAiTools(
  tools: VoiceToolDefinition[],
): Array<{ type: "function"; name: string; description: string; parameters: VoiceToolDefinition["inputSchema"] }> {
  return tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema }));
}

/**
 * The response.instructions of the greeting: the model speaks `greeting` word for word. Used for
 * the greeting only; later in a call the same pattern is not reliable.
 */
export function greetingInstructions(greeting: string, locale: VoiceLocale): string {
  return `Speak exactly this greeting, word for word, in ${GREETING_LANGUAGE[locale]}, and nothing else. Do not add or change any word: "${greeting}"`;
}

/**
 * gpt-transcribe takes every language of the tenant (callers may switch), the session's first;
 * the older model takes one language only, the session's.
 */
function transcriptionOf(settings: OpenAiSettings, locale: VoiceLocale, locales: VoiceLocale[]): Record<string, unknown> | null {
  if (settings.transcribe === null) return null;
  if (settings.transcribe === "gpt-transcribe") {
    const languages: VoiceLocale[] = [locale];
    for (const entry of locales) if (!languages.includes(entry)) languages.push(entry);
    return { model: settings.transcribe, languages };
  }
  return { model: settings.transcribe, language: locale };
}

/** The turn detection of a browser call (the recording tool's --vad uses it too). */
export function turnDetectionOf(turn: OpenAiSettings["turn"]): Record<string, unknown> {
  if (turn.type === "semantic_vad") {
    const detection: Record<string, unknown> = { type: "semantic_vad" };
    if (turn.eagerness !== null) detection.eagerness = turn.eagerness;
    detection.create_response = true;
    detection.interrupt_response = true;
    return detection;
  }
  const detection: Record<string, unknown> = { type: "server_vad", silence_duration_ms: turn.silenceMs };
  if (turn.threshold !== null) detection.threshold = turn.threshold;
  if (turn.prefixMs !== null) detection.prefix_padding_ms = turn.prefixMs;
  detection.create_response = true;
  detection.interrupt_response = true;
  return detection;
}
