// Mode "local": a development and test harness. The browser's own SpeechRecognition turns the
// caller's speech into text, the turn endpoint answers as a stream of events, and speechSynthesis
// reads the reply aloud sentence by sentence while it is still streaming. Free, but not the
// product's voice quality, and recognition may run on the browser vendor's servers (the consent
// step says so).
//
// Order of a start, all after the visitor's consent click:
//   unlock synthesis + create the AudioContext (inside the click: Safari needs the gesture)
//   → getUserMedia (the permission prompt; on desktop the stream feeds the orb's level meter)
//   → POST session → CONNECTED → opening turn (the greeting) → listening ⇄ thinking ⇄ speaking
// Typed input skips the microphone entirely. Without SpeechRecognition (Firefox) the transport
// falls back to typed input by itself and says so.
//
// Barge-in: on desktop, recognition keeps running while the assistant speaks; speech that is not
// an echo of the assistant's own words cancels the synthesis and the rest of the streamed reply.
// Phones are handled more carefully (see platform.ts): no meter stream next to recognition, and
// recognition waits until the reply has been read.
//
// When a reply has been spoken is decided by the speech queue (speech-queue.ts), never by a timer
// started when a sentence was queued: a streamed reply queues all its sentences at once.
import { VOICE_LANG_TAG, type TurnRequestBody, type TurnStreamEvent, type VoiceLocale } from "@/lib/voice/types";
import { toEndRequestReason, type VoiceEndReason, type VoiceMachineLimits, type VoiceNoticeCode } from "../voice-machine";
import { announcedLocale, isEventStream, readFailure, readTurnStream, requestSession, sendEnd } from "./http";
import { speechPlatform } from "./platform";
import { createSpeechQueue, type SpeechEngine } from "./speech-queue";
import { detectReplyLocale, isEcho, pickVoice, takeSentences, toSpeakable, words } from "./speech-text";
import { clamp01, createEmitter, nowMs, type VoiceTransport, type VoiceTransportOptions } from "./types";

/** No byte for this long while a reply streams: the turn has failed (the server pings every 15 s). */
const TURN_IDLE_TIMEOUT_MS = 45_000;
/** Recognition that ends this quickly, this many times in a row, is not working: type instead. */
const QUICK_END_MS = 1_000;
const QUICK_END_LIMIT = 5;
/** Interim speech over the assistant needs this many words to count as an interruption. */
const BARGE_IN_MIN_WORDS = 2;
/** Recognition finalises a moment after the sound stops: an echo can land just after the reply. */
const ECHO_TAIL_MS = 1_500;
/** Without a level meter, the orb pulses this long after recognition heard something. */
const HEARD_PULSE_MS = 700;
/** A reply this long without a clear language is read in the widget's language. */
const LOCALE_SETTLE_WORDS = 12;
/**
 * How long a turn refused with "turn_in_progress" is sent again before the widget gives up: the
 * server's own turn deadline (20 s) plus a margin, since a cut-off turn may run until then.
 */
const TURN_BUSY_MAX_WAIT_MS = 25_000;

/** Pause before sending a refused turn again: the server's Retry-After when it gives one. */
export function busyRetryDelay(retryAfterSeconds: number | undefined, attempt: number): number {
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(5_000, Math.max(250, retryAfterSeconds * 1000));
  }
  return Math.min(2_000, 400 * Math.max(1, attempt));
}

// The parts of the Web Speech API used here. Declared locally: TypeScript's DOM library does not
// cover the prefixed constructor, and the shapes differ slightly between engines.
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult;
}
interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

