// A fake control connection of a realtime call (ControlSocket): no network. The test plays the
// provider: serverSends() delivers an event to the controller, drop() closes the socket from the
// far side. Everything the controller sends is recorded in `sent`. `script` builds the provider
// events the tests need, in the provider's shape, with placeholder ids only.
import type { ControlEvent, ControlSocket, OpenControlResult } from "@/lib/voice/server/providers/types";

export interface FakeControlSocket extends ControlSocket {
  /** Every event the controller sent, in order. */
  readonly sent: ControlEvent[];
  /** Codes the controller closed the socket with (one entry per close() call). */
  readonly closeCalls: number[];
  /** False after drop() or close(). */
  readonly open: boolean;
  /** Delivers one provider event to the listeners (anything: the controller must survive it). */
  serverSends(event: unknown): void;
  /** The provider side closes the socket (OpenAI: always 1006, no reason). */
  drop(code?: number): void;
  /** The sent events of one type. */
  sentOfType(type: string): ControlEvent[];
  /** The last sent event of one type (undefined when none). */
  lastOfType(type: string): ControlEvent | undefined;
}

export function createFakeControlSocket(): FakeControlSocket {
  const sent: ControlEvent[] = [];
  const closeCalls: number[] = [];
  const eventListeners: Array<(event: ControlEvent) => void> = [];
  const closeListeners: Array<(info: { code: number }) => void> = [];
  let open = true;
  let closeReported = false;

  function reportClose(code: number): void {
    if (closeReported) return;
    closeReported = true;
    for (const listener of closeListeners) listener({ code });
  }

  return {
    sent,
    closeCalls,
    get open() {
      return open;
    },
    send(event) {
      if (!open) return false;
      // A deep copy, as the real socket serialises the event when it is sent.
      sent.push(JSON.parse(JSON.stringify(event)) as ControlEvent);
      return true;
    },
    close(code = 1000) {
      closeCalls.push(code);
      open = false;
      reportClose(code);
    },
    onEvent(listener) {
      eventListeners.push(listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
    },
    serverSends(event) {
      if (!open) return;
      for (const listener of eventListeners) listener(event as ControlEvent);
    },
    drop(code = 1006) {
      open = false;
      reportClose(code);
    },
    sentOfType(type) {
      return sent.filter((event) => event.type === type);
    },
    lastOfType(type) {
      const matching = sent.filter((event) => event.type === type);
      return matching[matching.length - 1];
    },
  };
}

/** An openControl hook that opens the given socket. */
export function openControlOk(socket: ControlSocket): () => Promise<OpenControlResult> {
  return () => Promise.resolve({ ok: true, socket });
}

/** An openControl hook that fails with the given code. */
export function openControlFails(code: "timeout" | "upstream" | "no_websocket"): () => Promise<OpenControlResult> {
  return () => Promise.resolve({ ok: false, code });
}

/** Usage of a response.done in the provider's shape (missing numbers are 0). */
export function usageOf(tokens: {
  inText?: number;
  inAudio?: number;
  inCachedText?: number;
  inCachedAudio?: number;
  outText?: number;
  outAudio?: number;
  reasoning?: number;
}): ControlEvent {
  const inText = tokens.inText ?? 0;
  const inAudio = tokens.inAudio ?? 0;
  const outText = tokens.outText ?? 0;
  const outAudio = tokens.outAudio ?? 0;
  return {
    total_tokens: inText + inAudio + outText + outAudio,
    input_tokens: inText + inAudio,
    output_tokens: outText + outAudio,
    input_token_details: {
      text_tokens: inText,
      audio_tokens: inAudio,
      image_tokens: 0,
      cached_tokens: (tokens.inCachedText ?? 0) + (tokens.inCachedAudio ?? 0),
      cached_tokens_details: { text_tokens: tokens.inCachedText ?? 0, audio_tokens: tokens.inCachedAudio ?? 0, image_tokens: 0 },
    },
    output_token_details: { text_tokens: outText, audio_tokens: outAudio, reasoning_tokens: tokens.reasoning ?? 0 },
  };
}

/** Provider events, as the control socket delivers them. */
export const script = {
  /** The session.updated that answers the read-back, matching what the controller expects. */
  readback(expected: { instructionsChars: number; toolCount: number }, overrides: Record<string, unknown> = {}): ControlEvent {
    return {
      type: "session.updated",
      event_id: "event_readback",
      session: {
        type: "realtime",
        tracing: null,
        instructions: "x".repeat(expected.instructionsChars),
        tools: Array.from({ length: expected.toolCount }, (_, i) => ({ type: "function", name: `tool_${i}` })),
        ...overrides,
      },
    };
  },
  sessionUpdated(): ControlEvent {
    return { type: "session.updated", session: { type: "realtime", tracing: null, instructions: "", tools: [] } };
  },
  responseCreated(id: string): ControlEvent {
    return { type: "response.created", response: { id, status: "in_progress" } };
  },
  responseDone(id: string, options: { status?: string; usage?: ControlEvent | null } = {}): ControlEvent {
    const response: ControlEvent = { id, status: options.status ?? "completed", output: [] };
    if (options.usage !== null) response.usage = options.usage ?? usageOf({ inText: 100, outText: 10, outAudio: 50 });
    return { type: "response.done", response };
  },
  audioStarted(responseId: string): ControlEvent {
    return { type: "output_audio_buffer.started", response_id: responseId };
  },
  audioStopped(responseId: string): ControlEvent {
    return { type: "output_audio_buffer.stopped", response_id: responseId };
  },
  audioCleared(responseId: string): ControlEvent {
    return { type: "output_audio_buffer.cleared", response_id: responseId };
  },
  speechStarted(itemId = "item_caller"): ControlEvent {
    return { type: "input_audio_buffer.speech_started", audio_start_ms: 0, item_id: itemId };
  },
  speechStopped(itemId = "item_caller"): ControlEvent {
    return { type: "input_audio_buffer.speech_stopped", audio_end_ms: 0, item_id: itemId };
  },
  committed(itemId: string): ControlEvent {
    return { type: "input_audio_buffer.committed", item_id: itemId };
  },
  callerDelta(itemId: string, delta: string): ControlEvent {
    return { type: "conversation.item.input_audio_transcription.delta", item_id: itemId, delta };
  },
  callerCompleted(itemId: string, transcript: string, extra: Record<string, unknown> = {}): ControlEvent {
    return { type: "conversation.item.input_audio_transcription.completed", item_id: itemId, transcript, ...extra };
  },
  callerFailed(itemId: string): ControlEvent {
    return { type: "conversation.item.input_audio_transcription.failed", item_id: itemId, error: { type: "transcription_error" } };
  },
  assistantDelta(itemId: string, delta: string, responseId = "resp_x"): ControlEvent {
    return { type: "response.output_audio_transcript.delta", item_id: itemId, response_id: responseId, delta };
  },
  assistantDone(itemId: string, transcript: string, responseId = "resp_x"): ControlEvent {
    return { type: "response.output_audio_transcript.done", item_id: itemId, response_id: responseId, transcript };
  },
  functionCall(responseId: string, callId: string, name: string, args: unknown = {}): ControlEvent {
    return {
      type: "response.function_call_arguments.done",
      response_id: responseId,
      item_id: `item_${callId}`,
      call_id: callId,
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    };
  },
  error(code: string, eventId?: string): ControlEvent {
    return { type: "error", error: { type: "invalid_request_error", code, ...(eventId !== undefined ? { event_id: eventId } : {}) } };
  },
  rateLimits(remaining: number): ControlEvent {
    return { type: "rate_limits.updated", rate_limits: [{ name: "tokens", limit: 200_000, remaining, reset_seconds: 1 }] };
  },
  userTextItem(): ControlEvent {
    return {
      type: "conversation.item.added",
      item: { id: "item_text", type: "message", role: "user", content: [{ type: "input_text", text: "placeholder" }] },
    };
  },
};
