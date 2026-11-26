// Fakes of the browser objects the realtime transport uses (components/voice/transports/webrtc.ts:
// RealtimePlatform), so tests/voice/realtime-transport.test.ts runs in node:test without a DOM,
// a microphone or a network: a peer connection whose state the test sets, a microphone track
// whose events the test fires, an <audio> element whose play() the test allows or blocks, an
// audio context whose analysers read a level the test sets, page gestures, page visibility, and
// the call's event stream the test writes frames into.
import type { CallStreamEvent } from "@/lib/voice/types";
import type { RealtimePlatform } from "@/components/voice/transports/webrtc";

/** An audio-only browser offer: one media line, no data channel (placeholder values only). */
export const FAKE_OFFER_SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=msid-semantic: WMS",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:TEST",
  "a=ice-pwd:TESTTESTTESTTESTTESTTEST",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "a=rtpmap:0 PCMU/8000",
  "",
].join("\r\n");

export const FAKE_ANSWER_SDP = FAKE_OFFER_SDP.replace("a=setup:actpass", "a=setup:active");

// ---------------------------------------------------------------------------------------------
// Microphone
// ---------------------------------------------------------------------------------------------

export class FakeTrack extends EventTarget {
  readonly kind = "audio";
  enabled = true;
  readyState: "live" | "ended" = "live";
  stopCount = 0;

  stop(): void {
    this.stopCount += 1;
    this.readyState = "ended";
  }

  /** What the browser does: "ended" (device gone), "mute"/"unmute" (the system took it away). */
  fire(type: "ended" | "mute" | "unmute"): void {
    if (type === "ended") this.readyState = "ended";
    this.dispatchEvent(new Event(type));
  }
}

export class FakeMediaStream {
  readonly tracks: FakeTrack[];

  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
}

export interface FakeMedia {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Every constraints object asked for. */
  requests: MediaStreamConstraints[];
  track: FakeTrack;
  stream: FakeMediaStream;
  /** With `hold`: answers the pending request now. */
  release(): void;
}

/**
 * getUserMedia that grants one stream with one audio track, refuses with `deny` (an error name
 * such as "NotAllowedError" or "NotFoundError"), or with `hold` waits for release().
 */
