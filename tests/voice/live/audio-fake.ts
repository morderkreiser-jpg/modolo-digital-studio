// The fake realtime session of the audio tool's dry run ("--prova-a-secco"): a ControlSocket that
// answers like OpenAI's direct WebSocket, deterministically, without network, key or cost.
//
//   - `session.created` as soon as someone listens, `session.updated` for every session.update;
//   - each commit (or, with turn detection on, the first silence after speech): the item is
//     committed and transcribed with a fixed text;
//   - each response.create: one response with a fixed transcript and FAKE_RESPONSE_USAGE; when the
//     current turn expects a tool call and it was not made yet, the response holds that call
//     instead, with the expected arguments (and a placeholder for every other required field);
//   - every event is delivered asynchronously, in order, as a socket would.
import type { ControlEvent, ControlSocket } from "@/lib/voice/server/providers/types";
import type { VoiceToolDefinition } from "@/lib/voice/types";
import type { AudioExpectation } from "./audio-scenarios";

/** The usage of every fake response (OpenAI's shape): plausible orders of magnitude. */
export const FAKE_RESPONSE_USAGE = {
  total_tokens: 1710,
  input_tokens: 1560,
  output_tokens: 150,
  input_token_details: { text_tokens: 1500, audio_tokens: 60, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } },
  output_token_details: { text_tokens: 30, audio_tokens: 120, reasoning_tokens: 0 },
} as const;
/** Seconds the fake transcription bills for every turn. */
export const FAKE_TRANSCRIBE_SECONDS = 2;
/** A placeholder for a required field the scenario does not name. */
export const FAKE_PLACEHOLDER = "prova a secco";

export function fakeCallerTranscript(turn: number): string {
  return `(prova a secco: trascrizione finta della frase ${turn})`;
}

export function fakeAssistantTranscript(response: number): string {
  return `(prova a secco: risposta finta ${response})`;
}

export interface FakeRealtimeOptions {
  /** The expectation of each turn, in the order the turns are played. */
  expectations: ReadonlyArray<AudioExpectation | undefined>;
  /** The session's tools: their required fields get placeholders. */
  tools: readonly VoiceToolDefinition[];
  /** Tests only: the usage of every response (default FAKE_RESPONSE_USAGE). */
  responseUsage?: Readonly<Record<string, unknown>>;
  /** Tests only: the usage of every transcription (default FAKE_TRANSCRIBE_SECONDS, of type "duration"). */
  transcriptionUsage?: Readonly<Record<string, unknown>>;
}

export interface FakeRealtimeSocket extends ControlSocket {
  /** Every event the tool sent, in order. */
  readonly sent: ControlEvent[];
  /** The close code once closed, else null. */
  readonly closedWith: number | null;
  /** How many responses the fake session started. */
  readonly responses: number;
}

