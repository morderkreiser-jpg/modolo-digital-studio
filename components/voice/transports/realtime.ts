// Mode "realtime": the caller's voice goes over WebRTC straight to the voice provider, and our
// server creates and supervises the call. The browser never holds a provider credential.
//
//   start() (inside the consent click) → audio context and <audio> unlocked in the gesture
//   → getUserMedia (before any session, so a refused microphone costs the visitor nothing); the
//     microphone track is held disabled until the greeting speaks
//   → POST endpoints.session (mode "realtime")      → a "call" grant
//   → peer connection with the microphone track, NO data channel, offer
//   → POST endpoints.call {sessionToken, sdp}       → an event stream (CallStreamEvent):
//     the answer SDP first, then turns, captions, tools, the time left, and how the call ended
//   → connected: CONNECTED, THINKING; POST endpoints.ready once the answer audio plays.
//
// The server drives the conversation (turn detection, greeting, tools, the end); this side only
// plays the audio, passes the stream's events on as machine events, watches the connection and
// the microphone, and hands the session back to the end endpoint exactly once. Every browser
// object comes from the injected RealtimePlatform (webrtc.ts). No transcript is stored or logged.
import type { CallStreamEvent, SessionGrant } from "@/lib/voice/types";
import { toEndRequestReason, type VoiceEndReason, type VoiceNoticeCode, type VoiceTransportEvent } from "../voice-machine";
import { openCall, readCallStream, requestSession, sendEnd, sendReady, type StreamOutcome } from "./http";
import { createEmitter, nowMs, type VoiceTransport, type VoiceTransportOptions } from "./types";
import { browserPlatform, createLevelMeter, isInAppBrowser, supportsRealtime, type RealtimePlatform } from "./webrtc";

/** Answer applied → connected, or the call could not be made. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** A connection "disconnected" for this long is lost. */
export const DISCONNECT_GRACE_MS = 8_000;
/** The server pings every 15 s: three missed pings and the stream is dead. */
export const CALL_STREAM_IDLE_MS = 45_000;
/** The microphone opens at the greeting's first audio, or this long after CONNECTED at the latest. */
export const MIC_HOLD_MAX_MS = 6_000;
/** While the caller speaks, ACTIVITY is repeated this often (the widget counts no silence then)... */
export const SPEECH_ACTIVITY_MS = 1_000;
/** ...but never longer than this without a word from the server. */
export const SPEECH_ACTIVITY_MAX_MS = 60_000;
/** After the goodbye, the remote audio must have been quiet this long before the call is closed... */
export const CLOSE_QUIET_MS = 300;
/** ...or this long has passed. */
export const CLOSE_MAX_MS = 1_500;
/** Hidden this long with the microphone interrupted (a locked phone, a phone call): the call ends. */
export const HIDDEN_END_MS = 15_000;
/** Muted this long: the visitor is told the call will end soon (the server's backstop). */
export const MUTED_NOTICE_MS = 60_000;
/** How often the deferred close reads the remote meter. */
const CLOSE_POLL_MS = 50;
/** The remote meter reads 0 this long while the assistant speaks: the orb pulses on its own. */
const REMOTE_SILENT_FALLBACK_MS = 1_000;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

type Phase = "idle" | "mic" | "session" | "offer" | "call" | "connecting" | "live" | "closing" | "closed";
type Turn = "listening" | "thinking" | "speaking";
type Timer = ReturnType<typeof setTimeout>;

