// Mode "scripted": a written example conversation played back with captions. Timers only: no
// microphone, no sound, no model. The orb still moves, from a loudness envelope synthesised from
// the line being shown, so the example reads like a call without pretending to be one (the stage
// labels it "example, no sound" throughout).
//
// schedule() is pure and unit-tested (tests/voice/scripted.test.ts): it turns a DemoScript into
// machine events at fixed offsets, so replaying them through the reducer must end the example in
// "ended" with every line captioned.
import { scriptCaptionId } from "@/lib/voice/after-call";
import type { DemoScript } from "@/lib/voice/types";
import type { VoiceTransportEvent } from "../voice-machine";
import { requestSession } from "./http";
import { clamp01, createEmitter, nowMs, type VoiceTransport, type VoiceTransportOptions } from "./types";

export interface ScheduleTiming {
  /** Reading speed that sets how long a line stays the current one. */
  charsPerSecond: number;
  /** Pause when the other party speaks next. */
  speakerPauseMs: number;
  /** Pause between two lines of the same party. */
  samePauseMs: number;
  /** How long a tool step ("checking the calendar") is shown. */
  toolMs: number;
  /** Quiet moment after the start, before the first line. */
  leadInMs: number;
  /** Shortest time a line is shown ("Ja." still needs a moment). */
  minLineMs: number;
  /** After the last line, before the example ends. */
  tailMs: number;
}

export const SCRIPT_TIMING: ScheduleTiming = {
  charsPerSecond: 14,
  speakerPauseMs: 700,
  samePauseMs: 250,
  toolMs: 1400,
  leadInMs: 600,
  minLineMs: 1200,
  tailMs: 1600,
};

export interface ScriptStep {
  /** Milliseconds after the start. Steps are sorted by `at`; equal times keep their order. */
  at: number;
  event: VoiceTransportEvent;
}

/** When someone is "speaking" in the example: drives the orb. */
export interface SpeechWindow {
  from: number;
  to: number;
  role: "assistant" | "caller";
  text: string;
}

export interface ScriptSchedule {
  steps: ScriptStep[];
  windows: SpeechWindow[];
  durationMs: number;
}

/** How long a line stays on: its length at reading speed, never less than minLineMs. */
export function lineDuration(text: string, timing: ScheduleTiming = SCRIPT_TIMING): number {
  const chars = text.trim().length;
  return Math.max(timing.minLineMs, Math.round((chars / timing.charsPerSecond) * 1000));
}

/**
 * The example as timed machine events:
 *   0            CONNECTED
 *   leadIn       first line: SPEAKING (assistant) or LISTENING (caller), then its CAPTION
 *   ...          between parties: LISTENING when the caller is next, THINKING before an answer;
 *                a tool step: THINKING, TOOL started, (toolMs), TOOL ok/failed, then the line
 *   end + tail   END "complete"
 * Caption ids are "<script id>#<line index>" (scriptCaptionId), so a replay never mixes two runs,
 * and the stage knows which tool steps of the example have run (lib/voice/after-call.ts).
 */
export function schedule(script: DemoScript, overrides?: Partial<ScheduleTiming>): ScriptSchedule {
  const timing: ScheduleTiming = { ...SCRIPT_TIMING, ...overrides };
  const steps: ScriptStep[] = [];
  const windows: SpeechWindow[] = [];
  const push = (at: number, event: VoiceTransportEvent) => steps.push({ at, event });

  push(0, { type: "CONNECTED" });
  let t = timing.leadInMs;
  let previous: "assistant" | "caller" | null = null;

  script.lines.forEach((line, index) => {
    const text = line.text.trim();
    if (!text) return;
    if (previous !== null) {
      // Turn-taking happens in the pause: the orb settles before the next voice starts.
      if (line.role === "caller" && previous === "assistant") push(t, { type: "LISTENING" });
      if (line.role === "assistant" && previous === "caller") push(t, { type: "THINKING" });
      t += line.role === previous ? timing.samePauseMs : timing.speakerPauseMs;
    }
    // Only the assistant uses tools; a tool on a caller line would be a script error and is skipped.
    if (line.tool && line.role === "assistant") {
      push(t, { type: "THINKING" });
      push(t, { type: "TOOL", name: line.tool.name, status: "started" });
      t += timing.toolMs;
      push(t, { type: "TOOL", name: line.tool.name, status: line.tool.outcome === "ok" ? "ok" : "failed" });
    }
    push(t, line.role === "assistant" ? { type: "SPEAKING" } : { type: "LISTENING" });
    push(t, {
      type: "CAPTION",
      caption: { id: scriptCaptionId(script.id, index), role: line.role, text, final: true, locale: script.locale },
    });
    const duration = lineDuration(text, timing);
    windows.push({ from: t, to: t + duration, role: line.role, text });
    t += duration;
    previous = line.role;
  });

  // The last voice falls quiet before the example closes.
  if (previous === "assistant") push(t, { type: "LISTENING" });
  t += timing.tailMs;
  push(t, { type: "END", reason: "complete" });
  return { steps, windows, durationMs: t };
}