export function createFakeRealtimeSocket(options: FakeRealtimeOptions): FakeRealtimeSocket {
  const sent: ControlEvent[] = [];
  const eventListeners: Array<(event: ControlEvent) => void> = [];
  const closeListeners: Array<(info: { code: number }) => void> = [];
  const queue: ControlEvent[] = [];
  let scheduled = false;
  let closedWith: number | null = null;
  let serverEvents = 0;
  let vad = false;
  let speech = false;
  let bufferedBytes = 0;
  let turn = 0;
  let responses = 0;
  const calledFor = new Set<number>();
  const responseUsage = options.responseUsage ?? FAKE_RESPONSE_USAGE;
  const transcriptionUsage = options.transcriptionUsage ?? { type: "duration", seconds: FAKE_TRANSCRIBE_SECONDS };

  function emit(event: ControlEvent): void {
    serverEvents += 1;
    queue.push({ event_id: `event_fake_${serverEvents}`, ...event });
    if (scheduled) return;
    scheduled = true;
    setImmediate(flush);
  }

  function flush(): void {
    scheduled = false;
    while (queue.length > 0 && closedWith === null) {
      const event = queue.shift() as ControlEvent;
      for (const listener of eventListeners) {
        try {
          listener(event);
        } catch {
          // a listener's failure is its own
        }
      }
    }
  }

  function commit(clientEventId: unknown): void {
    if (bufferedBytes === 0) {
      emit({ type: "error", error: { type: "invalid_request_error", code: "input_audio_buffer_commit_empty", event_id: clientEventId ?? null } });
      return;
    }
    bufferedBytes = 0;
    turn += 1;
    const itemId = `item_fake_c${turn}`;
    emit({ type: "input_audio_buffer.committed", item_id: itemId, previous_item_id: null });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: itemId,
      content_index: 0,
      transcript: fakeCallerTranscript(turn),
      usage: transcriptionUsage,
    });
  }

  function respond(): void {
    responses += 1;
    const id = `resp_fake_${responses}`;
    const itemId = `item_fake_a${responses}`;
    emit({ type: "response.created", response: { id, object: "realtime.response", status: "in_progress", output: [] } });
    const expect = turn > 0 ? options.expectations[turn - 1] : undefined;
    if (expect && !calledFor.has(turn)) {
      calledFor.add(turn);
      const callId = `call_fake_${responses}`;
      const args = JSON.stringify(fakeArguments(expect, options.tools));
      emit({ type: "response.output_item.added", response_id: id, item: { id: itemId, type: "function_call", call_id: callId, name: expect.tool } });
      emit({ type: "response.function_call_arguments.done", response_id: id, item_id: itemId, output_index: 0, call_id: callId, name: expect.tool, arguments: args });
      emit({
        type: "response.done",
        response: { id, status: "completed", output: [{ id: itemId, type: "function_call", call_id: callId, name: expect.tool, arguments: args }], usage: responseUsage },
      });
      return;
    }
    const transcript = fakeAssistantTranscript(responses);
    emit({ type: "response.output_item.added", response_id: id, item: { id: itemId, type: "message", role: "assistant" } });
    emit({ type: "response.output_audio.delta", response_id: id, item_id: itemId, delta: Buffer.alloc(480).toString("base64") });
    emit({ type: "response.output_audio_transcript.done", response_id: id, item_id: itemId, transcript });
    emit({
      type: "response.done",
      response: { id, status: "completed", output: [{ id: itemId, type: "message", role: "assistant", content: [{ type: "output_audio", transcript }] }], usage: responseUsage },
    });
  }

  function append(audio: unknown): void {
    const bytes = typeof audio === "string" ? Buffer.from(audio, "base64") : Buffer.alloc(0);
    bufferedBytes += bytes.length;
    if (!vad) return;
    const loud = bytes.some((byte) => byte !== 0);
    if (loud && !speech) {
      speech = true;
      emit({ type: "input_audio_buffer.speech_started", item_id: `item_fake_c${turn + 1}` });
    } else if (!loud && speech) {
      // Turn detection: the first silence after speech ends the turn and starts the answer.
      speech = false;
      emit({ type: "input_audio_buffer.speech_stopped", item_id: `item_fake_c${turn + 1}` });
      commit(null);
      respond();
    }
  }

  return {
    sent,
    get closedWith() {
      return closedWith;
    },
    get responses() {
      return responses;
    },
    send(event) {
      if (closedWith !== null) return false;
      sent.push(event);
      const type = event.type;
      if (type === "session.update") {
        const session = (event.session ?? {}) as Record<string, unknown>;
        const audio = session.audio as { input?: { turn_detection?: unknown } } | undefined;
        if (audio?.input && "turn_detection" in audio.input) vad = audio.input.turn_detection !== null;
        emit({ type: "session.updated", session: { ...session, tracing: null } });
      } else if (type === "input_audio_buffer.append") {
        append(event.audio);
      } else if (type === "input_audio_buffer.commit") {
        commit(event.event_id);
      } else if (type === "response.create") {
        respond();
      }
      return true;
    },
    close(code = 1000) {
      if (closedWith !== null) return;
      closedWith = code;
      queueMicrotask(() => {
        for (const listener of closeListeners) {
          try {
            listener({ code });
          } catch {
            // a listener's failure is its own
          }
        }
      });
    },
    onEvent(listener) {
      eventListeners.push(listener);
      // The first event of a direct WebSocket, once someone listens.
      if (eventListeners.length === 1) emit({ type: "session.created", session: { type: "realtime", object: "realtime.session" } });
    },
    onClose(listener) {
      closeListeners.push(listener);
    },
  };
}

/** The arguments of a fake tool call: the expected ones, and a placeholder for every other required field. */
export function fakeArguments(expect: AudioExpectation, tools: readonly VoiceToolDefinition[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const definition = tools.find((tool) => tool.name === expect.tool);
  for (const field of definition?.inputSchema.required ?? []) {
    const schema = definition?.inputSchema.properties[field] as { type?: unknown } | undefined;
    args[field] = schema?.type === "integer" || schema?.type === "number" ? 2 : schema?.type === "boolean" ? true : schema?.type === "object" ? {} : FAKE_PLACEHOLDER;
  }
  for (const [key, value] of Object.entries(expect.args ?? {})) {
    const parts = key.split(".");
    let target = args;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      if (typeof next !== "object" || next === null || Array.isArray(next)) target[part] = {};
      target = target[part] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = value;
  }
  return args;
}
