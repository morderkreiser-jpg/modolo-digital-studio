// Conversation state of the voice widget: a pure reducer, no React and no browser APIs, so every
// rule below is unit-tested (tests/voice/machine.test.ts) and shared by all three transports.
//
//   idle ─START(scripted)──────────────────────────────▶ connecting
//   idle ─START(live)─▶ consent ─CONSENT(voice)─▶ requesting_mic ─MIC_GRANTED/CONNECTING─▶ connecting
//                              └─CONSENT(text)─────────────────────────────────────────▶ connecting
//   connecting ─CONNECTED─▶ listening ⇄ thinking ⇄ speaking      (INTERRUPT: speaking → listening)
//   any running state ─END─▶ ended          any started state ─FAIL─▶ error
//   ended / error are terminal: everything but RESET and SET_LOCALE is ignored there.
//
// Events that do not fit the current state are IGNORED, never thrown: transports run on timers,
// network streams and browser callbacks, and a late event (a caption arriving after the visitor
// pressed "end") must not crash or resurrect a conversation.
import type {
  EndRequestBody,
  HandoffNotice,
  VoiceErrorCode,
  VoiceLimits,
  VoiceLocale,
  VoiceMode,
  VoiceToolName,
} from "@/lib/voice/types";

// ---------------------------------------------------------------------------------------------
// Vocabulary (the lists double as the key sets of the strings tables, see lib/voice/i18n.ts)
// ---------------------------------------------------------------------------------------------

export const VOICE_STATUSES = [
  "idle",
  "consent",
  "requesting_mic",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "ended",
  "error",
] as const;
export type VoiceStatus = (typeof VOICE_STATUSES)[number];

/**
 * Why a conversation ended. The contract's EndRequestBody reasons, plus two the widget shows but
 * the server never needs: "complete" (an example played to its end) and "limit" (the server's
 * turn allowance is used up; reported to the end endpoint as "assistant").
 */
export const VOICE_END_REASONS = ["user", "assistant", "timeout", "silence", "error", "unload", "complete", "limit"] as const;
export type VoiceEndReason = (typeof VOICE_END_REASONS)[number];

/** Failures detected in the browser, on top of the server's VoiceErrorCode. */
export const VOICE_CLIENT_ERROR_CODES = [
  "mic_denied", // permission refused (NotAllowedError, recognition "not-allowed")
  "mic_unavailable", // no device, or held by another program (NotFoundError, NotReadableError)
  "network", // fetch failed
  "offline",
  "unsupported", // the browser lacks what this mode needs (fetch streams, getUserMedia...)
  "not_available_yet", // realtime: the grant came, the provider connection is not built yet
  "mode_unavailable", // the server answered with a mode the widget did not ask for
  "load_failed", // a lazy chunk (transport) could not be fetched
] as const;
export type VoiceClientErrorCode = (typeof VOICE_CLIENT_ERROR_CODES)[number];

export const VOICE_SERVER_ERROR_CODES = [
  "bad_request",
  "too_large",
  "forbidden",
  "rate_limited",
  "busy",
  "budget_exhausted",
  "session_limit",
  "expired",
  "unavailable",
  "upstream",
  "timeout",
  "refused",
] as const satisfies readonly VoiceErrorCode[];

export type VoiceFailureCode = VoiceErrorCode | VoiceClientErrorCode;
export const VOICE_FAILURE_CODES: readonly VoiceFailureCode[] = [...VOICE_SERVER_ERROR_CODES, ...VOICE_CLIENT_ERROR_CODES];

/**
 * Transient hints that do NOT end the conversation (the visitor can carry on, often by typing).
 * Cleared by the next caller activity or by NOTICE null.
 */
export const VOICE_NOTICE_CODES = [
  "no_speech",
  "recognition_unsupported",
  "recognition_network",
  "recognition_unavailable",
  "audio_capture",
  "no_synthesis",
] as const;
export type VoiceNoticeCode = (typeof VOICE_NOTICE_CODES)[number];

export type VoiceMachineLimits = Pick<
  VoiceLimits,
  "maxCallSeconds" | "warnBeforeEndSeconds" | "silenceTimeoutSeconds" | "maxTurnChars"
