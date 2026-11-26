// The one interface the voice widget talks to, whatever carries the conversation: a written
// example on timers (scripted.ts), the browser's own speech engines around our text endpoint
// (local.ts), or a voice provider over WebRTC (realtime.ts).
//
// Transports report through events that are machine events (voice-machine.ts), so the stage
// feeds them straight into the reducer and illegal or late ones are dropped there.
import type { VoiceLocale, VoiceMode, VoicePublicConfig } from "@/lib/voice/types";
import type { VoiceEndReason, VoiceTransportEvent } from "../voice-machine";

export type VoiceTransportListener = (event: VoiceTransportEvent) => void;

export interface VoiceTransport {
  readonly mode: VoiceMode;
  /**
   * Starts the conversation. Call it synchronously from the click that gave consent: Safari and
   * Chrome only unlock audio output (AudioContext, speechSynthesis) inside a user gesture.
   * Never throws; every failure arrives as a FAIL or MIC_FAILED event.
   */
  start(): void;
  /**
   * Ends the conversation and releases everything it holds: timers, open requests, the
   * microphone, the audio context, speech recognition and synthesis. Tells the end endpoint when
   * a live session was open. Idempotent; no event is emitted afterwards.
   */
  stop(reason: VoiceEndReason): void;
  setMuted(muted: boolean): void;
  /** A typed caller turn. false when it cannot be taken now (no session yet, a reply is being prepared). */
  sendText(text: string): boolean;
  /** The visitor switched language: recognition and synthesis follow from the next utterance on. */
  setLocale(locale: VoiceLocale): void;
  /** Returns the unsubscribe function. */
  onEvent(listener: VoiceTransportListener): () => void;
  /** Loudness 0..1 for the orb, polled once per animation frame: cheap and never throws. */
  getLevel(): number;
  /**
   * The visitor pressed the turn-on-sound button: retry playback inside this gesture. Never
   * throws. Only transports whose playback a browser can block implement it (realtime).
   */
  resumeAudio?(): void;
}

export interface VoiceTransportOptions {
  config: VoicePublicConfig;
  locale: VoiceLocale;
  /** Path of the page the widget is on (context for the server, max 200 chars). */
  page?: string;
  /** The stage's honeypot field: empty for people, sent as SessionRequestBody.hp. */
  hp?: string;
}

/** A tiny event hub. A throwing listener never breaks the transport that emits. */
export function createEmitter(): {
  emit: (event: VoiceTransportEvent) => void;
  on: (listener: VoiceTransportListener) => () => void;
  clear: () => void;
} {
  const listeners = new Set<VoiceTransportListener>();
  return {
    emit(event) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event);
        } catch {
          // The widget's own bug; the conversation goes on.
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      listeners.clear();
    },
  };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Monotonic milliseconds where available (not affected by clock changes). */
export function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
