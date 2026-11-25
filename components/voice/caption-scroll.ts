// Where the caption box of the voice stage scrolls when a written example ends (voice-stage.tsx),
// kept pure so the rule is tested without a browser.
//
// The box has a fixed height (17.5rem) and holds the last lines, the end of the example and then
// the e-mail the business receives. The e-mail alone is taller than the box, and the part that
// shows what the assistant does, the request with the caller's name, number and wish, came only
// after its header lines: the box stopped at "Sprache" and "Kanal" (browser check R3-B2). So the
// end of the example still comes to the top of the box, unless the first request would then end
// below the box's faded bottom edge: then the box scrolls on until the request's last line is in
// view. A request taller than the box (a long description on a phone) shows its end: what was
// wanted, then the caller's name and number; its first line repeats the subject, above.
//
// Once the box goes past the top of the e-mail card, the label of the e-mails ("Example: what the
// business gets by e-mail") stays pinned to the box's top edge (voice-stage.module.css): without
// it the visitor reads a list of fields and nothing says what they are. A request that fits under
// the pinned label starts right under it, so the box shows the label and the whole request.

/** Where the end of an example lands in the caption box: below its faded top edge (2.25rem). */
export const AFTER_CALL_TOP_PX = 40;
/** Room kept under the request: the box's faded bottom edge (2rem) and a little air. */
export const AFTER_CALL_BOTTOM_PX = 40;
/**
 * Air between the pinned label of the e-mails and the first line of the request under it: clear
 * of the short fade under the label (14px, voice-stage.module.css).
 */
export const AFTER_CALL_HEAD_GAP_PX = 16;
/** Content further below the visible part of the box than this fades out at the bottom edge. */
export const MORE_BELOW_PX = 4;

/** A stretch of the box's content, in its scroll coordinates (0 = the top of the content). */
export interface ContentSpan {
  top: number;
  bottom: number;
}

/**
 * The scrollTop that shows the end of the example, or, when the first request would then end below
 * the box: the request from its first line, right under the pinned label (`head`, the label's
 * height; 0 or absent when there is none), or the request's end when it is taller than the room
 * under the label.
 */
export function afterCallScrollTop(args: {
  endMark: number;
  request: ContentSpan | null;
  viewHeight: number;
  head?: number;
}): number {
  const atEndMark = args.endMark - AFTER_CALL_TOP_PX;
  const request = args.request;
  if (request === null || request.bottom + AFTER_CALL_BOTTOM_PX <= atEndMark + args.viewHeight) {
    return Math.max(0, Math.round(atEndMark));
  }
  const requestEnd = request.bottom + AFTER_CALL_BOTTOM_PX - args.viewHeight;
  const head = args.head ?? 0;
  const underLabel = head > 0 ? request.top - head - AFTER_CALL_HEAD_GAP_PX : requestEnd;
  // The request fits under the label exactly when underLabel is the lower of the two positions.
  return Math.max(0, Math.round(Math.max(requestEnd, underLabel)));
}

/**
 * The first request of an e-mail's text (summary.ts renderSummaryEmail): from its numbered first
 * line ("1. Anfrage: ...") to the blank line after its details. null when the e-mail has none.
 */
export function firstRequestSpan(text: string): { start: number; end: number } | null {
  const match = /(^|\n)(\d+\. )/.exec(text);
  if (!match) return null;
  const start = match.index + match[1].length;
  const blank = text.indexOf("\n\n", start);
  return { start, end: blank === -1 ? text.length : blank };
}
