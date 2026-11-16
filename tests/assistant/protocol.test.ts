// Wire format of the chat stream (lib/assistant/protocol.ts): encoder and incremental decoder.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatStreamDecoder, SSE_CONTENT_TYPE, encodeEvent } from "@/lib/assistant/protocol";
import type { ChatStreamEvent } from "@/lib/assistant/types";
import { seededRandom } from "./fixtures";

// One event of every type, with text that stresses JSON escaping: quotes, newlines, non-ASCII
// and an astral-plane emoji (two UTF-16 code units, four UTF-8 bytes).
const EVENTS: ChatStreamEvent[] = [
  { type: "start" },
  { type: "delta", text: "Ciao! Il prezzo è «CHF 1200» — \"finale\".\nSeconda riga 😊" },
  { type: "action", action: { kind: "quote_form", service: "website", summary: "Sito per un salone" } },
  { type: "done", stop: "action", remaining: 3 },
  { type: "error", code: "rate_limited", retryAfter: 42 },
];
const STREAM = EVENTS.map(encodeEvent).join("");

function decodeChunks(chunks: string[]): ChatStreamEvent[] {
  const decoder = new ChatStreamDecoder();
  const events = chunks.flatMap((chunk) => decoder.push(chunk));
  return [...events, ...decoder.flush()];
}

/** Feed raw bytes the way the browser hook does: fetch body chunks → streaming TextDecoder → push. */
function decodeByteChunks(bytes: Uint8Array, cuts: number[]): ChatStreamEvent[] {
  const text = new TextDecoder();
  const decoder = new ChatStreamDecoder();
  const events: ChatStreamEvent[] = [];
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    events.push(...decoder.push(text.decode(bytes.subarray(start, cut), { stream: true })));
    start = cut;
  }
  events.push(...decoder.push(text.decode()));
  return [...events, ...decoder.flush()];
}

describe("encodeEvent", () => {
  it("serializes an event as one `data:` frame terminated by a blank line", () => {
    for (const event of EVENTS) {
      const frame = encodeEvent(event);
      assert.equal(frame, `data: ${JSON.stringify(event)}\n\n`);
      // Newlines inside the text are JSON-escaped, so the only blank line is the terminator.
      assert.equal(frame.indexOf("\n"), frame.length - 2);
    }
  });

  it("declares an SSE content type with an explicit charset", () => {
    assert.match(SSE_CONTENT_TYPE, /^text\/event-stream/);
    assert.match(SSE_CONTENT_TYPE, /charset=utf-8/i);
  });
});

describe("ChatStreamDecoder", () => {
  it("round-trips every event type pushed as one chunk", () => {
    assert.deepEqual(decodeChunks([STREAM]), EVENTS);
  });

  it("decodes the stream split into two chunks at every UTF-16 position", () => {
    for (let i = 0; i <= STREAM.length; i += 1) {
      assert.deepEqual(decodeChunks([STREAM.slice(0, i), STREAM.slice(i)]), EVENTS, `split at ${i}`);
    }
  });

  it("decodes the stream pushed one character at a time", () => {
    assert.deepEqual(decodeChunks([...STREAM]), EVENTS);
  });

  it("decodes UTF-8 bytes split at every byte offset (multi-byte characters included)", () => {
    const bytes = new TextEncoder().encode(STREAM);
    for (let i = 0; i <= bytes.length; i += 1) {
      assert.deepEqual(decodeByteChunks(bytes, [i]), EVENTS, `split at byte ${i}`);
    }
  });

  it("decodes CRLF line endings, whole and split at every position", () => {
    const crlf = STREAM.replace(/\n/g, "\r\n");
    assert.deepEqual(decodeChunks([crlf]), EVENTS);
    for (let i = 0; i <= crlf.length; i += 1) {
      assert.deepEqual(decodeChunks([crlf.slice(0, i), crlf.slice(i)]), EVENTS, `CRLF split at ${i}`);
    }
  });

  it("decodes a long stream fed in pseudo-random chunk sizes", () => {
    const random = seededRandom(20261115);
    const deltas: ChatStreamEvent[] = Array.from({ length: 300 }, (_, i) => ({
      type: "delta",
      text: `parola ${i} — è «ok» ${i % 7 === 0 ? "😊\n" : ""}`,
    }));
    const events: ChatStreamEvent[] = [{ type: "start" }, ...deltas, { type: "done", stop: "end", remaining: 0 }];
    const stream = events.map(encodeEvent).join("");
    const chunks: string[] = [];
    for (let pos = 0; pos < stream.length; ) {
      const size = 1 + Math.floor(random() * 97);
      chunks.push(stream.slice(pos, pos + size));
      pos += size;
    }
    assert.deepEqual(decodeChunks(chunks), events);
  });

  it("skips comments, garbled JSON, non-objects and unknown event types, keeping valid frames in order", () => {
    const noisy = [
      ": ping\n\n",
      encodeEvent({ type: "start" }),
      "data: {not json\n\n",
      "data: null\n\n",
      "data: [1,2,3]\n\n",
      'data: "start"\n\n',
      'data: {"type":"unknown","text":"x"}\n\n',
      'data: {"text":"no type"}\n\n',
      "event: delta\n\n",
      "retry: 1000\n\n",
      encodeEvent({ type: "delta", text: "ok" }),
      encodeEvent({ type: "done", stop: "end", remaining: 5 }),
    ].join("");
    assert.deepEqual(decodeChunks([noisy]), [
      { type: "start" },
      { type: "delta", text: "ok" },
      { type: "done", stop: "end", remaining: 5 },
    ]);
  });

  it("accepts `data:` without the optional space and joins multi-line data fields", () => {
    const frames = 'data:{"type":"start"}\n\ndata: {"type":"delta",\ndata: "text":"a"}\n\n';
    assert.deepEqual(decodeChunks([frames]), [{ type: "start" }, { type: "delta", text: "a" }]);
  });

  it("flush() parses a final frame that lacks the trailing blank line, once", () => {
    const decoder = new ChatStreamDecoder();
    assert.deepEqual(decoder.push('data: {"type":"done","stop":"end","remaining":2}'), []);
    assert.deepEqual(decoder.flush(), [{ type: "done", stop: "end", remaining: 2 }]);
    assert.deepEqual(decoder.flush(), []);
  });

  it("flush() returns nothing for whitespace or a garbled tail", () => {
    const blank = new ChatStreamDecoder();
    blank.push("  \n");
    assert.deepEqual(blank.flush(), []);
    const garbled = new ChatStreamDecoder();
    garbled.push('data: {"type":"del');
    assert.deepEqual(garbled.flush(), []);
  });
});