/** The browser's speech recognition constructor, prefixed or not; null when there is none. */
export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export interface LocalTransportOptions extends VoiceTransportOptions {
  /** "voice": microphone and recognition; "text": the visitor types (chosen in the consent step). */
  input: "voice" | "text";
}

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export function createLocalTransport(options: LocalTransportOptions): VoiceTransport {
  const { config } = options;
  const emitter = createEmitter();
  const emit = emitter.emit;
  const Recognition = recognitionConstructor();
  const synth = hasSpeechSynthesis() ? window.speechSynthesis : null;
  const platform = speechPlatform(typeof navigator !== "undefined" ? navigator : null);

  let locale: VoiceLocale = options.locale;
  let input = options.input;
  let started = false;
  let stopped = false;
  /** Why stop() was called: also the reason given when a late session is handed back. */
  let stopReason: VoiceEndReason = "unload";
  let muted = false;
  let phase: Phase = "idle";
  let token: string | null = null;
  let limits: VoiceMachineLimits = { ...config.limits };

  // Microphone and level meter.
  let micGranted = false;
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let samples: Uint8Array<ArrayBuffer> | null = null;
  /** When recognition last heard the caller (nowMs), for the orb when there is no meter. */
  let heardAt = 0;

  // Recognition.
  let recognition: Recognition | null = null;
  let recognising = false;
  let wantRecognition = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRecognitionStart = 0;
  let quickEnds = 0;
  let utteranceCount = 0;
  let callerCaption: { id: string; text: string } | null = null;

  // Synthesis.
  let voices: SpeechSynthesisVoice[] = [];
  let speakingSince = 0;
  let lastBoundary = 0;

  // The reply being streamed and spoken.
  let turnSeq = 0;
  let turnRequest: AbortController | null = null;
  let replyId = "";
  let replyText = "";
  let sentenceBuffer = "";
  /** The language the reply is read and captioned in (the model answers in the caller's). */
  let replyLocale: VoiceLocale = locale;
  let replyLocaleSettled = false;
  /** What the assistant has said in this reply (the echo filter compares against it). */
  let spokenText = "";
  let replyDone = false;
  /** afterReply() ran for this reply: it must run once, whoever notices the end first. */
  let replyClosed = false;
  /** When the last reply finished speaking (Date.now()), for the echo tail. */
  let replyEndedAt = 0;
  let pendingEnd: VoiceEndReason | null = null;

  const onVoicesChanged = () => {
    if (synth) voices = synth.getVoices();
  };

  /**
   * The language an utterance is read in: the reply's, unless the device has voices but none for
   * it (then the widget's own: a missing language can make an engine fail for good).
   */
  const speechLocale = (): VoiceLocale =>
    replyLocale !== locale && voices.length > 0 && pickVoice(voices, replyLocale) === null ? locale : replyLocale;

  const engine: SpeechEngine | null = synth
    ? {
        speak(text, callbacks) {
          const utterance = new SpeechSynthesisUtterance(text);
          const spoken = speechLocale();
          utterance.lang = VOICE_LANG_TAG[spoken];
          const voice = pickVoice(voices, spoken);
          if (voice) utterance.voice = voice;
          utterance.onstart = () => callbacks.start();
          utterance.onend = () => callbacks.end();
          utterance.onerror = (event: SpeechSynthesisErrorEvent) => callbacks.error(event.error);
          utterance.onboundary = () => callbacks.boundary();
          // Chrome can be left paused by an earlier cancel; speaking into a paused queue is silent.
          if (synth.paused) synth.resume();
          synth.speak(utterance);
        },
        cancel() {
          synth.cancel();
        },
        speaking() {
          return synth.speaking;
        },
      }
    : null;

  const queue = engine
    ? createSpeechQueue({
        engine,
        onStart: handleSpeechStart,
        onBoundary: () => {
          lastBoundary = nowMs();
        },
        onDrained: () => {
          if (replyDone) afterReply();
        },
        onBroken: () => {
          // The conversation goes on in captions.
          if (!stopped) emit({ type: "NOTICE", notice: "no_synthesis" });
        },
      })
    : null;

  const pendingSpeech = () => queue?.pending() ?? 0;

  // ----- Start ---------------------------------------------------------------------------------

  function start(): void {
    if (started || stopped) return;
    started = true;
    unlockAudioOutput();
    if (typeof fetch !== "function" || typeof ReadableStream === "undefined" || typeof TextDecoder === "undefined") {
      emit({ type: "FAIL", code: "unsupported" });
      return;
    }
    if (input === "voice" && Recognition === null) {
      // Firefox and some in-app browsers: no recognition. No reason to ask for the microphone.
      input = "text";
      closeAudio();
      emit({ type: "TYPED" });
      emit({ type: "NOTICE", notice: "recognition_unsupported" });
      emit({ type: "CONNECTING" });
      void connect();
      return;
    }
    if (input === "voice") openMicrophone();
    else void connect();
  }

  /** Runs inside the consent click: the only moment Safari lets a page start audio. */
  function unlockAudioOutput(): void {
    if (synth) {
      onVoicesChanged();
      synth.addEventListener?.("voiceschanged", onVoicesChanged);
      try {
        // An empty utterance spoken inside the gesture unlocks speech for the rest of the page
        // (iOS Safari speaks nothing that was not started by a tap otherwise). No cancel() first:
        // Chrome may drop an utterance queued right after a cancel.
        const unlock = new SpeechSynthesisUtterance(" ");
        unlock.volume = 0;
        synth.speak(unlock);
      } catch {
        // The first real sentence fails the same way and the queue reports it.
      }
    }
    if (input === "voice" && platform.holdsMeterStream) {
      try {
        const Context =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        audioContext = Context ? new Context() : null;
        void audioContext?.resume().catch(() => undefined);
      } catch {
        // No level meter; the conversation works without it.
        audioContext = null;
      }
    }
  }

  function openMicrophone(): void {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media || typeof media.getUserMedia !== "function") {
      // Insecure origin (plain http) or a browser without capture.
      closeAudio();
      emit({ type: "FAIL", code: "unsupported" });
      return;
    }
    media
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(
        (granted) => {
          if (stopped) {
            granted.getTracks().forEach((track) => track.stop());
            return;
          }
          micGranted = true;
          if (platform.holdsMeterStream) {
            stream = granted;
            attachLevelMeter();
          } else {
            // Phones: the stream only served the permission prompt. Recognition opens the
            // microphone itself, and a second capture next to it may leave it deaf.
            granted.getTracks().forEach((track) => track.stop());
          }
          emit({ type: "MIC_GRANTED" });
          void connect();
        },
        (error: unknown) => {
          if (stopped) return;
          closeAudio();
          const name = error instanceof Error || isDomException(error) ? (error as { name: string }).name : "";
          emit({
            type: "MIC_FAILED",
            code: name === "NotAllowedError" || name === "SecurityError" ? "mic_denied" : "mic_unavailable",
          });
        },
      );
  }

  function attachLevelMeter(): void {
    if (!audioContext || !stream) return;
    try {
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      // Not connected to the destination: the visitor must not hear themselves.
      source.connect(analyser);
      samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      analyser = null;
      samples = null;
    }
  }

  async function connect(): Promise<void> {
    phase = "connecting";
    // Not aborted by stop(): see requestSession. The answer decides what has to be handed back.
    const result = await requestSession(config.endpoints.session, {
      tenant: config.tenant,
      locale,
      mode: "local",
      page: options.page,
      hp: options.hp ?? "",
    });
    if (stopped) {
      // The visitor left while the session was being opened. An admitted session holds minutes,
      // spend and a concurrency slot on the server: its token hands it back at once.
      if (result.ok) {
        sendEnd(config.endpoints.end, { sessionToken: result.grant.sessionToken, reason: toEndRequestReason(stopReason) });
      }
      return;
    }
    if (!result.ok) {
      emit({ type: "FAIL", code: result.code, retryAfter: result.retryAfter ?? null });
      return;
    }
    token = result.grant.sessionToken;
    if (result.grant.mode !== "local") {
      // The server offers something else now (e.g. only the example): this transport cannot run it.
      // The token stays, so stop() hands the session back.
      emit({ type: "FAIL", code: "mode_unavailable" });
      return;
    }
    limits = { ...result.grant.limits };
    emit({ type: "CONNECTED", limits: result.grant.limits });
    phase = "listening";
    void runTurn("", true);
  }

  // ----- Turns ---------------------------------------------------------------------------------

  async function runTurn(text: string, opening: boolean): Promise<void> {
    if (stopped || token === null) return;
    turnRequest?.abort();
    const seq = ++turnSeq;
    const request = new AbortController();
    turnRequest = request;
    replyId = `a-${seq}`;
    replyText = "";
    sentenceBuffer = "";
    spokenText = "";
    replyLocale = locale;
    replyLocaleSettled = false;
    replyDone = false;
    replyClosed = false;
    phase = "thinking";
    // One turn at a time: nothing is recognised while the reply is being prepared.
    stopRecognition();
    emit({ type: "THINKING" });

    const body: TurnRequestBody = opening
      ? { sessionToken: token, text: "", locale, opening: true }
      : { sessionToken: token, text, locale };
    let response: Response;
    let busyWaited = 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        response = await fetch(config.endpoints.turn, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: request.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch {
        if (seq !== turnSeq || stopped) return;
        emit({ type: "FAIL", code: isOffline() ? "offline" : "network" });
        return;
      }
      if (seq !== turnSeq || stopped) return;
      if (response.ok && response.body !== null && isEventStream(response)) break;
      const failure = await readFailure(response);
      if (seq !== turnSeq || stopped) return;
      if (failure.code === "turn_in_progress" && busyWaited < TURN_BUSY_MAX_WAIT_MS) {
        // The server runs one turn per session at a time, and the turn a barge-in cut off may
        // still be finishing there. Not the caller's fault and not a reason to end the call:
        // send the same turn again shortly (the widget keeps showing "thinking").
        const delay = busyRetryDelay(failure.retryAfter, attempt);
        busyWaited += delay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (seq !== turnSeq || stopped) return;
        continue;
      }
      emit({ type: "FAIL", code: failure.code, retryAfter: failure.retryAfter ?? null });
      return;
    }
    if (response.body === null) return;

    const outcome = await readTurnStream(
      response.body,
      (event) => {
        if (seq === turnSeq && !stopped) handleStreamEvent(event);
      },
      { signal: request.signal, idleTimeoutMs: TURN_IDLE_TIMEOUT_MS },
    );
    if (seq !== turnSeq || stopped) return;
    if (turnRequest === request) turnRequest = null;
    if (outcome === "idle") emit({ type: "FAIL", code: "timeout" });
    else if (outcome === "network") emit({ type: "FAIL", code: isOffline() ? "offline" : "network" });
    else if (outcome === "eof") emit({ type: "FAIL", code: "upstream" });
  }

  function handleStreamEvent(event: TurnStreamEvent): void {
    switch (event.type) {
      case "start":
        adoptLocale(announcedLocale(event));
        return;
      case "delta":
        replyText += event.text;
        sentenceBuffer += event.text;
        speakSentences(false);
        emitReplyCaption(false);
        return;
      case "tool":
        emit({ type: "TOOL", name: event.name, status: event.status });
        return;
      case "handoff":
        emit({ type: "HANDOFF", handoff: event.handoff });
        return;
      case "done":
        replyDone = true;
        adoptLocale(announcedLocale(event));
        settleReplyLocale(true);
        emitReplyCaption(true);
        emit({ type: "REMAINING", seconds: event.remainingSeconds });
        if (event.ended) pendingEnd = "assistant";
        else if (event.remainingTurns <= 0) pendingEnd = "limit";
        speakSentences(true);
        if (pendingSpeech() === 0) afterReply();
        return;
      case "error":
        replyDone = true;
        cancelSpeech();
        emit({ type: "FAIL", code: event.code, retryAfter: event.retryAfter ?? null });
        return;
    }
  }

  /** The server said which language the reply is in: that beats any guess. */
  function adoptLocale(announced: VoiceLocale | null): void {
    if (announced === null) return;
    replyLocale = announced;
    replyLocaleSettled = true;
  }

  /** Guesses the reply's language from what has streamed so far, once it can tell. */
  function settleReplyLocale(final: boolean): void {
    if (replyLocaleSettled) return;
    const guess = detectReplyLocale(replyText);
    if (guess !== null) {
      replyLocale = guess;
      replyLocaleSettled = true;
    } else if (final || words(replyText).length >= LOCALE_SETTLE_WORDS) {
      replyLocaleSettled = true; // no clear signal: the widget's language
    }
  }

  function emitReplyCaption(final: boolean): void {
    const text = replyText.trim();
    if (!text) return;
    emit({ type: "CAPTION", caption: { id: replyId, role: "assistant", text, final, locale: replyLocale } });
  }

  /** The reply is complete and spoken: the caller's turn, or the end the server asked for. */
  function afterReply(): void {
    if (stopped || replyClosed) return;
    replyClosed = true;
    if (pendingEnd !== null) {
      emit({ type: "END", reason: pendingEnd });
      return;
    }
    phase = "listening";
    replyEndedAt = Date.now();
    emit({ type: "LISTENING" });
    if (input === "voice") startRecognition();
  }

  // ----- Synthesis -----------------------------------------------------------------------------

  function speakSentences(final: boolean): void {
    const { sentences, rest } = takeSentences(sentenceBuffer, final);
    sentenceBuffer = rest;
    if (sentences.length > 0) settleReplyLocale(final);
    for (const sentence of sentences) speak(sentence);
  }

  function speak(sentence: string): void {
    const text = toSpeakable(sentence);
    if (!text) return;
    spokenText = `${spokenText} ${text}`;
    if (queue?.works()) queue.speak(text);
  }

  /** The first sentence of a reply started to play. */
  function handleSpeechStart(): void {
    if (stopped || phase !== "thinking") return;
    phase = "speaking";
    speakingSince = nowMs();
    emit({ type: "SPEAKING" });
    // Listening on while speaking is what makes interrupting possible (not on phones).
    if (input === "voice" && platform.listensWhileSpeaking) startRecognition();
  }

  function cancelSpeech(): void {
    queue?.cancel();
  }

  /** The caller spoke over the assistant: stop talking, drop the rest of the reply, listen. */
  function bargeIn(): boolean {
    if (pendingEnd !== null) return false; // the server already closed the session
    cancelSpeech();
    if (!replyDone) {
      turnSeq += 1; // the rest of this reply's stream is ignored
      turnRequest?.abort();
      turnRequest = null;
      replyDone = true;
    }
    replyClosed = true;
    emitReplyCaption(true);
    phase = "listening";
    emit({ type: "INTERRUPT" });
    return true;
  }

  // ----- Recognition ---------------------------------------------------------------------------

  function ensureRecognition(): Recognition | null {
    if (recognition || !Recognition) return recognition;
    try {
      recognition = new Recognition();
    } catch {
      return null;
    }
    recognition.lang = VOICE_LANG_TAG[locale];
    // One utterance per session, restarted on end: continuous mode is unreliable on Safari and
    // Android, and a fresh session per turn keeps a stuck engine from blocking the call.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = handleResult;
    recognition.onerror = handleRecognitionError;
    recognition.onend = handleRecognitionEnd;
    return recognition;
  }

  function startRecognition(): void {
    wantRecognition = true;
    if (stopped || muted || input !== "voice" || recognising) return;
    const recogniser = ensureRecognition();
    if (!recogniser) {
      fallBackToTyping("recognition_unavailable");
      return;
    }
    try {
      recogniser.lang = VOICE_LANG_TAG[locale];
      recogniser.start();
      recognising = true;
      lastRecognitionStart = Date.now();
    } catch {
      // InvalidStateError: still running from before; its end restarts it.
      recognising = true;
    }
  }

  function stopRecognition(): void {
    wantRecognition = false;
    clearTimeout(restartTimer);
    if (recognition && recognising) {
      try {
        recognition.abort();
      } catch {
        recognising = false;
      }
    }
  }

  function handleRecognitionEnd(): void {
    recognising = false;
    if (stopped || !wantRecognition || muted || input !== "voice") return;
    quickEnds = Date.now() - lastRecognitionStart < QUICK_END_MS ? quickEnds + 1 : 0;
    if (quickEnds >= QUICK_END_LIMIT) {
      // Ends as soon as it starts, again and again (permission revoked, engine broken).
      fallBackToTyping("recognition_unavailable");
      return;
    }
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startRecognition, quickEnds > 0 ? 400 : 100);
  }

  function handleResult(event: RecognitionResultEvent): void {
    if (stopped || input !== "voice" || muted) return;
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript ?? "";
      if (result?.isFinal) finalText += transcript;
      else interimText += transcript;
    }
    const heard = (finalText || interimText).replace(/\s+/g, " ").trim();
    if (!heard) return;

    if (phase === "speaking") {
      // Our own voice coming back through the speakers is not an interruption.
      if (isEcho(heard, spokenText)) return;
      if (!finalText && words(heard).length < BARGE_IN_MIN_WORDS) return;
      if (!bargeIn()) return;
    } else if (phase === "listening" && callerCaption === null && Date.now() - replyEndedAt < ECHO_TAIL_MS) {
      // The recogniser finishing the reply's last words after it stopped: still not the caller.
      if (isEcho(heard, spokenText)) return;
    }
    if (phase !== "listening") return; // a straggler while the reply is prepared

    heardAt = nowMs();
    emit({ type: "ACTIVITY" });
    if (callerCaption === null) {
      utteranceCount += 1;
      callerCaption = { id: `c-${utteranceCount}`, text: "" };
    }
    callerCaption.text = heard.slice(0, limits.maxTurnChars);
    const final = finalText !== "";
    emit({ type: "CAPTION", caption: { id: callerCaption.id, role: "caller", text: callerCaption.text, final, locale } });
    if (final) {
      const text = callerCaption.text;
      callerCaption = null;
      void runTurn(text, false);
    }
  }

  function handleRecognitionError(event: RecognitionErrorEvent): void {
    if (stopped) return;
    switch (event.error) {
      case "no-speech":
        // Silence is not a failure: the hint stays until the caller speaks; the end handler
        // restarts recognition and the silence limit ends a conversation nobody is in. Only
        // while it is the caller's turn: silence over the assistant's voice is expected.
        if (phase === "listening") emit({ type: "NOTICE", notice: "no_speech" });
        return;
      case "aborted":
        return; // our own abort()
      case "audio-capture":
        fallBackToTyping("audio_capture");
        return;
      case "network":
        // Chrome sends the audio to its vendor's service; that service is unreachable.
        fallBackToTyping("recognition_network");
        return;
      case "not-allowed":
        // The visitor did allow the microphone (getUserMedia): it is recognition that is refused.
        if (micGranted) fallBackToTyping("recognition_unavailable");
        else emit({ type: "FAIL", code: "mic_denied" });
        return;
      case "service-not-allowed":
      case "language-not-supported":
        // Dictation switched off (Safari), or no model for this language.
        fallBackToTyping("recognition_unavailable");
        return;
      default:
        return;
    }
  }

  function fallBackToTyping(notice: VoiceNoticeCode): void {
    if (input === "text") return;
    input = "text";
    stopRecognition();
    // Without recognition the microphone has no use: switch it off (the browser's indicator too).
    closeAudio();
    if (callerCaption) {
      emit({ type: "CAPTION", caption: { id: callerCaption.id, role: "caller", text: callerCaption.text, final: true, locale } });
      callerCaption = null;
    }
    emit({ type: "TYPED" });
    emit({ type: "NOTICE", notice });
  }

  // ----- Cleanup -------------------------------------------------------------------------------

  function closeAudio(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    analyser = null;
    samples = null;
    const context = audioContext;
    audioContext = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }

  function synthLevel(now: number): number {
    // speechSynthesis cannot be measured (it does not pass through Web Audio): a speaking rhythm
    // instead, with a small lift on every word boundary the engine reports.
    const seconds = (now - speakingSince) / 1000;
    const rhythm = 0.5 + 0.22 * Math.sin(2 * Math.PI * 3.3 * seconds) * Math.sin(2 * Math.PI * 0.8 * seconds + 1.2);
    const sinceWord = now - lastBoundary;
    const lift = sinceWord < 220 ? 0.22 * (1 - sinceWord / 220) : 0;
    return clamp01(rhythm + lift);
  }

  /** No meter (phones, or no AudioContext): a short pulse each time recognition hears the caller. */
  function heardLevel(now: number): number {
    const since = now - heardAt;
    if (heardAt === 0 || since < 0 || since > HEARD_PULSE_MS) return 0;
    const syllable = 0.62 + 0.38 * Math.sin(2 * Math.PI * 4.2 * (now / 1000));
    return clamp01(0.7 * (1 - since / HEARD_PULSE_MS) * syllable);
  }

  return {
    mode: "local",
    start,
    stop(reason: VoiceEndReason) {
      if (stopped) return;
      stopped = true;
      stopReason = reason;
      clearTimeout(restartTimer);
      turnSeq += 1;
      turnRequest?.abort();
      turnRequest = null;
      stopRecognition();
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
      }
      cancelSpeech();
      synth?.removeEventListener?.("voiceschanged", onVoicesChanged);
      closeAudio();
      emitter.clear();
      // A session request still on its way is left to finish: connect() hands that session back.
      if (token !== null) sendEnd(config.endpoints.end, { sessionToken: token, reason: toEndRequestReason(reason) });
      token = null;
    },
    setMuted(next: boolean) {
      if (stopped || muted === next) return;
      muted = next;
      stream?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      if (next) {
        stopRecognition();
        if (callerCaption) {
          emit({ type: "CAPTION", caption: { id: callerCaption.id, role: "caller", text: callerCaption.text, final: true, locale } });
          callerCaption = null;
        }
      } else if (phase === "listening" || (phase === "speaking" && platform.listensWhileSpeaking)) {
        startRecognition();
      }
    },
    sendText(text: string) {
      const clean = text.replace(/\s+/g, " ").trim().slice(0, limits.maxTurnChars);
      if (!clean || stopped || token === null) return false;
      if (phase !== "listening" && phase !== "speaking") return false;
      if (phase === "speaking" && !bargeIn()) return false;
      if (callerCaption) {
        // Half-recognised speech next to a typed message: keep what was heard, as it was.
        emit({ type: "CAPTION", caption: { id: callerCaption.id, role: "caller", text: callerCaption.text, final: true, locale } });
        callerCaption = null;
      }
      utteranceCount += 1;
      emit({ type: "ACTIVITY" });
      emit({ type: "CAPTION", caption: { id: `t-${utteranceCount}`, role: "caller", text: clean, final: true, locale } });
      void runTurn(clean, false);
      return true;
    },
    setLocale(next: VoiceLocale) {
      if (next === locale) return;
      locale = next;
      if (recognition) {
        recognition.lang = VOICE_LANG_TAG[next];
        // Running in the old language: abort; the end handler restarts it in the new one.
        if (recognising) {
          try {
            recognition.abort();
          } catch {
            // Already ending.
          }
        }
      }
    },
    onEvent(listener) {
      return emitter.on(listener);
    },
    getLevel() {
      if (stopped) return 0;
      const now = nowMs();
      if (phase === "speaking") return synthLevel(now);
      if (muted || input !== "voice") return 0;
      if (!analyser || !samples) return heardLevel(now);
      try {
        analyser.getByteTimeDomainData(samples);
      } catch {
        return 0;
      }
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const centred = (samples[index] - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);
      // Room noise sits around 0.01-0.02 RMS; normal speech close to a laptop mic 0.05-0.2.
      return clamp01((rms - 0.015) * 7);
    },
  };
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isDomException(value: unknown): boolean {
  return typeof DOMException !== "undefined" && value instanceof DOMException;
}