export function fakeMedia(options: { deny?: string; hold?: boolean } = {}): FakeMedia {
  const track = new FakeTrack();
  const stream = new FakeMediaStream([track]);
  const requests: MediaStreamConstraints[] = [];
  let release = () => undefined as void;
  return {
    requests,
    track,
    stream,
    release: () => release(),
    getUserMedia(constraints) {
      requests.push(constraints);
      const answer = () =>
        options.deny
          ? Promise.reject(new DOMException("refused", options.deny))
          : Promise.resolve(stream as unknown as MediaStream);
      if (!options.hold) return answer();
      return new Promise<MediaStream>((resolve, reject) => {
        release = () => {
          answer().then(resolve, reject);
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Peer connection
// ---------------------------------------------------------------------------------------------

export class FakePeerConnection extends EventTarget {
  /** undefined: a browser without connectionState (only ICE states count). */
  connectionState: string | undefined = "new";
  iceConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  ontrack: ((event: { streams: FakeMediaStream[]; track: FakeTrack }) => void) | null = null;
  readonly added: Array<{ track: FakeTrack; stream: FakeMediaStream }> = [];
  dataChannels = 0;
  closeCount = 0;
  /** setRemoteDescription refuses the answer. */
  refuseAnswer = false;

  constructor(options: { noConnectionState?: boolean } = {}) {
    super();
    if (options.noConnectionState) this.connectionState = undefined;
  }

  addTrack(track: FakeTrack, stream: FakeMediaStream): void {
    this.added.push({ track, stream });
  }

  createDataChannel(): never {
    this.dataChannels += 1;
    throw new Error("the realtime transport must not open a data channel");
  }

  async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    return { type: "offer", sdp: FAKE_OFFER_SDP };
  }

  async setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    if (this.refuseAnswer) throw new DOMException("bad answer", "InvalidAccessError");
    this.remoteDescription = description;
  }

  /** Sets connectionState and dispatches connectionstatechange. */
  setState(state: string): void {
    this.connectionState = state;
    this.dispatchEvent(new Event("connectionstatechange"));
  }

  /** Sets iceConnectionState and dispatches iceconnectionstatechange. */
  setIceState(state: string): void {
    this.iceConnectionState = state;
    this.dispatchEvent(new Event("iceconnectionstatechange"));
  }

  /** The remote audio track arrives. */
  fireTrack(stream: FakeMediaStream): void {
    this.ontrack?.({ streams: [stream], track: stream.tracks[0] });
  }

  close(): void {
    this.closeCount += 1;
    this.connectionState = "closed";
  }
}

// ---------------------------------------------------------------------------------------------
// Audio output and level meters
// ---------------------------------------------------------------------------------------------

export class FakeAudio {
  autoplay = false;
  srcObject: unknown = null;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  /** play() rejects with NotAllowedError while true (autoplay refused). */
  blocked = false;

  play(): Promise<void> {
    this.playCalls += 1;
    if (this.blocked) return Promise.reject(new DOMException("autoplay refused", "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }
}

export class FakeAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  connections = 0;
  /** Deviation from silence, 0..1: what getByteTimeDomainData reads. */
  amplitude = 0;
  stream: FakeMediaStream | null = null;

  connect(): void {
    // The meter must never connect the analyser on (to the speakers).
    this.connections += 1;
  }

  getByteTimeDomainData(samples: Uint8Array): void {
    const swing = Math.round(this.amplitude * 127);
    for (let index = 0; index < samples.length; index += 1) samples[index] = 128 + (index % 2 === 0 ? swing : -swing);
  }
}

export class FakeAudioContext {
  state = "suspended";
  resumeCalls = 0;
  closeCount = 0;
  readonly analysers: FakeAnalyser[] = [];

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount += 1;
    this.state = "closed";
    return Promise.resolve();
  }

  createMediaStreamSource(stream: FakeMediaStream) {
    return {
      connect: (analyser: FakeAnalyser) => {
        analyser.stream = stream;
      },
      disconnect: () => undefined,
    };
  }

  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }

  /** Sets the level every analyser of `stream` reads (0 = silence). */
  setLevel(stream: FakeMediaStream, amplitude: number): void {
    for (const analyser of this.analysers) if (analyser.stream === stream) analyser.amplitude = amplitude;
  }
}

// ---------------------------------------------------------------------------------------------
// Page gestures and visibility
// ---------------------------------------------------------------------------------------------

export function fakeGestures() {
  const listeners = new Set<() => void>();
  return {
    add(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A tap or key press anywhere on the page. */
    fire() {
      for (const listener of Array.from(listeners)) listener();
    },
    count: () => listeners.size,
  };
}

export function fakeVisibility() {
  const listeners = new Set<(hidden: boolean) => void>();
  return {
    on(listener: (hidden: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(hidden: boolean) {
      for (const listener of Array.from(listeners)) listener(hidden);
    },
    count: () => listeners.size,
  };
}

// ---------------------------------------------------------------------------------------------
// The whole platform
// ---------------------------------------------------------------------------------------------

export interface FakePlatform {
  platform: RealtimePlatform;
  media: FakeMedia;
  /** Every peer connection created (normally one). */
  peers: FakePeerConnection[];
  audios: FakeAudio[];
  contexts: FakeAudioContext[];
  gestures: ReturnType<typeof fakeGestures>;
  visibility: ReturnType<typeof fakeVisibility>;
  /** The remote stream the fake peer connection delivers with fireTrack(). */
  remote: FakeMediaStream;
  /** Moves the platform's clock (it also follows `Date.now()` when the test mocks it). */
  setNow(value: number): void;
}

export function fakePlatform(
  options: {
    deny?: string;
    holdMic?: boolean;
    userAgent?: string;
    noConnectionState?: boolean;
    without?: Array<keyof RealtimePlatform>;
  } = {},
): FakePlatform {
  const media = fakeMedia({ deny: options.deny, hold: options.holdMic });
  const peers: FakePeerConnection[] = [];
  const audios: FakeAudio[] = [];
  const contexts: FakeAudioContext[] = [];
  const gestures = fakeGestures();
  const visibility = fakeVisibility();
  let offset = 0;
  const platform: RealtimePlatform = {
    getUserMedia: media.getUserMedia,
    createPeerConnection: () => {
      const peer = new FakePeerConnection({ noConnectionState: options.noConnectionState });
      peers.push(peer);
      return peer as unknown as RTCPeerConnection;
    },
    createAudio: () => {
      const element = new FakeAudio();
      audios.push(element);
      return element as unknown as HTMLAudioElement;
    },
    createAudioContext: () => {
      const context = new FakeAudioContext();
      contexts.push(context);
      return context as unknown as AudioContext;
    },
    addGestureListener: gestures.add,
    onVisibilityChange: visibility.on,
    userAgent: options.userAgent ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    now: () => Date.now() + offset,
  };
  for (const key of options.without ?? []) delete platform[key];
  return {
    platform,
    media,
    peers,
    audios,
    contexts,
    gestures,
    visibility,
    remote: new FakeMediaStream([new FakeTrack()]),
    setNow(value) {
      offset = value - Date.now();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The call's event stream
// ---------------------------------------------------------------------------------------------

/** A ReadableStream the test writes CallStreamEvent frames into, then ends or breaks. */
export function callStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  const write = (text: string) => {
    if (!closed) controller.enqueue(encoder.encode(text));
  };
  return {
    body,
    push(event: CallStreamEvent) {
      write(`data: ${JSON.stringify(event)}\n\n`);
    },
    ping() {
      write(": ping\n\n");
    },
    end() {
      if (closed) return;
      closed = true;
      controller.close();
    },
    fail() {
      if (closed) return;
      closed = true;
      controller.error(new TypeError("network error"));
    },
    /** The transport cancelled its read (it stopped or the call ended). */
    cancelled: () => closed,
  };
}
