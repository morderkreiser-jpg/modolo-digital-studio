// The SDP gate of /api/voice/call (lib/voice/server/realtime/sdp.ts): exactly one audio section,
// no data channel however it is hidden, bounded size, printable ASCII, CRLF out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAnswerSdp, MAX_OFFER_CHARS, validateOffer } from "@/lib/voice/server/realtime/sdp";

/** An audio-only offer as a browser writes it (placeholder ids and keys). */
const OFFER_LINES = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS placeholder-stream",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:Ab1C",
  "a=ice-pwd:placeholderPasswordAbcdefgh",
  "a=ice-options:trickle",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=msid:placeholder-stream placeholder-track",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
];

const crlf = (lines: string[]) => `${lines.join("\r\n")}\r\n`;
const lf = (lines: string[]) => `${lines.join("\n")}\n`;

function refusedWith(value: unknown, rule: string, status: 400 | 413 = 400): void {
  const check = validateOffer(value);
  assert.equal(check.ok, false, `expected ${rule}`);
  if (check.ok) return;
  assert.equal(check.rule, rule);
  assert.equal(check.status, status);
  assert.equal(check.code, status === 413 ? "too_large" : "bad_request");
}

/** The offer with `extra` lines inserted after the media line. */
const withLines = (...extra: string[]) => {
  const at = OFFER_LINES.indexOf("c=IN IP4 0.0.0.0");
  return crlf([...OFFER_LINES.slice(0, at), ...extra, ...OFFER_LINES.slice(at)]);
};