>;

export interface VoiceCaption {
  /** Stable per line: interim updates of the same utterance replace each other. */
  id: string;
  role: "assistant" | "caller";
  text: string;
  /** false while speech is still being recognised or a reply is still streaming. */
  final: boolean;
  /** Language of the line, for its lang attribute. */
  locale: VoiceLocale;
}

export interface VoiceMachineState {
  status: VoiceStatus;
  /** Mode of the current (or last) conversation; null before the first start. */
  mode: VoiceMode | null;
  locale: VoiceLocale;
  /** Languages the widget may switch to (the tenant's). */
  locales: readonly VoiceLocale[];
  muted: boolean;
  /** Text input instead of the microphone: chosen in the consent step or forced by a fallback. */
  typed: boolean;
  captions: VoiceCaption[];
  /** Live modes only, from CONNECTED on. */
  secondsLeft: number | null;
  /** Seconds the caller has been silent while it was their turn. */
  silentSeconds: number;
  limits: VoiceMachineLimits;
  errorCode: VoiceFailureCode | null;
  retryAfter: number | null;
  endReason: VoiceEndReason | null;
  /** The tool the assistant is running right now (shown as "checking the calendar"). */
  activeTool: VoiceToolName | null;
  handoff: HandoffNotice | null;
  notice: VoiceNoticeCode | null;
  /** Increases with every START and RESET: keys per-conversation UI and drops stale timers. */
  run: number;
}

export type VoiceEvent =
  | { type: "START"; mode: VoiceMode }
  | { type: "CONSENT"; input: "voice" | "text" }
  | { type: "CANCEL" }
  | { type: "MIC_GRANTED" }
  | { type: "MIC_FAILED"; code: "mic_denied" | "mic_unavailable" }
  /** The transport goes on without the microphone (typed input, or a mode that does not need it yet). */
  | { type: "CONNECTING" }
  | { type: "CONNECTED"; limits?: Partial<VoiceMachineLimits> }
  | { type: "LISTENING" }
  | { type: "THINKING" }
  | { type: "SPEAKING" }
  /** The caller spoke over the assistant (barge-in). */
  | { type: "INTERRUPT" }
  | { type: "CAPTION"; caption: VoiceCaption }
  | { type: "TOOL"; name: VoiceToolName; status: "started" | "ok" | "failed" }
  | { type: "HANDOFF"; handoff: HandoffNotice }
  | { type: "NOTICE"; notice: VoiceNoticeCode | null }
  /** Switch to text input for the rest of the conversation (recognition missing or failing). */
  | { type: "TYPED" }
  /** The caller is doing something (speech recognised, typing): the silence count restarts. */
  | { type: "ACTIVITY" }
  /** Wall-clock seconds that passed (default 1). Drives the call limit and the silence limit. */
  | { type: "TICK"; seconds?: number }
  /** The server's own count of the seconds left (it wins when lower). */
  | { type: "REMAINING"; seconds: number }
  | { type: "MUTE"; muted: boolean }
  | { type: "END"; reason: VoiceEndReason }
  | { type: "FAIL"; code: VoiceFailureCode; retryAfter?: number | null }
  | { type: "SET_LOCALE"; locale: VoiceLocale }
  | { type: "RESET" };

/** The events a transport may emit. The buttons own the rest (START, CONSENT, MUTE, RESET...). */
export type VoiceTransportEvent = Extract<
  VoiceEvent,
  {
    type:
      | "MIC_GRANTED"
      | "MIC_FAILED"
      | "CONNECTING"
      | "CONNECTED"
      | "LISTENING"
      | "THINKING"
      | "SPEAKING"
      | "INTERRUPT"
      | "CAPTION"
      | "TOOL"
      | "HANDOFF"
      | "NOTICE"
      | "TYPED"
      | "ACTIVITY"
      | "REMAINING"
      | "END"
      | "FAIL";
  }
>;

/** Conversation length kept in memory: a 3-minute call never comes close, a runaway loop would. */
export const MAX_CAPTIONS = 200;
/** The remaining-time indicator shows up from here on. */
export const TIMER_VISIBLE_FROM_SECONDS = 30;

