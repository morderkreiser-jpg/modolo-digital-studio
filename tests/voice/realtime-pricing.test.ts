// Token usage and its price (lib/voice/server/realtime/pricing.ts): sums of response.done usage,
// the high and the estimated figure, transcription minutes and tokens, the EU uplift.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addResponseUsage,
  addTranscriptionUsage,
  emptyUsage,
  EU_HOST_UPLIFT,
  REALTIME_PRICES_USD_PER_MTOK,
  TRANSCRIBE_USD_PER_MINUTE,
  TRANSCRIBE_USD_PER_MTOK,
  usageCostUsd,
} from "@/lib/voice/server/realtime/pricing";

/** An example response.done usage in the documented shape (round placeholder numbers). */
const EXAMPLE_USAGE = {
  total_tokens: 560,
  input_tokens: 400,
  output_tokens: 160,
  input_token_details: {
    text_tokens: 400,
    audio_tokens: 0,
    image_tokens: 0,
    cached_tokens: 0,
    cached_tokens_details: { text_tokens: 0, audio_tokens: 0, image_tokens: 0 },
  },
  output_token_details: { text_tokens: 60, audio_tokens: 100, reasoning_tokens: 30 },
};

/** The transcription usage of a model billed by duration, in the documented shape. */
const DURATION_USAGE = { type: "duration", seconds: 4 };

/** The transcription usage of a model billed by tokens, in the documented shape (placeholder numbers). */
const TOKENS_USAGE = {
  type: "tokens",
  total_tokens: 70,
  input_tokens: 50,
  input_token_details: { text_tokens: 10, audio_tokens: 40 },
  output_tokens: 20,
};