describe("validateOffer", () => {
  it("accepts a browser audio-only offer and normalises its line ends to CRLF", () => {
    for (const offer of [crlf(OFFER_LINES), lf(OFFER_LINES), OFFER_LINES.join("\n")]) {
      const check = validateOffer(offer);
      assert.equal(check.ok, true);
      if (check.ok) assert.equal(check.sdp, crlf(OFFER_LINES));
    }
  });

  it("refuses an empty or non-string offer", () => {
    for (const value of ["", undefined, null, 42, {}, ["v=0"]]) refusedWith(value, "not_string");
  });

  it("refuses an offer above 12 000 characters with 413", () => {
    assert.equal(MAX_OFFER_CHARS, 12_000);
    const padding = "a=x-pad:" + "p".repeat(900);
    const lines = [...OFFER_LINES];
    while (crlf(lines).length <= MAX_OFFER_CHARS) lines.push(padding);
    refusedWith(crlf(lines), "too_long", 413);
  });

  it("refuses a bare CR, control characters and non-ASCII", () => {
    refusedWith(crlf(OFFER_LINES).replace("a=rtcp-mux\r\n", "a=rtcp-mux\r"), "bare_cr");
    refusedWith(withLines("a=x-ctl:\u0001"), "bad_char");
    refusedWith(withLines("a=x-null:\u0000"), "bad_char");
    refusedWith(withLines("a=x-text:Grüezi"), "bad_char");
    refusedWith(withLines("a=x-sep: "), "bad_char");
    // A TAB is allowed inside a line.
    assert.equal(validateOffer(withLines("a=x-tab:one\ttwo")).ok, true);
  });

  it("refuses a data channel hidden behind a bare CR", () => {
    const hidden = crlf(OFFER_LINES).replace(
      "a=rtcp-mux\r\n",
      "a=rtcp-mux\rm=application 9 UDP/DTLS/SCTP webrtc-datachannel\ra=sctp-port:5000\r\n",
    );
    refusedWith(hidden, "bare_cr");
  });

  it("refuses an offer that does not start with v=0", () => {
    refusedWith(crlf(OFFER_LINES.slice(1)), "no_version");
    refusedWith(crlf(["v=1", ...OFFER_LINES.slice(1)]), "no_version");
    refusedWith(crlf([" v=0", ...OFFER_LINES.slice(1)]), "no_version");
  });

  it("refuses a line that is not an SDP line", () => {
    refusedWith(withLines("hello"), "bad_line");
    refusedWith(withLines("A=sendrecv"), "bad_line");
  });

  it("refuses a second media section, video, a data channel (m=application) and an audio line with the SCTP protocol", () => {
    refusedWith(withLines("m=audio 9 UDP/TLS/RTP/SAVPF 111"), "media");
    refusedWith(crlf(OFFER_LINES.map((line) => line.replace("m=audio", "m=video"))), "media");
    refusedWith(withLines("m=video 9 UDP/TLS/RTP/SAVPF 96"), "media");
    refusedWith(withLines("m=application 9 UDP/DTLS/SCTP webrtc-datachannel"), "media");
    refusedWith(
      crlf(OFFER_LINES.map((line) => (line.startsWith("m=") ? "m=audio 9 UDP/DTLS/SCTP webrtc-datachannel" : line))),
      "media",
    );
    refusedWith(crlf(OFFER_LINES.filter((line) => !line.startsWith("m="))), "media");
  });

  it("refuses sctp attributes anywhere", () => {
    refusedWith(withLines("a=sctp-port:5000"), "sctp");
    refusedWith(withLines("a=SCTPMAP:5000 webrtc-datachannel 1024"), "sctp");
    refusedWith(withLines("a=max-message-size:262144"), "sctp");
    refusedWith(withLines("a=x-note:WebRTC-DataChannel"), "sctp");
    refusedWith(crlf([...OFFER_LINES, "a=sctp-port:5000"]), "sctp");
  });

  it("accepts an offer whose ice password happens to contain the letters sctp", () => {
    const offer = crlf(OFFER_LINES.map((line) => (line.startsWith("a=ice-pwd:") ? "a=ice-pwd:abcSCTPdefsctpghijklmnop" : line)));
    assert.equal(validateOffer(offer).ok, true);
  });

  it("refuses an offer without ICE credentials or fingerprint", () => {
    refusedWith(crlf(OFFER_LINES.filter((line) => !line.startsWith("a=ice-ufrag:"))), "ice");
    refusedWith(crlf(OFFER_LINES.filter((line) => !line.startsWith("a=fingerprint:"))), "ice");
  });

  it("refuses more than 200 lines or a line above 1 024 characters", () => {
    const many = [...OFFER_LINES];
    while (many.length <= 200) many.push("a=x-pad:1");
    refusedWith(crlf(many), "too_many_lines");
    const exactly = [...OFFER_LINES];
    while (exactly.length < 200) exactly.push("a=x-pad:1");
    assert.equal(validateOffer(crlf(exactly)).ok, true);

    refusedWith(withLines(`a=x-long:${"l".repeat(1_100)}`), "long_line");
    const longest = `a=x-long:${"l".repeat(1_024 - "a=x-long:".length)}`;
    assert.equal(longest.length, 1_024);
    assert.equal(validateOffer(withLines(longest)).ok, true);
  });
});

describe("isAnswerSdp", () => {
  it("recognises a valid answer and refuses a non-SDP answer", () => {
    const answer = crlf(OFFER_LINES.map((line) => (line === "a=setup:actpass" ? "a=setup:passive" : line)));
    assert.equal(isAnswerSdp(answer), true);
    assert.equal(isAnswerSdp(lf(OFFER_LINES)), true);
    assert.equal(isAnswerSdp(""), false);
    assert.equal(isAnswerSdp("<html>bad gateway</html>"), false);
    assert.equal(isAnswerSdp('{"error":{"code":"invalid_offer"}}'), false);
    assert.equal(isAnswerSdp(crlf(OFFER_LINES.filter((line) => !line.startsWith("m=")))), false);
    assert.equal(isAnswerSdp(withLines("m=audio 9 UDP/TLS/RTP/SAVPF 111")), false);
    assert.equal(isAnswerSdp(`${crlf(OFFER_LINES)}${"a=x-pad:1\r\n".repeat(2_000)}`), false);
  });
});
