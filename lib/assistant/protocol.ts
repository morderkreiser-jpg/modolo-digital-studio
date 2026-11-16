// Wire format of the chat stream (Server-Sent Events over a POST response).
// Pure module, safe on client and server.
//
//   data: {"type":"delta","text":"Ciao"}\n\n
//
// One JSON object per event. Comment lines (": ping") are ignored by the decoder.
import type { ChatStreamEvent } from "./types";

export const SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/** Serialize one event as an SSE frame. */
export function encodeEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const KNOWN_TYPES = new Set(["start", "delta", "action", "done", "error"]);

function isStreamEvent(value: unknown): value is ChatStreamEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    KNOWN_TYPES.has((value as { type: string }).type)
  );
}

/**
 * Incremental SSE decoder: feed it text chunks as they arrive, get back complete events.
 * Tolerates frames split across chunks, CRLF line endings and unknown/garbled frames (skipped).
 */
export class ChatStreamDecoder {
  private buffer = "";

  push(chunk: string): ChatStreamEvent[] {
    // Normalize AFTER appending: a CRLF pair can be split across two network chunks.
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    const events: ChatStreamEvent[] = [];
    let sep = this.buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const event = parseFrame(frame);
      if (event) events.push(event);
      sep = this.buffer.indexOf("\n\n");
    }
    return events;
  }

  /** Call once the stream has ended: parses a final frame that had no trailing blank line. */
  flush(): ChatStreamEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const event = parseFrame(rest);
    return event ? [event] : [];
  }
}

function parseFrame(frame: string): ChatStreamEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