const MINI = "gpt-realtime-2.1-mini";
const LARGE = "gpt-realtime-2.1";
const HOST = "api.openai.com";

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not ${expected}`);
}

describe("realtime pricing", () => {
  it("sums the usage of an example response.done exactly", () => {
    const totals = emptyUsage();
    addResponseUsage(totals, EXAMPLE_USAGE);
    assert.deepEqual(totals, {
      inTok: 400,
      inCachedTok: 0,
      inAuTok: 0,
      inCachedAuTok: 0,
      outTok: 60,
      outAuTok: 100,
      reasonTok: 30,
      transcribeSec: 0,
      transcribeInTok: 0,
      transcribeOutTok: 0,
    });
    addResponseUsage(totals, EXAMPLE_USAGE);
    assert.equal(totals.inTok, 800);
    assert.equal(totals.outAuTok, 200);

    const once = emptyUsage();
    addResponseUsage(once, EXAMPLE_USAGE);
    const cost = usageCostUsd(MINI, once, null, HOST);
    close(cost.usdHigh, (400 * 0.6 + 60 * 2.4 + 100 * 20) / 1e6);
    close(cost.usdEst, cost.usdHigh);
  });

  it("prices the cached tokens at the cached price in the estimate only", () => {
    const totals = emptyUsage();
    addResponseUsage(totals, {
      input_token_details: { text_tokens: 1_000, audio_tokens: 400, cached_tokens_details: { text_tokens: 600, audio_tokens: 100 } },
      output_token_details: { text_tokens: 0, audio_tokens: 0 },
    });
    assert.equal(totals.inCachedTok, 600);
    assert.equal(totals.inCachedAuTok, 100);
    const p = REALTIME_PRICES_USD_PER_MTOK[LARGE];
    const cost = usageCostUsd(LARGE, totals, null, HOST);
    close(cost.usdHigh, (1_000 * p.textIn + 400 * p.audioIn) / 1e6);
    close(cost.usdEst, (400 * p.textIn + 600 * p.textInCached + 300 * p.audioIn + 100 * p.audioInCached) / 1e6);
    assert.ok(cost.usdEst < cost.usdHigh);

    // More cached than counted audio (whether audio_tokens includes the cached part is not
    // verified): the uncached part never goes negative.
    const odd = { ...emptyUsage(), inAuTok: 10, inCachedAuTok: 50 };
    const oddCost = usageCostUsd(LARGE, odd, null, HOST);
    close(oddCost.usdEst, (10 * p.audioInCached) / 1e6);
  });

  it("counts missing or malformed usage fields as zero", () => {
    const totals = emptyUsage();
    for (const usage of [undefined, null, 7, "x", [], {}, { input_token_details: "x" }, { output_token_details: [1, 2] }]) {
      addResponseUsage(totals, usage);
    }
    addResponseUsage(totals, {
      input_token_details: { text_tokens: Number.NaN, audio_tokens: Infinity, cached_tokens_details: { text_tokens: "5" } },
      output_token_details: { text_tokens: -20, audio_tokens: null, reasoning_tokens: 3 },
    });
    assert.deepEqual(totals, { ...emptyUsage(), reasonTok: 3 });
    assert.deepEqual(usageCostUsd(MINI, totals, null, HOST), { usdHigh: 0, usdEst: 0 });
  });

  it("prices an unknown model like the dearer one", () => {
    const totals = emptyUsage();
    addResponseUsage(totals, EXAMPLE_USAGE);
    assert.deepEqual(usageCostUsd("gpt-realtime-future", totals, null, HOST), usageCostUsd(LARGE, totals, null, HOST));
    assert.ok(usageCostUsd(LARGE, totals, null, HOST).usdHigh > usageCostUsd(MINI, totals, null, HOST).usdHigh);
  });

  it("adds the transcription minutes", () => {
    const totals = { ...emptyUsage(), transcribeSec: 90 };
    close(usageCostUsd(MINI, totals, "gpt-transcribe", HOST).usdHigh, 1.5 * TRANSCRIBE_USD_PER_MINUTE["gpt-transcribe"]);
    close(usageCostUsd(MINI, totals, "gpt-4o-mini-transcribe", HOST).usdEst, 1.5 * TRANSCRIBE_USD_PER_MINUTE["gpt-4o-mini-transcribe"]);
    assert.equal(usageCostUsd(MINI, totals, null, HOST).usdHigh, 0);
    // An unknown transcription model is priced as the dearest known one.
    close(usageCostUsd(MINI, totals, "transcribe-future", HOST).usdHigh, 1.5 * 0.0045);
  });

  it("reads both transcription usage shapes: seconds for duration, input and output tokens for tokens", () => {
    const totals = emptyUsage();
    addTranscriptionUsage(totals, DURATION_USAGE);
    addTranscriptionUsage(totals, TOKENS_USAGE);
    addTranscriptionUsage(totals, TOKENS_USAGE);
    assert.deepEqual(totals, { ...emptyUsage(), transcribeSec: 4, transcribeInTok: 100, transcribeOutTok: 40 });

    // No type, an unknown type, a bare duration number, malformed numbers: nothing is added.
    const none = emptyUsage();
    for (const usage of [
      undefined,
      null,
      "tokens",
      { seconds: 4 },
      { duration: 4 },
      { type: "duration", duration: 4 },
      { type: "duration", seconds: "4" },
      { type: "duration", seconds: -4 },
      { type: "minutes", seconds: 4 },
      { type: "tokens", input_tokens: Number.NaN, output_tokens: "20" },
    ]) {
      addTranscriptionUsage(none, usage);
    }
    assert.deepEqual(none, emptyUsage());
  });

  it("prices transcription tokens per million tokens, and seconds per minute", () => {
    const tokens = emptyUsage();
    addTranscriptionUsage(tokens, TOKENS_USAGE);
    assert.deepEqual(TRANSCRIBE_USD_PER_MTOK["gpt-4o-mini-transcribe"], { in: 1.25, out: 5 });
    const cost = usageCostUsd(MINI, tokens, "gpt-4o-mini-transcribe", HOST);
    close(cost.usdHigh, (50 * 1.25 + 20 * 5) / 1e6);
    close(cost.usdEst, cost.usdHigh);
    // A model without a token price is priced at the dearest token price.
    close(usageCostUsd(MINI, tokens, "transcribe-future", HOST).usdEst, (50 * 1.25 + 20 * 5) / 1e6);
    // No transcription model: nothing.
    assert.equal(usageCostUsd(MINI, tokens, null, HOST).usdEst, 0);

    // The duration shape keeps its per-minute price.
    const duration = emptyUsage();
    addTranscriptionUsage(duration, { type: "duration", seconds: 30 });
    close(usageCostUsd(MINI, duration, "gpt-transcribe", HOST).usdEst, 0.5 * TRANSCRIBE_USD_PER_MINUTE["gpt-transcribe"]);
  });

  it("adds the uplift for the EU host", () => {
    const totals = { ...emptyUsage(), transcribeSec: 60, transcribeInTok: 1_000, transcribeOutTok: 100 };
    addResponseUsage(totals, EXAMPLE_USAGE);
    const plain = usageCostUsd(MINI, totals, "gpt-transcribe", HOST);
    const eu = usageCostUsd(MINI, totals, "gpt-transcribe", "eu.api.openai.com");
    assert.equal(EU_HOST_UPLIFT, 1.1);
    close(eu.usdHigh, plain.usdHigh * 1.1);
    close(eu.usdEst, plain.usdEst * 1.1);
  });
});