export function createRealtimeTransport(
  options: VoiceTransportOptions,
  platform: RealtimePlatform = browserPlatform(),
): VoiceTransport {
  const { config } = options;
  const emitter = createEmitter();
  const now = platform.now ?? nowMs;

  let phase: Phase = "idle";
  let started = false;
  let stopped = false;
  /** A terminal event (END or FAIL) went out: the widget hears nothing more from this call. */
  let finished = false;
  /** Why stop() was called: also the reason given when a late session is handed back. */
  let stopReason: VoiceEndReason = "unload";
  let token: string | null = null;
  let limits: SessionGrant["limits"] | null = null;

  let context: AudioContext | null = null;
  let audio: HTMLAudioElement | null = null;
  let micStream: MediaStream | null = null;
  let micTrack: MediaStreamTrack | null = null;
  let remoteStream: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let call: AbortController | null = null;
  let micMeter: { level(): number; close(): void } | null = null;
  let remoteMeter: { level(): number; close(): void } | null = null;

  let answered = false;
  let maxSeconds = 0;
  let connected = false;
  let playing = false;
  let readySent = false;
  let turn: Turn = "thinking";
  /** The greeting (the first SPEAKING once connected) opened the microphone. */
  let holdReleased = false;
  /** What the visitor wants; applied to the track only once the hold is released. */
  let muted = false;
  let remoteSilentSince: number | null = null;
  /** The remote meter has read above zero at least once: its quiet can be trusted. */
  let remoteHeard = false;

  // Notices, highest first: audio_blocked, mic_paused, connection_weak, mic_off_long.
  let audioBlocked = false;
  let micPaused = false;
  let connectionWeak = false;
  let micOffLong = false;
  let shownNotice: VoiceNoticeCode | null = null;

  let hiddenAt: number | null = null;
  let mutedWhileHidden = false;

  let connectTimer: Timer | undefined;
  let holdTimer: Timer | undefined;
  let disconnectTimer: Timer | undefined;
  let mutedTimer: Timer | undefined;
  let activityTimer: ReturnType<typeof setInterval> | undefined;
  let activityMaxTimer: Timer | undefined;
  let closePoll: ReturnType<typeof setInterval> | undefined;
  let closeMaxTimer: Timer | undefined;
  let stopGestures: (() => void) | null = null;
  let stopVisibility: (() => void) | null = null;
  const trackListeners: Array<[string, () => void]> = [];

  function emit(event: VoiceTransportEvent): void {
    if (stopped || finished) return;
    if (event.type === "END" || event.type === "FAIL") finished = true;
    emitter.emit(event);
  }

  function fail(code: Extract<VoiceTransportEvent, { type: "FAIL" }>["code"], retryAfter?: number): void {
    if (stopped || finished) return;
    emit({ type: "FAIL", code, retryAfter: retryAfter ?? null });
    teardown();
  }

  // ----- Notices ---------------------------------------------------------------------------------

  function updateNotice(): void {
    const next: VoiceNoticeCode | null = audioBlocked
      ? "audio_blocked"
      : micPaused
        ? "mic_paused"
        : connectionWeak
          ? "connection_weak"
          : micOffLong
            ? "mic_off_long"
            : null;
    if (next === shownNotice) return;
    shownNotice = next;
    emit({ type: "NOTICE", notice: next });
  }

  // ----- Microphone ------------------------------------------------------------------------------

  function openMicrophone(): void {
    phase = "mic";
    let request: Promise<MediaStream>;
    try {
      request = platform.getUserMedia!(MIC_CONSTRAINTS);
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      (granted) => {
        if (stopped || finished) {
          stopTracks(granted);
          return;
        }
        const track = granted.getAudioTracks()[0] ?? null;
        if (!track) {
          stopTracks(granted);
          micFailed("mic_unavailable");
          return;
        }
        micStream = granted;
        micTrack = track;
        // The hold: nothing reaches the provider's turn detection before the greeting.
        track.enabled = false;
        listenOnTrack(track, "ended", () => fail("mic_unavailable"));
        listenOnTrack(track, "mute", () => {
          micPaused = true;
          if (hiddenAt !== null) mutedWhileHidden = true;
          updateNotice();
        });
        listenOnTrack(track, "unmute", () => {
          micPaused = false;
          updateNotice();
        });
        micMeter = createLevelMeter(context, granted);
        emit({ type: "MIC_GRANTED" });
        phase = "session";
        void connect();
      },
      (error: unknown) => {
        if (stopped || finished) return;
        const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
        micFailed(name === "NotAllowedError" || name === "SecurityError" ? "mic_denied" : "mic_unavailable");
      },
    );
  }

  function micFailed(code: "mic_denied" | "mic_unavailable"): void {
    // Some in-app browsers refuse capture although the visitor allowed it: say what helps.
    emit({ type: "MIC_FAILED", code: isInAppBrowser(platform.userAgent) ? "in_app_browser" : code });
    teardown();
  }

  function listenOnTrack(track: MediaStreamTrack, type: string, listener: () => void): void {
    const guarded = () => {
      if (!stopped && !finished) listener();
    };
    try {
      track.addEventListener(type, guarded);
      trackListeners.push([type, guarded]);
    } catch {
      // A track without events: the call still works, only these hints are missing.
    }
  }

  function releaseHold(): void {
    if (holdReleased || !micTrack) return;
    holdReleased = true;
    clearTimeout(holdTimer);
    if (phase !== "closing" && phase !== "closed") micTrack.enabled = !muted;
  }

  // ----- Session and call ------------------------------------------------------------------------

  async function connect(): Promise<void> {
    // Not aborted by stop(): an admitted session must be handed back with the token in the answer
    // (see requestSession in http.ts).
    const result = await requestSession(config.endpoints.session, {
      tenant: config.tenant,
      locale: options.locale,
      mode: "realtime",
      page: options.page,
      hp: options.hp ?? "",
    });
    if (stopped) {
      if (result.ok) {
        sendEnd(config.endpoints.end, { sessionToken: result.grant.sessionToken, reason: toEndRequestReason(stopReason) });
      }
      return;
    }
    if (!result.ok) {
      fail(result.code, result.retryAfter);
      return;
    }
    token = result.grant.sessionToken;
    if (finished) return; // the microphone track ended meanwhile: stop() hands the session back
    limits = result.grant.limits;
    if (result.grant.mode !== "realtime") {
      fail("mode_unavailable");
      return;
    }
    if (result.grant.realtime?.connect !== "call") {
      // A provider whose own browser SDK would connect (the mock's token grant): not built.
      // The failure makes the stage stop this transport, and stop() hands the session back.
      fail("not_available_yet");
      return;
    }
    await placeCall(token);
  }

  async function placeCall(sessionToken: string): Promise<void> {
    const callEndpoint = config.endpoints.call;
    if (!callEndpoint || !micTrack || !micStream) {
      fail("mode_unavailable");
      return;
    }
    phase = "offer";
    let sdp: string;
    try {
      pc = platform.createPeerConnection!();
      pc.addTrack(micTrack, micStream);
      pc.ontrack = onTrack;
      pc.addEventListener("connectionstatechange", onConnectionState);
      pc.addEventListener("iceconnectionstatechange", onConnectionState);
      const offer = await pc.createOffer();
      if (stopped || finished) return;
      await pc.setLocalDescription(offer);
      if (stopped || finished) return;
      sdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
    } catch {
      fail("connection_failed");
      return;
    }
    if (!sdp) {
      fail("connection_failed");
      return;
    }
    // Sent at once, without waiting for ICE gathering: the answer side copes with an offer
    // without candidates.
    phase = "call";
    call = new AbortController();
    const opened = await openCall(callEndpoint, { sessionToken, sdp }, call.signal);
    if (stopped || finished) return;
    if (!opened.ok) {
      fail(opened.code, opened.retryAfter);
      return;
    }
    const outcome = await readCallStream(opened.body, onStreamEvent, {
      signal: call.signal,
      idleTimeoutMs: CALL_STREAM_IDLE_MS,
    });
    onStreamEnd(outcome);
  }

  function onStreamEnd(outcome: StreamOutcome): void {
    if (stopped || finished || outcome === "aborted" || outcome === "done" || outcome === "error") return;
    // The stream died without saying how the call ended (eof, network, idle).
    fail(answered ? "connection_lost" : "upstream");
  }

  function onStreamEvent(event: CallStreamEvent): void {
    if (stopped || finished) return;
    switch (event.type) {
      case "answer":
        if (answered) return;
        answered = true;
        maxSeconds = event.maxSeconds;
        phase = "connecting";
        connectTimer = setTimeout(() => {
          if (!connected) fail("connection_failed");
        }, CONNECT_TIMEOUT_MS);
        applyAnswer(event.sdp);
        return;
      case "status":
        // No stopActivity() here: a barge-in brings "listening" while the caller still speaks, and
        // their silence must not be counted until the server hears them stop.
        turn = event.status;
        if (event.status === "listening") emit({ type: "LISTENING" });
        else if (event.status === "thinking") emit({ type: "THINKING" });
        else {
          // The greeting's first audio (once the visitor can hear it) opens the microphone.
          if (connected) releaseHold();
          emit({ type: "SPEAKING" });
        }
        return;
      case "interrupted":
        turn = "listening";
        emit({ type: "INTERRUPT" });
        return;
      case "activity":
        if (event.speech === "started") startActivity();
        else {
          stopActivity();
          emit({ type: "ACTIVITY" });
        }
        return;
      case "caption":
        emit({
          type: "CAPTION",
          caption: {
            id: event.id,
            role: event.role,
            text: event.text,
            final: event.final,
            locale: event.locale ?? options.locale,
          },
          ...(event.before !== undefined ? { before: event.before } : {}),
        });
        return;
      case "tool":
        emit({ type: "TOOL", name: event.name, status: event.status });
        return;
      case "handoff":
        emit({ type: "HANDOFF", handoff: event.handoff });
        return;
      case "remaining":
        emit({ type: "REMAINING", seconds: event.seconds });
        return;
      case "ended":
        emit({ type: "END", reason: event.reason });
        // The goodbye may still be playing: let it finish before the line goes dead.
        if (event.reason === "assistant" || event.reason === "limit") startClosing();
        else teardown();
        return;
      case "error":
        fail(event.code, event.retryAfter);
        return;
    }
  }

  function applyAnswer(sdp: string): void {
    const connection = pc;
    if (!connection) return;
    let applied: Promise<void>;
    try {
      applied = connection.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      applied = Promise.reject(error);
    }
    applied.then(
      () => undefined,
      () => fail("connection_failed"),
    );
  }

  // ----- Peer connection -------------------------------------------------------------------------

  /** connectionState where the browser has it, else what ICE says. */
  function peerState(): "connected" | "disconnected" | "failed" | "other" {
    if (!pc) return "other";
    const state = (pc as { connectionState?: unknown }).connectionState;
    if (typeof state === "string") {
      return state === "connected" || state === "disconnected" || state === "failed" ? state : "other";
    }
    const ice = pc.iceConnectionState;
    if (ice === "connected" || ice === "completed") return "connected";
    return ice === "disconnected" || ice === "failed" ? ice : "other";
  }

  function onConnectionState(): void {
    if (stopped || finished) return;
    const state = peerState();
    if (state === "connected") {
      if (connectionWeak) {
        connectionWeak = false;
        clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
        updateNotice();
      }
      if (connected) return;
      connected = true;
      phase = "live";
      clearTimeout(connectTimer);
      emit({ type: "CONNECTED", limits: { ...(limits ?? {}), maxCallSeconds: maxSeconds } });
      // The last status the server sent; before any, it greets now: "thinking", not "listening",
      // until the greeting speaks. CONNECTED itself already means "listening".
      if (turn === "thinking") emit({ type: "THINKING" });
      else if (turn === "speaking") emit({ type: "SPEAKING" });
      holdTimer = setTimeout(releaseHold, MIC_HOLD_MAX_MS);
      // The greeting already speaks (it started before the connection): the caller may answer.
      if (turn === "speaking") releaseHold();
      maybeSendReady();
    } else if (state === "failed") {
      fail(connected ? "connection_lost" : "connection_failed");
    } else if (state === "disconnected" && connected) {
      if (disconnectTimer !== undefined) return;
      connectionWeak = true;
      updateNotice();
      disconnectTimer = setTimeout(() => fail("connection_lost"), DISCONNECT_GRACE_MS);
    }
  }

  function onTrack(event: RTCTrackEvent): void {
    if (stopped || finished || !audio) return;
    const stream =
      event.streams?.[0] ?? (typeof MediaStream === "function" && event.track ? new MediaStream([event.track]) : null);
    if (!stream) return;
    remoteStream = stream;
    try {
      audio.srcObject = stream;
    } catch {
      // Too old for srcObject: play() fails below and says so.
    }
    remoteMeter?.close();
    remoteMeter = createLevelMeter(context, stream);
    play();
  }

  // ----- Playback --------------------------------------------------------------------------------

  function play(): void {
    if (!audio || !remoteStream) return;
    let attempt: Promise<void>;
    try {
      attempt = Promise.resolve(audio.play());
    } catch (error) {
      attempt = Promise.reject(error);
    }
    attempt.then(
      () => {
        if (stopped || finished) return;
        playing = true;
        stopGestures?.();
        stopGestures = null;
        if (audioBlocked) {
          audioBlocked = false;
          updateNotice();
        }
        maybeSendReady();
      },
      () => {
        if (stopped || finished || playing) return;
        audioBlocked = true;
        updateNotice();
        // Any later tap or key press on the page tries again, until it works.
        if (!stopGestures && platform.addGestureListener) {
          try {
            stopGestures = platform.addGestureListener(resumeAudio);
          } catch {
            stopGestures = null;
          }
        }
      },
    );
  }

  function resumeAudio(): void {
    if (stopped || finished) return;
    try {
      void context?.resume().catch(() => undefined);
    } catch {
      // A closed context: the <audio> element plays without it.
    }
    play();
  }

  function maybeSendReady(): void {
    const readyEndpoint = config.endpoints.ready;
    if (readySent || !connected || !playing || token === null || !readyEndpoint) return;
    readySent = true;
    sendReady(readyEndpoint, { sessionToken: token });
  }

  // ----- Caller activity -------------------------------------------------------------------------

  function startActivity(): void {
    stopActivity();
    emit({ type: "ACTIVITY" });
    activityTimer = setInterval(() => emit({ type: "ACTIVITY" }), SPEECH_ACTIVITY_MS);
    activityMaxTimer = setTimeout(stopActivity, SPEECH_ACTIVITY_MAX_MS);
  }

  function stopActivity(): void {
    clearInterval(activityTimer);
    clearTimeout(activityMaxTimer);
    activityTimer = undefined;
    activityMaxTimer = undefined;
  }

  // ----- Page visibility -------------------------------------------------------------------------

  function onVisibility(hidden: boolean): void {
    if (stopped || finished) return;
    if (hidden) {
      hiddenAt = now();
      mutedWhileHidden = micPaused;
      return;
    }
    const since = hiddenAt;
    hiddenAt = null;
    // A locked phone, a phone call, Siri: the microphone was taken away while the page was
    // hidden. A desktop tab in the background keeps its microphone, and the call.
    if (since !== null && now() - since > HIDDEN_END_MS && mutedWhileHidden) {
      emit({ type: "END", reason: "unload" });
      teardown();
    }
  }

  // ----- Closing ---------------------------------------------------------------------------------

  /** After the goodbye: the microphone goes quiet now, the rest once the remote audio has. */
  function startClosing(): void {
    phase = "closing";
    stopActivity();
    clearAllTimers();
    try {
      if (micTrack) micTrack.enabled = false;
    } catch {
      // Already stopped.
    }
    let quietMs = 0;
    closePoll = setInterval(() => {
      const level = remoteMeter?.level() ?? 0;
      if (level > 0) remoteHeard = true;
      quietMs = level > 0 ? 0 : quietMs + CLOSE_POLL_MS;
      // Quiet counts only from a meter that has ever heard the assistant: without a meter, or from
      // one that reads nothing in this browser, the goodbye gets the full CLOSE_MAX_MS.
      if (remoteHeard && quietMs >= CLOSE_QUIET_MS) teardown();
    }, CLOSE_POLL_MS);
    closeMaxTimer = setTimeout(teardown, CLOSE_MAX_MS);
  }

  function clearAllTimers(): void {
    clearTimeout(connectTimer);
    clearTimeout(holdTimer);
    clearTimeout(disconnectTimer);
    clearTimeout(mutedTimer);
    connectTimer = holdTimer = disconnectTimer = mutedTimer = undefined;
    stopActivity();
  }

  /** Releases everything the call holds. Idempotent; each step on its own. */
  function teardown(): void {
    if (phase === "closed") return;
    phase = "closed";
    clearAllTimers();
    clearInterval(closePoll);
    clearTimeout(closeMaxTimer);
    closePoll = closeMaxTimer = undefined;
    stopGestures?.();
    stopGestures = null;
    stopVisibility?.();
    stopVisibility = null;
    try {
      call?.abort();
    } catch {
      // Nothing to abort.
    }
    if (pc) {
      try {
        pc.ontrack = null;
        pc.removeEventListener("connectionstatechange", onConnectionState);
        pc.removeEventListener("iceconnectionstatechange", onConnectionState);
        pc.close();
      } catch {
        // Already closed.
      }
    }
    if (audio) {
      try {
        audio.pause();
        audio.srcObject = null;
      } catch {
        // Nothing playing.
      }
    }
    if (micTrack) {
      for (const [type, listener] of trackListeners) {
        try {
          micTrack.removeEventListener(type, listener);
        } catch {
          // A track without events.
        }
      }
    }
    trackListeners.length = 0;
    if (micStream) stopTracks(micStream);
    micMeter?.close();
    remoteMeter?.close();
    micMeter = remoteMeter = null;
    if (context) {
      try {
        void context.close().catch(() => undefined);
      } catch {
        // Already closed.
      }
    }
  }

  return {
    mode: "realtime",
    start() {
      if (started || stopped) return;
      started = true;
      if (!config.endpoints.call) {
        emit({ type: "FAIL", code: "mode_unavailable" });
        return;
      }
      if (!supportsRealtime(platform)) {
        emit({ type: "FAIL", code: isInAppBrowser(platform.userAgent) ? "in_app_browser" : "unsupported" });
        return;
      }
      // Inside the consent click: Safari and Chrome unlock audio output only in a gesture.
      try {
        context = platform.createAudioContext?.() ?? null;
        void context?.resume().catch(() => undefined);
      } catch {
        context = null; // no level meters; the call works without them
      }
      try {
        audio = platform.createAudio!();
        audio.autoplay = true;
      } catch {
        emit({ type: "FAIL", code: "unsupported" });
        teardown();
        return;
      }
      try {
        stopVisibility = platform.onVisibilityChange?.(onVisibility) ?? null;
      } catch {
        stopVisibility = null;
      }
      openMicrophone();
    },
    stop(reason: VoiceEndReason) {
      if (stopped) return;
      stopped = true;
      stopReason = reason;
      emitter.clear();
      try {
        call?.abort();
      } catch {
        // Nothing to abort.
      }
      stopGestures?.();
      stopGestures = null;
      stopVisibility?.();
      stopVisibility = null;
      micMeter?.close();
      micMeter = null;
      // A goodbye still playing is let finish (it closes everything itself, at most CLOSE_MAX_MS
      // from its start); everything else is released now.
      if (phase !== "closing") teardown();
      // A session request still on its way is left to finish: connect() hands that session back.
      if (token !== null) sendEnd(config.endpoints.end, { sessionToken: token, reason: toEndRequestReason(reason) });
      token = null;
    },
    setMuted(next: boolean) {
      if (stopped || next === muted) return;
      muted = next;
      // During the hold the wish waits for the release.
      if (holdReleased && micTrack && phase !== "closing" && phase !== "closed") micTrack.enabled = !muted;
      clearTimeout(mutedTimer);
      mutedTimer = undefined;
      if (muted) {
        mutedTimer = setTimeout(() => {
          micOffLong = true;
          updateNotice();
        }, MUTED_NOTICE_MS);
      } else if (micOffLong) {
        micOffLong = false;
        updateNotice();
      }
    },
    sendText() {
      return false;
    },
    setLocale() {
      // The stage locks the language switch during a realtime call; the model follows the caller.
    },
    onEvent(listener) {
      return emitter.on(listener);
    },
    getLevel() {
      try {
        if (stopped || phase !== "live") return 0;
        if (turn === "speaking") {
          const level = remoteMeter?.level() ?? 0;
          if (level > 0) {
            remoteSilentSince = null;
            remoteHeard = true;
            return level;
          }
          // Some browsers give Web Audio nothing from a remote stream: a gentle pulse instead.
          const t = now();
          remoteSilentSince ??= t;
          return t - remoteSilentSince > REMOTE_SILENT_FALLBACK_MS ? 0.25 + 0.15 * Math.sin(t / 160) : 0;
        }
        remoteSilentSince = null;
        if (turn === "listening" && holdReleased && !muted) return micMeter?.level() ?? 0;
        return 0;
      } catch {
        return 0;
      }
    },
    resumeAudio() {
      try {
        resumeAudio();
      } catch {
        // Never throws: the button simply did nothing.
      }
    },
  };
}

function stopTracks(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // Already stopped.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
