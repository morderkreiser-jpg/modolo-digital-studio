// Checks of the SDP a browser sends to /api/voice/call, and of the answer the provider returns.
// Server-only, pure.
//
// The offer is the only thing of the visitor's that reaches the provider's call creation, and a
// well-formed offer is accepted there whether a browser stands behind it or not: these rules are
// the gate. They admit exactly one audio section and nothing else, so a data channel (which would
// let the browser send its own session.update or text items) cannot be smuggled in, not even
// behind a bare CR that one parser reads as a line end and another does not.
import type { VoiceErrorCode } from "@/lib/voice/types";

export const MAX_OFFER_CHARS = 12_000;
const MAX_ANSWER_CHARS = 20_000;
const MAX_LINES = 200;
const MAX_LINE_CHARS = 1_024;

export type OfferCheck = { ok: true; sdp: string } | { ok: false; status: 400 | 413; code: VoiceErrorCode; rule: string };

/** The one media line an offer or an answer may carry: audio over (D)TLS-SRTP, payload types only. */
const AUDIO_MEDIA_RE = /^m=audio \d{1,5} (UDP\/TLS\/RTP\/SAVPF|RTP\/SAVPF) \d{1,3}( \d{1,3})*$/;
const LINE_RE = /^[a-z]=/;
/** Printable ASCII and TAB only. */
const BAD_CHAR_RE = /[^\t\x20-\x7e]/;
const BARE_CR_RE = /\r(?!\n)/;
const SCTP_LINE_RE = /^a=(sctp|max-message-size)/i;
const DATACHANNEL_RE = /webrtc-datachannel/i;

function refuse(rule: string, status: 400 | 413 = 400): OfferCheck {
  return { ok: false, status, code: status === 413 ? "too_large" : "bad_request", rule };
}

/** Splits on CRLF or LF and drops one trailing empty line (the final line end). */
function sdpLines(value: string): string[] {
  const lines = value.split(/\r\n|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Validates the browser's offer; on success returns it with CRLF line ends and a final CRLF.
 * `rule` names the first rule that failed (for the log, never shown to the visitor).
 */
export function validateOffer(value: unknown): OfferCheck {
  if (typeof value !== "string" || value.length === 0) return refuse("not_string");
  if (value.length > MAX_OFFER_CHARS) return refuse("too_long", 413);
  if (BARE_CR_RE.test(value)) return refuse("bare_cr");

  const lines = sdpLines(value);
  if (lines.length > MAX_LINES) return refuse("too_many_lines");
  if (lines.some((line) => line.length > MAX_LINE_CHARS)) return refuse("long_line");
  if (lines.some((line) => BAD_CHAR_RE.test(line))) return refuse("bad_char");
  if (lines[0] !== "v=0") return refuse("no_version");
  if (!lines.every((line) => LINE_RE.test(line))) return refuse("bad_line");

  const media = lines.filter((line) => line.startsWith("m="));
  if (media.length !== 1 || !AUDIO_MEDIA_RE.test(media[0])) return refuse("media");
  if (lines.some((line) => SCTP_LINE_RE.test(line) || DATACHANNEL_RE.test(line))) return refuse("sctp");
  if (!lines.some((line) => line.startsWith("a=ice-ufrag:")) || !lines.some((line) => line.startsWith("a=fingerprint:"))) {
    return refuse("ice");
  }
  return { ok: true, sdp: `${lines.join("\r\n")}\r\n` };
}

/** True for what looks like the provider's SDP answer: v=0 first, bounded, exactly one audio line. */
export function isAnswerSdp(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith("v=0") || value.length > MAX_ANSWER_CHARS) return false;
  return sdpLines(value).filter((line) => AUDIO_MEDIA_RE.test(line)).length === 1;
}
