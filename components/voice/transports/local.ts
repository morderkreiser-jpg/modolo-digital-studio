// Mode "local": a development and test harness. The browser's own SpeechRecognition turns the
// caller's speech into text, the turn endpoint answers as a stream of events, and speechSynthesis
// reads the reply aloud sentence by sentence while it is still streaming. Free, but not the
// product's voice quality, and recognition may run on the browser vendor's servers (the consent
// step says so).
//
// Order of a start, all after the visitor's consent click:
//   unlock synthesis + create the AudioContext (inside the click: Safari needs the gesture)
//   → getUserMedia (the permission prompt; the stream feeds the orb's level meter)
//   → POST session → CONNECTED → opening turn (the greeting) → listening ⇄ thinking ⇄ speaking
// Typed input skips the microphone entirely. Without SpeechRecognition (Firefox) the transport
// falls back to typed input by itself and says so.
//
// Barge-in: recognition keeps running while the assistant speaks; speech that is not an echo of
// the assistant's own words cancels the synthesis and the rest of the streamed reply.
import { VOICE_LANG_TAG, type TurnRequestBody, type TurnStreamEvent, type VoiceLocale } from "@/lib/voice/types";
import { toEndRequestReason, type VoiceEndReason, type VoiceMachineLimits, type VoiceNoticeCode } from "../voice-machine";
import { isEventStream, readFailure, readTurnStream, requestSession, sendEnd } from "./http";
import { isEcho, pickVoice, takeSentences, toSpeakable, words } from "./speech-text";
import { clamp01, createEmitter, nowMs, type VoiceTransport, type VoiceTransportOptions } from "./types";

