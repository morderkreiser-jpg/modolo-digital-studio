// What the business receives after a written example (mode "scripted"): the e-mails the voice
// stage shows once an example has stopped (review finding N2). An example is not over at
// "goodbye"; it is over when the business has the request in its inbox.
//
// Pure and safe in the browser: the stage (components/voice/voice-stage.tsx) imports it. The data
// is built on the server with the formatter of the real e-mails (lib/voice/server/demo-mails.ts)
// and handed to the stage with its props (lib/voice/server/mount-config.ts).
import type { VoiceLocale } from "./types";

export interface AfterCallMail {
  subject: string;
  /** Plain text with its line breaks, as an e-mail program shows it. */
  text: string;
}

/** One tool step of the example: once its line is on screen, the business has these e-mails. */
export interface AfterCallStep {
  /** Caption id of the line the step belongs to (scriptCaptionId). */
  captionId: string;
  /** Indexes into DemoAfterCall.mails, in the order the business got them. */
  mails: number[];
}

export interface DemoAfterCall {
  /** The language the e-mails are written in: the business's (their lang attribute). */
  locale: VoiceLocale;
  /** Every e-mail of the example, each once. */
  mails: AfterCallMail[];
  /** The steps that change what the business has, in the order of the example's lines. */
  steps: AfterCallStep[];
}

/**
 * Caption id of line `lineIndex` of a written example. The player (components/voice/transports/
 * scripted.ts) gives its captions these ids and the server keys the steps with them, so the two
 * cannot drift apart.
 */
export function scriptCaptionId(scriptId: string, lineIndex: number): string {
  return `${scriptId}#${lineIndex}`;
}

/** The script a caption of a written example belongs to, or null for any other caption. */
export function scriptIdOfCaption(captionId: string): string | null {
  const cut = captionId.lastIndexOf("#");
  return cut > 0 && /^\d+$/.test(captionId.slice(cut + 1)) ? captionId.slice(0, cut) : null;
}

export type AfterCallView =
  | { kind: "mails"; locale: VoiceLocale; mails: AfterCallMail[] }
  /** The example played to its end and nothing reached the business: the stage says so. */
  | { kind: "none" };

/**
 * What the stage shows once an example has stopped: the e-mails of the last step whose line was
 * shown (an example stopped halfway shows what the business had by then); for an example that
 * played to its end with no e-mail at all, a note that the business gets none; otherwise (stopped
 * before the first e-mail, or no data for this example) nothing.
 */
export function afterCallView(
  afterCall: DemoAfterCall | undefined,
  shownCaptionIds: Iterable<string>,
  complete: boolean,
): AfterCallView | null {
  if (!afterCall) return null;
  const shown = new Set(shownCaptionIds);
  let indexes: number[] = [];
  for (const step of afterCall.steps) if (shown.has(step.captionId)) indexes = step.mails;
  const mails = indexes.map((index) => afterCall.mails[index]).filter((mail): mail is AfterCallMail => mail !== undefined);
  if (mails.length > 0) return { kind: "mails", locale: afterCall.locale, mails };
  return complete ? { kind: "none" } : null;
}
