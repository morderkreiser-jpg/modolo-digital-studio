// The browser objects the realtime transport needs (microphone, peer connection, audio element,
// audio context, page-wide gestures, page visibility), behind one injected platform: the
// transport never reads a global itself, so tests/voice/realtime-transport.test.ts runs it on
// fakes without a DOM. browserPlatform() is the real one; each member is undefined when the
// browser lacks it, and supportsRealtime() decides whether a call can be tried at all.
import { clamp01, nowMs } from "./types";

export interface RealtimePlatform {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection?: () => RTCPeerConnection;
  createAudio?: () => HTMLAudioElement;
  createAudioContext?: () => AudioContext | null;
  /** Page-wide taps, clicks and key presses, a second path to resume playback. Returns the unsubscribe. */
  addGestureListener?: (listener: () => void) => () => void;
  /** visibilitychange; `hidden` is document.hidden. Returns the unsubscribe. */
  onVisibilityChange?: (listener: (hidden: boolean) => void) => () => void;
  userAgent?: string;
  /** Monotonic ms (nowMs from transports/types.ts in the browser). */
  now?: () => number;
}

/** The page-wide events that try playback again (window, capture phase). */
export const GESTURE_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown"] as const;

/** Reads the browser's globals once. A member the browser does not have stays undefined. */
export function browserPlatform(): RealtimePlatform {
  const platform: RealtimePlatform = { now: nowMs };
  try {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (media && typeof media.getUserMedia === "function") {
      platform.getUserMedia = (constraints) => media.getUserMedia(constraints);
    }
    if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") platform.userAgent = navigator.userAgent;
  } catch {
    // An insecure origin or a locked-down browser: no microphone.
  }
  try {
    if (typeof RTCPeerConnection === "function") platform.createPeerConnection = () => new RTCPeerConnection();
  } catch {
    // No WebRTC.
  }
  if (typeof document !== "undefined") {
    platform.createAudio = () => {
      const audio = document.createElement("audio");
      // iOS plays inline only with this attribute; harmless elsewhere.
      audio.setAttribute("playsinline", "");
      return audio;
    };
    platform.onVisibilityChange = (listener) => {
      const onChange = () => listener(document.hidden);
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    };
  }
  if (typeof window !== "undefined") {
    platform.createAudioContext = () => {
      try {
        const Context =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        return Context ? new Context() : null;
      } catch {
        return null;
      }
    };
    platform.addGestureListener = (listener) => {
      const onGesture = () => listener();
      const options = { capture: true, passive: true } as const;
      // On a touch screen pointerdown does not count as a user activation (play() would be refused
      // again); pointerup and touchend do.
      for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, options);
      return () => {
        for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture, options);
      };
    };
  }
  return platform;
}

/** Everything a call needs: a microphone, a peer connection, an audio element and fetch streams. */
export function supportsRealtime(platform: RealtimePlatform): boolean {
  return (
    typeof platform.getUserMedia === "function" &&
    typeof platform.createPeerConnection === "function" &&
    typeof platform.createAudio === "function" &&
    typeof fetch === "function" &&
    typeof ReadableStream === "function" &&
    typeof TextDecoder === "function"
  );
}

/** Facebook, Instagram, LinkedIn, Line, Android WebView: /FBAN|FBAV|Instagram|LinkedInApp|Line\/|; wv\)/ */
export function isInAppBrowser(userAgent: string | undefined): boolean {
  return typeof userAgent === "string" && /FBAN|FBAV|Instagram|LinkedInApp|Line\/|; wv\)/.test(userAgent);
}

/**
 * Loudness 0..1 of a stream, read on demand (no timer of its own). The analyser is never
 * connected to the destination: nobody hears the stream twice. Without an audio context, or on
 * any error, the level is 0.
 */
export function createLevelMeter(context: AudioContext | null, stream: MediaStream): { level(): number; close(): void } {
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let samples: Uint8Array<ArrayBuffer> | null = null;
  if (context) {
    try {
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      source = null;
      analyser = null;
      samples = null;
    }
  }
  return {
    level() {
      if (!analyser || !samples) return 0;
      try {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const centred = (samples[index] - 128) / 128;
          sum += centred * centred;
        }
        const rms = Math.sqrt(sum / samples.length);
        // Room noise sits around 0.01-0.02 RMS; speech well above (as in local.ts).
        return clamp01((rms - 0.015) * 7);
      } catch {
        return 0;
      }
    },
    close() {
      try {
        source?.disconnect();
      } catch {
        // Already disconnected, or the context is closed.
      }
      source = null;
      analyser = null;
      samples = null;
    },
  };
}