const FALLBACK_LIMITS: VoiceMachineLimits = {
  maxCallSeconds: 180,
  warnBeforeEndSeconds: 20,
  silenceTimeoutSeconds: 25,
  maxTurnChars: 600,
};

// ---------------------------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------------------------

/** Modes with a real conversation (microphone or typed input, a server session, a clock). */
export function isLiveMode(mode: VoiceMode | null): mode is "local" | "realtime" {
  return mode === "local" || mode === "realtime";
}

/** Between START and the end: something is (or is about to be) going on. */
export function isActive(status: VoiceStatus): boolean {
  return status !== "idle" && status !== "ended" && status !== "error";
}

/** A conversation is under way: the turn-taking states. */
export function isTalking(status: VoiceStatus): boolean {
  return status === "listening" || status === "thinking" || status === "speaking";
}

/** Things a transport started can still be told about (captions, tools, notices...). */
function acceptsTransportEvents(status: VoiceStatus): boolean {
  return status === "connecting" || isTalking(status);
}

export function isTerminal(status: VoiceStatus): boolean {
  return status === "ended" || status === "error";
}

export function canMute(state: VoiceMachineState): boolean {
  return isLiveMode(state.mode) && !state.typed && (state.status === "connecting" || isTalking(state.status));
}

export function timerVisible(state: VoiceMachineState): boolean {
  return (
    isLiveMode(state.mode) &&
    isTalking(state.status) &&
    state.secondsLeft !== null &&
    state.secondsLeft <= TIMER_VISIBLE_FROM_SECONDS
  );
}

/** The reason the end endpoint is told (it knows the contract's reasons only). */
export function toEndRequestReason(reason: VoiceEndReason): EndRequestBody["reason"] {
  if (reason === "complete") return "user";
  if (reason === "limit") return "assistant";
  return reason;
}

// ---------------------------------------------------------------------------------------------
// Recovery: every failure offers a way forward
// ---------------------------------------------------------------------------------------------

export type VoiceRecovery = "retry" | "new_conversation" | "type_instead" | "watch_example" | "contact";

/**
 * What the error card offers, best first. `retry` repeats the same start, `new_conversation`
 * starts afresh, `type_instead` restarts a local conversation without the microphone,
 * `watch_example` switches to the written example, `contact` links to the people.
 * Never empty: with nothing else possible, `retry` stays.
 */
export function recoveryFor(
  code: VoiceFailureCode,
  context: { mode: VoiceMode | null; hasScripts: boolean; hasContact: boolean },
): VoiceRecovery[] {
  const actions: VoiceRecovery[] = [];
  const canType = context.mode === "local";
  const example = context.hasScripts && context.mode !== "scripted";
  switch (code) {
    case "mic_denied":
    case "mic_unavailable":
      actions.push("retry");
      if (canType) actions.push("type_instead");
      if (example) actions.push("watch_example");
      break;
    case "unsupported":
      if (canType) actions.push("type_instead");
      if (example) actions.push("watch_example");
      break;
    case "network":
    case "offline":
    case "busy":
    case "upstream":
    case "timeout":
    case "load_failed":
      actions.push("retry");
      break;
    case "expired":
    case "session_limit":
    case "refused":
    case "too_large":
    case "bad_request":
      actions.push("new_conversation");
      break;
    case "forbidden":
    case "rate_limited":
    case "budget_exhausted":
    case "unavailable":
    case "not_available_yet":
    case "mode_unavailable":
      if (example) actions.push("watch_example");
      break;
  }
  // Where trying again cannot help, or on top of a plain retry: the people behind the business.
  if (context.hasContact && code !== "load_failed") actions.push("contact");
  if (actions.length === 0) actions.push("retry");
  return actions;
}

// ---------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------

