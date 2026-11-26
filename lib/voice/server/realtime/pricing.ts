// Token usage and its price for a realtime call. Server-only, pure.
//
// The call controller sums the `usage` of every (deduplicated) response.done and the usage of the
// caller's transcription (seconds or tokens, depending on the model); this file turns the sums into
// US dollars. Two figures: `usdHigh` prices every input token at the uncached price (an upper bound,
// logged only), `usdEst` prices cached tokens at the cached price (the better estimate, which the
// per-call cost cap compares). Both undercount by the last response a hang-up cut off, which never
// gets its response.done. The minute brake stays what is charged; these numbers are logged and cap
// one call.

/** USD per million tokens, OpenAI pricing page as read on 26.11.2026. Check again before relying on it. */
export const REALTIME_PRICES_USD_PER_MTOK: Readonly<
  Record<string, { textIn: number; textInCached: number; textOut: number; audioIn: number; audioInCached: number; audioOut: number }>
> = {
  "gpt-realtime-2.1-mini": { textIn: 0.6, textInCached: 0.06, textOut: 2.4, audioIn: 10, audioInCached: 0.3, audioOut: 20 },
  "gpt-realtime-2.1": { textIn: 4, textInCached: 0.4, textOut: 24, audioIn: 32, audioInCached: 0.4, audioOut: 64 },
};

/** Transcription billed by duration (usage of type "duration"). */
export const TRANSCRIBE_USD_PER_MINUTE: Readonly<Record<string, number>> = { "gpt-transcribe": 0.0045, "gpt-4o-mini-transcribe": 0.003 };

/** Transcription billed by tokens (usage of type "tokens"), USD per million tokens. */
export const TRANSCRIBE_USD_PER_MTOK: Readonly<Record<string, { in: number; out: number }>> = {
  "gpt-4o-mini-transcribe": { in: 1.25, out: 5 },
};

/** Regional processing may cost 10 % more (OpenAI's data residency pricing; whether it applies to realtime is not stated): priced in, errs high. */
export const EU_HOST_UPLIFT = 1.1;

/** The model an unknown model id is priced as: the dearer one, so the estimate errs high. */
const FALLBACK_MODEL = "gpt-realtime-2.1";
const EU_HOST = "eu.api.openai.com";

export interface UsageTotals {
  /** Text input tokens, cached ones included. */
  inTok: number;
  inCachedTok: number;
  /** Audio input tokens, cached ones included (not verified for audio: the uncached part is clamped at 0). */
  inAuTok: number;
  inCachedAuTok: number;
  /** Text output tokens, reasoning included. */
  outTok: number;
  outAuTok: number;
  /** Reasoning tokens (already inside outTok; logged only). */
  reasonTok: number;
  /** Seconds of the caller's audio the transcription model billed (usage of type "duration"). */
  transcribeSec: number;
  /** Input tokens the transcription model billed (usage of type "tokens"). */
  transcribeInTok: number;
  /** Output tokens the transcription model billed (usage of type "tokens"). */
  transcribeOutTok: number;
}

export function emptyUsage(): UsageTotals {
  return {
    inTok: 0,
    inCachedTok: 0,
    inAuTok: 0,
    inCachedAuTok: 0,
    outTok: 0,
    outAuTok: 0,
    reasonTok: 0,
    transcribeSec: 0,
    transcribeInTok: 0,
    transcribeOutTok: 0,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A finite, non-negative number, else 0. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Adds one response.done usage (OpenAI shape); missing or non-finite numbers count as 0. */
export function addResponseUsage(totals: UsageTotals, usage: unknown): void {
  const u = record(usage);
  if (u === null) return;
  const input = record(u.input_token_details);
  const cached = record(input?.cached_tokens_details);
  const output = record(u.output_token_details);
  totals.inTok += count(input?.text_tokens);
  totals.inCachedTok += count(cached?.text_tokens);
  totals.inAuTok += count(input?.audio_tokens);
  totals.inCachedAuTok += count(cached?.audio_tokens);
  totals.outTok += count(output?.text_tokens);
  totals.outAuTok += count(output?.audio_tokens);
  totals.reasonTok += count(output?.reasoning_tokens);
}

/**
 * Adds the usage of one input_audio_transcription.completed: {type: "duration", seconds} or
 * {type: "tokens", input_tokens, output_tokens, ...}. Any other shape adds nothing.
 */
export function addTranscriptionUsage(totals: UsageTotals, usage: unknown): void {
  const u = record(usage);
  if (u === null) return;
  if (u.type === "duration") {
    totals.transcribeSec += count(u.seconds);
  } else if (u.type === "tokens") {
    totals.transcribeInTok += count(u.input_tokens);
    totals.transcribeOutTok += count(u.output_tokens);
  }
}

/** usdHigh: every input token at the uncached price. usdEst: cached tokens at the cached price. */
export function usageCostUsd(
  model: string,
  totals: UsageTotals,
  transcribeModel: string | null,
  host: string,
): { usdHigh: number; usdEst: number } {
  const price = REALTIME_PRICES_USD_PER_MTOK[model] ?? REALTIME_PRICES_USD_PER_MTOK[FALLBACK_MODEL];
  const inTok = count(totals.inTok);
  const inAuTok = count(totals.inAuTok);
  const inCachedTok = Math.min(count(totals.inCachedTok), inTok);
  const inCachedAuTok = Math.min(count(totals.inCachedAuTok), inAuTok);
  const output = count(totals.outTok) * price.textOut + count(totals.outAuTok) * price.audioOut;

  let transcribe = 0;
  if (transcribeModel !== null) {
    // A model without a known price of that kind is priced as the dearest known one.
    const perMinute = TRANSCRIBE_USD_PER_MINUTE[transcribeModel] ?? Math.max(...Object.values(TRANSCRIBE_USD_PER_MINUTE));
    const tokens = Object.values(TRANSCRIBE_USD_PER_MTOK);
    const perMtok = TRANSCRIBE_USD_PER_MTOK[transcribeModel] ?? {
      in: Math.max(...tokens.map((p) => p.in)),
      out: Math.max(...tokens.map((p) => p.out)),
    };
    transcribe =
      (count(totals.transcribeSec) / 60) * perMinute +
      (count(totals.transcribeInTok) * perMtok.in + count(totals.transcribeOutTok) * perMtok.out) / 1e6;
  }

  const high = (inTok * price.textIn + inAuTok * price.audioIn + output) / 1e6 + transcribe;
  const est =
    ((inTok - inCachedTok) * price.textIn +
      inCachedTok * price.textInCached +
      (inAuTok - inCachedAuTok) * price.audioIn +
      inCachedAuTok * price.audioInCached +
      output) /
      1e6 +
    transcribe;
  const uplift = host === EU_HOST ? EU_HOST_UPLIFT : 1;
  return { usdHigh: high * uplift, usdEst: est * uplift };
}
