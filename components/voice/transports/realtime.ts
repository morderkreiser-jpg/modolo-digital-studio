// Mode "realtime": the real product later (streaming audio to a voice provider over WebRTC with
// a short-lived token minted by our server). Only the seam exists today: the transport asks the
// session endpoint for a grant exactly as the product will, hands the session straight back, and
// reports cleanly that live voice is not available yet. No provider SDK is imported here, and the
// microphone is not requested for a connection that cannot be made.
//
// When a provider is chosen, the code that connects with `grant.realtime` goes where the TODO is,
// and the rest of the interface (mute, level, captions from the provider's transcripts) follows
// the local transport.
import { toEndRequestReason, type VoiceEndReason } from "../voice-machine";
import { requestSession, sendEnd } from "./http";
import { createEmitter, type VoiceTransport, type VoiceTransportOptions } from "./types";

export function createRealtimeTransport(options: VoiceTransportOptions): VoiceTransport {
  const { config } = options;
  const emitter = createEmitter();
  const request = new AbortController();
  let started = false;
  let stopped = false;
  let token: string | null = null;

  async function connect(): Promise<void> {
    const result = await requestSession(
      config.endpoints.session,
      { tenant: config.tenant, locale: options.locale, mode: "realtime", page: options.page, hp: options.hp ?? "" },
      request.signal,
    );
    if (stopped) {
      if (result.ok) sendEnd(config.endpoints.end, { sessionToken: result.grant.sessionToken, reason: "unload" });
      return;
    }
    if (!result.ok) {
      emitter.emit({ type: "FAIL", code: result.code, retryAfter: result.retryAfter ?? null });
      return;
    }
    token = result.grant.sessionToken;
    if (result.grant.mode !== "realtime") {
      emitter.emit({ type: "FAIL", code: "mode_unavailable" });
      return;
    }
    // TODO(provider): connect with result.grant.realtime here (WebRTC). Until then the failure
    // makes the stage stop this transport, and stop() hands the session back to the end endpoint
    // at once, so it does not hold one of the tenant's concurrent slots.
    emitter.emit({ type: "FAIL", code: "not_available_yet" });
  }

  return {
    mode: "realtime",
    start() {
      if (started || stopped) return;
      started = true;
      // The machine waits in "requesting_mic"; the seam goes on without the microphone.
      emitter.emit({ type: "CONNECTING" });
      void connect();
    },
    stop(reason: VoiceEndReason) {
      if (stopped) return;
      stopped = true;
      request.abort();
      emitter.clear();
      if (token !== null) sendEnd(config.endpoints.end, { sessionToken: token, reason: toEndRequestReason(reason) });
      token = null;
    },
    setMuted() {
      // No audio flows yet.
    },
    sendText() {
      return false;
    },
    setLocale() {
      // The provider session would be told here.
    },
    onEvent(listener) {
      return emitter.on(listener);
    },
    getLevel() {
      return 0;
    },
  };
}