export function initVoiceState(options: {
  locale: VoiceLocale;
  locales?: readonly VoiceLocale[];
  limits?: Partial<VoiceMachineLimits>;
  run?: number;
}): VoiceMachineState {
  const locales = options.locales && options.locales.length > 0 ? options.locales : [options.locale];
  return {
    status: "idle",
    mode: null,
    locale: locales.includes(options.locale) ? options.locale : locales[0],
    locales,
    muted: false,
    typed: false,
    captions: [],
    secondsLeft: null,
    silentSeconds: 0,
    limits: mergeLimits(FALLBACK_LIMITS, options.limits),
    errorCode: null,
    retryAfter: null,
    endReason: null,
    activeTool: null,
    handoff: null,
    notice: null,
    run: options.run ?? 0,
  };
}

export function voiceReducer(state: VoiceMachineState, event: VoiceEvent): VoiceMachineState {
  switch (event.type) {
    case "START": {
      if (state.status !== "idle") return state;
      const fresh = initVoiceState({ locale: state.locale, locales: state.locales, limits: state.limits, run: state.run + 1 });
      // Scripted needs no permission and no consent: nothing is recorded or sent.
      return { ...fresh, mode: event.mode, status: isLiveMode(event.mode) ? "consent" : "connecting" };
    }

    case "CONSENT":
      // The only way to the microphone: an explicit START followed by an explicit consent.
      if (state.status !== "consent") return state;
      return event.input === "voice"
        ? { ...state, status: "requesting_mic" }
        : { ...state, status: "connecting", typed: true };

    case "CANCEL":
      if (state.status !== "consent") return state;
      return { ...state, status: "idle", mode: null };

    case "MIC_GRANTED":
      if (state.status !== "requesting_mic") return state;
      return { ...state, status: "connecting" };

    case "MIC_FAILED":
      if (state.status !== "requesting_mic") return state;
      return fail(state, event.code, null);

    case "CONNECTING":
      if (state.status !== "requesting_mic") return state;
      return { ...state, status: "connecting" };

    case "CONNECTED": {
      if (state.status !== "connecting") return state;
      const limits = mergeLimits(state.limits, event.limits);
      return {
        ...state,
        status: "listening",
        limits,
        // The clock only runs for a real conversation; an example plays at its own pace.
        secondsLeft: isLiveMode(state.mode) ? limits.maxCallSeconds : null,
        silentSeconds: 0,
      };
    }

    case "LISTENING":
      if (state.status === "listening") return state;
      if (state.status !== "thinking" && state.status !== "speaking") return state;
      // The caller's turn starts now: silence is counted from here.
      return { ...state, status: "listening", silentSeconds: 0 };

    case "THINKING":
      if (state.status !== "listening" && state.status !== "speaking") return state;
      return { ...state, status: "thinking" };

    case "SPEAKING":
      if (state.status !== "listening" && state.status !== "thinking") return state;
      return { ...state, status: "speaking" };

    case "INTERRUPT":
      if (state.status !== "speaking") return state;
      return { ...state, status: "listening", silentSeconds: 0, notice: null };

    case "CAPTION": {
      if (!acceptsTransportEvents(state.status)) return state;
      const captions = upsertCaption(state.captions, event.caption);
      if (captions === state.captions) return state;
      const fromCaller = event.caption.role === "caller";
      return {
        ...state,
        captions,
        silentSeconds: fromCaller ? 0 : state.silentSeconds,
        notice: fromCaller && state.notice === "no_speech" ? null : state.notice,
      };
    }

    case "TOOL":
      if (!acceptsTransportEvents(state.status)) return state;
      if (event.status === "started") return { ...state, activeTool: event.name };
      return state.activeTool === event.name ? { ...state, activeTool: null } : state;

    case "HANDOFF":
      if (!acceptsTransportEvents(state.status)) return state;
      return { ...state, handoff: event.handoff };

    case "NOTICE":
      if (!isActive(state.status) || state.status === "consent") return state;
      return state.notice === event.notice ? state : { ...state, notice: event.notice };

    case "TYPED":
      if (!isLiveMode(state.mode) || !isActive(state.status) || state.status === "consent") return state;
      // Without a microphone there is nothing to mute.
      return state.typed ? state : { ...state, typed: true, muted: false };

    case "ACTIVITY":
      if (!acceptsTransportEvents(state.status) || state.silentSeconds === 0) return state;
      return { ...state, silentSeconds: 0 };

    case "TICK": {
      if (!isLiveMode(state.mode) || !isTalking(state.status) || state.secondsLeft === null) return state;
      const seconds = event.seconds ?? 1;
      if (!Number.isFinite(seconds) || seconds <= 0) return state;
      const secondsLeft = Math.max(0, state.secondsLeft - seconds);
      if (secondsLeft === 0) return end({ ...state, secondsLeft }, "timeout");
      // Silence is the caller's: it only counts while it is their turn to speak.
      const silentSeconds = state.status === "listening" ? state.silentSeconds + seconds : state.silentSeconds;
      if (silentSeconds >= state.limits.silenceTimeoutSeconds) return end({ ...state, secondsLeft, silentSeconds }, "silence");
      return { ...state, secondsLeft, silentSeconds };
    }

    case "REMAINING": {
      if (!isLiveMode(state.mode) || !acceptsTransportEvents(state.status)) return state;
      if (!Number.isFinite(event.seconds)) return state;
      const reported = Math.max(0, Math.floor(event.seconds));
      const secondsLeft = state.secondsLeft === null ? reported : Math.min(state.secondsLeft, reported);
      return secondsLeft === state.secondsLeft ? state : { ...state, secondsLeft };
    }

    case "MUTE":
      if (!canMute(state) || state.muted === event.muted) return state;
      return { ...state, muted: event.muted };

    case "END":
      if (state.status !== "requesting_mic" && !acceptsTransportEvents(state.status)) return state;
      return end(state, event.reason);

    case "FAIL":
      if (!isActive(state.status)) return state;
      return fail(state, event.code, event.retryAfter ?? null);

    case "SET_LOCALE":
      if (!state.locales.includes(event.locale) || state.locale === event.locale) return state;
      return { ...state, locale: event.locale };

    case "RESET":
      return initVoiceState({ locale: state.locale, locales: state.locales, limits: state.limits, run: state.run + 1 });

    default:
      return state;
  }
}