/** No byte for this long while a reply streams: the turn has failed (the server pings every 15 s). */
const TURN_IDLE_TIMEOUT_MS = 45_000;
/** Recognition that ends this quickly, this many times in a row, is not working: type instead. */
const QUICK_END_MS = 1_000;
const QUICK_END_LIMIT = 5;
/** An utterance that neither ends nor fails within its length at this pace plus a margin is stuck. */
const SAFETY_CHARS_PER_SECOND = 9;
const SAFETY_MARGIN_MS = 4_000;
/** Interim speech over the assistant needs this many words to count as an interruption. */
const BARGE_IN_MIN_WORDS = 2;
/** Recognition finalises a moment after the sound stops: an echo can land just after the reply. */
const ECHO_TAIL_MS = 1_500;

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

  let locale: VoiceLocale = options.locale;
  let input = options.input;
  let started = false;
  let stopped = false;
  let muted = false;
  let phase: Phase = "idle";
  let token: string | null = null;
  let limits: VoiceMachineLimits = { ...config.limits };
  const sessionRequest = new AbortController();

  // Microphone and level meter.
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let samples: Uint8Array<ArrayBuffer> | null = null;

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
  let synthesisWorks = synth !== null;
  let speechGeneration = 0;
  let pendingUtterances = 0;
  let speakingSince = 0;
  let lastBoundary = 0;
  const safetyTimers = new Set<ReturnType<typeof setTimeout>>();

  // The reply being streamed and spoken.
  let turnSeq = 0;
  let turnRequest: AbortController | null = null;
  let replyId = "";
  let replyText = "";
  let sentenceBuffer = "";
  /** What the assistant has said in this reply (the echo filter compares against it). */
  let spokenText = "";
  let replyDone = false;
  /** When the last reply finished speaking (Date.now()), for the echo tail. */
  let replyEndedAt = 0;
  let pendingEnd: VoiceEndReason | null = null;

  const onVoicesChanged = () => {
    if (synth) voices = synth.getVoices();
  };

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
        synthesisWorks = false;
      }
    }
    if (input === "voice") {
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
          stream = granted;
          attachLevelMeter();
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
    const result = await requestSession(
      config.endpoints.session,
      { tenant: config.tenant, locale, mode: "local", page: options.page, hp: options.hp ?? "" },
      sessionRequest.signal,
    );
    if (result.ok && stopped) {
      // The visitor left while the session was being opened: hand it back at once.
      sendEnd(config.endpoints.end, { sessionToken: result.grant.sessionToken, reason: "unload" });
      return;
    }
    if (stopped) return;
    if (!result.ok) {
      emit({ type: "FAIL", code: result.code, retryAfter: result.retryAfter ?? null });
      return;
    }
    token = result.grant.sessionToken;
    if (result.grant.mode !== "local") {
      // The server offers something else now (e.g. only the example): this transport cannot run it.
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
    replyDone = false;
    phase = "thinking";
    // One turn at a time: nothing is recognised while the reply is being prepared.
    stopRecognition();
    emit({ type: "THINKING" });

    const body: TurnRequestBody = opening
      ? { sessionToken: token, text: "", locale, opening: true }
      : { sessionToken: token, text, locale };
    let response: Response;
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
      emit({ type: "FAIL", code: navigator.onLine === false ? "offline" : "network" });
      return;
    }
    if (seq !== turnSeq || stopped) return;
    if (!response.ok || response.body === null || !isEventStream(response)) {
      const failure = await readFailure(response);
      if (seq !== turnSeq || stopped) return;
      emit({ type: "FAIL", code: failure.code, retryAfter: failure.retryAfter ?? null });
      return;
    }

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
    else if (outcome === "network") emit({ type: "FAIL", code: navigator.onLine === false ? "offline" : "network" });
    else if (outcome === "eof") emit({ type: "FAIL", code: "upstream" });
  }

  function handleStreamEvent(event: TurnStreamEvent): void {
    switch (event.type) {
      case "start":
        return;
      case "delta":
        replyText += event.text;
        sentenceBuffer += event.text;
        emitReplyCaption(false);
        speakSentences(false);
        return;
      case "tool":
        emit({ type: "TOOL", name: event.name, status: event.status });
        return;
      case "handoff":
        emit({ type: "HANDOFF", handoff: event.handoff });
        return;
      case "done":
        replyDone = true;
        emitReplyCaption(true);
        emit({ type: "REMAINING", seconds: event.remainingSeconds });
        if (event.ended) pendingEnd = "assistant";
        else if (event.remainingTurns <= 0) pendingEnd = "limit";
        speakSentences(true);
        if (pendingUtterances === 0) afterReply();
        return;
      case "error":
        replyDone = true;
        cancelSpeech();
        emit({ type: "FAIL", code: event.code, retryAfter: event.retryAfter ?? null });
        return;
    }
  }

  function emitReplyCaption(final: boolean): void {
    const text = replyText.trim();
    if (!text) return;
    emit({ type: "CAPTION", caption: { id: replyId, role: "assistant", text, final, locale } });
  }

  /** The reply is complete and spoken: the caller's turn, or the end the server asked for. */
  function afterReply(): void {
    if (stopped) return;
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
    for (const sentence of sentences) speak(sentence);
  }

  function speak(sentence: string): void {
    const text = toSpeakable(sentence);
    if (!text) return;
    spokenText = `${spokenText} ${text}`;
    if (!synth || !synthesisWorks) return;
    const generation = speechGeneration;
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new SpeechSynthesisUtterance(text);
    } catch {
      disableSynthesis();
      return;
    }
    utterance.lang = VOICE_LANG_TAG[locale];
    const voice = pickVoice(voices, locale);
    if (voice) utterance.voice = voice;

    let begun = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      safetyTimers.delete(safety);
      if (generation !== speechGeneration || stopped) return;
      pendingUtterances = Math.max(0, pendingUtterances - 1);
      if (pendingUtterances === 0 && replyDone) afterReply();
    };
    // Some engines never fire end or error (no voice installed, audio device gone). The reply
    // must not hang there: after a generous estimate the utterance counts as done.
    const safety = setTimeout(() => {
      if (!begun) disableSynthesis();
      finish();
    }, (text.length / SAFETY_CHARS_PER_SECOND) * 1000 + SAFETY_MARGIN_MS);
    safetyTimers.add(safety);

    utterance.onstart = () => {
      begun = true;
      if (generation !== speechGeneration || stopped) return;
      if (phase !== "speaking") {
        phase = "speaking";
        speakingSince = nowMs();
        emit({ type: "SPEAKING" });
        // Listening on while speaking is what makes interrupting possible.
        if (input === "voice") startRecognition();
      }
    };
    utterance.onboundary = () => {
      lastBoundary = nowMs();
    };
    utterance.onend = finish;
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      // "interrupted" and "canceled" are ours (barge-in, stop); the others mean no voice output.
      if (event.error !== "interrupted" && event.error !== "canceled") disableSynthesis();
      finish();
    };
    pendingUtterances += 1;
    try {
      // Chrome can be left paused by an earlier cancel; speaking into a paused queue is silent.
      if (synth.paused) synth.resume();
      synth.speak(utterance);
    } catch {
      disableSynthesis();
      finish();
    }
  }

  function disableSynthesis(): void {
    if (!synthesisWorks) return;
    synthesisWorks = false;
    // The conversation goes on in captions.
    emit({ type: "NOTICE", notice: "no_synthesis" });
  }

  function cancelSpeech(): void {
    speechGeneration += 1;
    pendingUtterances = 0;
    for (const timer of safetyTimers) clearTimeout(timer);
    safetyTimers.clear();
    try {
      synth?.cancel();
    } catch {
      // Nothing to cancel.
    }
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
    const engine = ensureRecognition();
    if (!engine) {
      fallBackToTyping("recognition_unavailable");
      return;
    }
    try {
      engine.lang = VOICE_LANG_TAG[locale];
      engine.start();
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
        if (stream) fallBackToTyping("recognition_unavailable");
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

  return {
    mode: "local",
    start,
    stop(reason: VoiceEndReason) {
      if (stopped) return;
      stopped = true;
      clearTimeout(restartTimer);
      sessionRequest.abort();
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
      } else if (phase === "listening" || phase === "speaking") {
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
      if (muted || !analyser || !samples) return 0;
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

function isDomException(value: unknown): boolean {
  return typeof DOMException !== "undefined" && value instanceof DOMException;
}
