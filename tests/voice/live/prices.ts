// Token prices and the cost arithmetic of the live run (tests/voice/live/cli.ts).
//
// Read on Anthropic's pricing page on 2026-11-26
// (https://platform.claude.com/docs/en/about-claude/pricing, table "Model pricing"), USD per
// million tokens, as input / output / 5-minute cache write / cache read:
//   - claude-haiku-5-5   0.10 / 0.50 / 0.125 / 0.01 (for prompts up to 100,000 tokens; a longer
//     prompt costs more, and no scenario here comes near that length);
//   - claude-sonnet-5-5  2 / 10 / 2.50 / 0.10;
//   - claude-opus-5-5    4 / 20 / 5 / 0.20.
// Prices change. CHECK THE PAGE AGAIN BEFORE A LATER PAID RUN and change the numbers here first:
// the cost ceiling (--tetto-chf) is enforced against them, not against Anthropic's invoice.
import { estimateInputUsage, type UsageTokens } from "@/lib/assistant/server/costs";
import { DEFAULT_CHF_PER_USD } from "@/lib/voice/server/env";
import type Anthropic from "@anthropic-ai/sdk";

export interface LivePrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens (thinking included: the API counts it as output). */
  output: number;
  /** USD per million tokens written to the prompt cache (5 minutes). */
  cacheWrite: number;
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number;
}

/** See the header: read on the pricing page on 2026-11-26, to be read again before a later run. */
export const LIVE_PRICES_USD_PER_MTOK: Readonly<Record<string, LivePrice>> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

/** Where the prices come from, printed before the run and written into the index. */
export const PRICE_SOURCE =
  "tests/voice/live/prices.ts: letti il 26.11.2026 sulla pagina dei prezzi di Anthropic (platform.claude.com/docs, «Pricing»). Da rileggere prima di una prova successiva.";

/**
 * Francs per dollar for the ceiling: the voice module's own conservative rate (env.ts
 * DEFAULT_CHF_PER_USD). It errs high on purpose, so the ceiling trips early rather than late.
 */
export const LIVE_CHF_PER_USD = DEFAULT_CHF_PER_USD;

/** An unknown model id is priced like the dearest model of the table: the ceiling then errs high. */
export function priceOf(model: string): { price: LivePrice; known: boolean } {
  if (Object.hasOwn(LIVE_PRICES_USD_PER_MTOK, model)) return { price: LIVE_PRICES_USD_PER_MTOK[model], known: true };
  // The API may answer with a dated snapshot id ("claude-haiku-5-5-20261001").
  for (const [id, price] of Object.entries(LIVE_PRICES_USD_PER_MTOK)) {
    if (model.startsWith(`${id}-`)) return { price, known: true };
  }
  const dearest = Object.values(LIVE_PRICES_USD_PER_MTOK).reduce((max, price) => (price.output > max.output ? price : max));
  return { price: dearest, known: false };
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** USD of the tokens the API reported for one call. */
export function costUsd(model: string, usage: UsageTokens): number {
  const { price } = priceOf(model);
  const micro =
    positive(usage.inputTokens) * price.input +
    positive(usage.outputTokens) * price.output +
    positive(usage.cacheWriteTokens) * price.cacheWrite +
    positive(usage.cacheReadTokens) * price.cacheRead;
  return micro / 1e6;
}

/**
 * The most one model call can cost before it is made: the whole system prompt and the tools as a
 * cache write (the dearest way to pay for them), the messages as uncached input (3 characters per
 * token, which errs high) and the whole output allowance.
 */
export function callWorstCaseUsd(args: {
  model: string;
  system: readonly Anthropic.TextBlockParam[];
  tools: readonly Anthropic.Tool[];
  messages: readonly Anthropic.MessageParam[];
  maxTokens: number;
}): number {
  const input = estimateInputUsage({ system: args.system, messages: args.messages });
  const toolTokens = Math.ceil(JSON.stringify(args.tools).length / 3);
  return costUsd(args.model, {
    inputTokens: input.inputTokens,
    outputTokens: positive(args.maxTokens),
    cacheReadTokens: 0,
    cacheWriteTokens: input.cacheWriteTokens + toolTokens,
  });
}

export function usdToChf(usd: number): number {
  return usd * LIVE_CHF_PER_USD;
}

/** "0.0123" (four decimals: these amounts are fractions of a cent). */
export function formatChf(chf: number): string {
  return chf.toFixed(4);
}

export function formatUsd(usd: number): string {
  return usd.toFixed(6);
}