/**
 * A plausible loudness for `text` being spoken, `elapsedMs` into a line of `durationMs`:
 * vowels loud, consonants softer, gaps between words and at punctuation, a syllable rhythm of
 * about 4 Hz, a short rise and fall at the line's edges. Deterministic, always within 0..1.
 */
export function speechEnvelope(text: string, elapsedMs: number, durationMs: number): number {
  if (!text || durationMs <= 0 || elapsedMs < 0 || elapsedMs > durationMs) return 0;
  const progress = elapsedMs / durationMs;
  const char = text[Math.min(text.length - 1, Math.floor(progress * text.length))] ?? " ";
  let base: number;
  if (/[aeiouyäöüàèéìòùâêîôû]/i.test(char)) base = 0.9;
  else if (/[\p{L}\p{N}]/u.test(char)) base = 0.6;
  else if (/[.,;:!?…]/.test(char)) base = 0.08;
  else base = 0.22; // a space between words
  const seconds = elapsedMs / 1000;
  const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.1 * seconds);
  const phrase = 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.55 * seconds + 1.1);
  const edge = Math.min(1, elapsedMs / 140, (durationMs - elapsedMs) / 200);
  return clamp01(base * (0.62 + 0.38 * syllable) * phrase * edge);
}

/** The orb's level at `elapsedMs` into a scheduled example: 0 in the pauses. */
export function levelAt(plan: ScriptSchedule, elapsedMs: number): number {
  for (const window of plan.windows) {
    if (elapsedMs >= window.from && elapsedMs <= window.to) {
      return speechEnvelope(window.text, elapsedMs - window.from, window.to - window.from);
    }
  }
  return 0;
}

export interface ScriptedTransportOptions extends VoiceTransportOptions {
  script: DemoScript;
  timing?: Partial<ScheduleTiming>;
}

/**
 * Plays `script`. When the server offers other modes besides "scripted", the start is announced
 * with a session request (mode "scripted") like every other conversation; the example does not
 * wait for it and plays whatever the answer: it costs nothing and refusing it would help nobody.
 * When "scripted" is all the server offers and the page has the script, no request is made.
 */
export function createScriptedTransport(options: ScriptedTransportOptions): VoiceTransport {
  const { config, script } = options;
  const emitter = createEmitter();
  const plan = schedule(script, options.timing);
  let startedAt: number | null = null;
  let stopped = false;
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const session = new AbortController();

  // One timer at a time, re-armed for the next step: a hidden tab throttles timers, and catching
  // up by elapsed time keeps the order of events whatever the delays.
  const run = () => {
    if (stopped || startedAt === null) return;
    const elapsed = nowMs() - startedAt;
    while (next < plan.steps.length && plan.steps[next].at <= elapsed) {
      const step = plan.steps[next];
      next += 1;
      emitter.emit(step.event);
      if (stopped) return;
    }
    if (next < plan.steps.length) {
      timer = setTimeout(run, Math.max(0, plan.steps[next].at - (nowMs() - startedAt)));
    }
  };

  return {
    mode: "scripted",
    start() {
      if (startedAt !== null || stopped) return;
      const onlyScripted = config.modes.length === 1 && config.modes[0] === "scripted";
      if (!onlyScripted) {
        void requestSession(
          config.endpoints.session,
          { tenant: config.tenant, locale: script.locale, mode: "scripted", page: options.page, hp: options.hp ?? "" },
          session.signal,
        );
      }
      startedAt = nowMs();
      run();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      session.abort();
      emitter.clear();
    },
    setMuted() {
      // Nothing is recorded in an example.
    },
    sendText() {
      return false;
    },
    setLocale() {
      // An example is written in one language; the stage picks another script instead.
    },
    onEvent(listener) {
      return emitter.on(listener);
    },
    getLevel() {
      if (stopped || startedAt === null) return 0;
      return levelAt(plan, nowMs() - startedAt);
    },
  };
}