function end(state: VoiceMachineState, reason: VoiceEndReason): VoiceMachineState {
  return {
    ...state,
    status: "ended",
    endReason: reason,
    activeTool: null,
    notice: null,
    muted: false,
    captions: finalizeCaptions(state.captions),
  };
}

function fail(state: VoiceMachineState, code: VoiceFailureCode, retryAfter: number | null): VoiceMachineState {
  return {
    ...state,
    status: "error",
    errorCode: code,
    retryAfter: retryAfter !== null && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
    activeTool: null,
    notice: null,
    muted: false,
    captions: finalizeCaptions(state.captions),
  };
}

/** What was on screen stays readable after the end; nothing is "still being recognised" any more. */
function finalizeCaptions(captions: VoiceCaption[]): VoiceCaption[] {
  if (captions.every((caption) => caption.final)) return captions;
  return captions
    .filter((caption) => caption.final || caption.text.trim() !== "")
    .map((caption) => (caption.final ? caption : { ...caption, final: true }));
}

function upsertCaption(captions: VoiceCaption[], caption: VoiceCaption): VoiceCaption[] {
  const index = captions.findIndex((existing) => existing.id === caption.id);
  if (index === -1) {
    if (caption.text.trim() === "") return captions;
    const next = [...captions, caption];
    return next.length > MAX_CAPTIONS ? next.slice(next.length - MAX_CAPTIONS) : next;
  }
  const existing = captions[index];
  // A late interim result must not reopen a finished line.
  if (existing.final && !caption.final) return captions;
  if (existing.text === caption.text && existing.final === caption.final && existing.locale === caption.locale) {
    return captions;
  }
  const next = captions.slice();
  next[index] = { ...caption, role: existing.role };
  return next;
}

function mergeLimits(base: VoiceMachineLimits, overrides: Partial<VoiceMachineLimits> | undefined): VoiceMachineLimits {
  if (!overrides) return base;
  const merged = { ...base };
  for (const key of Object.keys(base) as Array<keyof VoiceMachineLimits>) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) merged[key] = Math.floor(value);
  }
  return merged;
}
