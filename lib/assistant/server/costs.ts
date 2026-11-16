// Estimated API cost of one reply, used for the daily/monthly budget gates and the usage logs.
// Pure module. Prices are Anthropic first-party list prices in USD per million tokens (Nov 2026);
// the estimate is what the budget is enforced against, the Anthropic invoice remains the truth.
import type Anthropic from "@anthropic-ai/sdk";

export interface ModelPrice {
  input: number;
  output: number;
  /** 5-minute prompt-cache write. */
  cacheWrite: number;
  cacheRead: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Haiku's rates apply to prompts up to 100K tokens; the assistant's prompts stay far below that.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

export interface UsageTokens {
  /** Uncached input tokens (Anthropic `input_tokens`). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// An unknown model is priced like the most expensive known one: overestimating spend can only make
// the budget gate trip early, never let it be exceeded.
const PRICIEST: ModelPrice = Object.values(MODEL_PRICES).reduce((max, price) =>
  price.output > max.output ? price : max,
);

export function estimateCostUsd(model: string, usage: UsageTokens): number {
  const price = priceFor(model);
  // tokens × USD per million tokens = micro-USD; divide once at the end.
  const microUsd =
    tokens(usage.inputTokens) * price.input +
    tokens(usage.outputTokens) * price.output +
    tokens(usage.cacheWriteTokens) * price.cacheWrite +
    tokens(usage.cacheReadTokens) * price.cacheRead;
  return microUsd / 1e6;
}

// Real text averages more characters per token (English about 4), so token counts derived from 3
// err high: the safe side for a budget.
const CHARS_PER_TOKEN = 3;

/**
 * Input-side usage of a request estimated from its size, for when the API reports none: the
 * messages as uncached input and the whole system prompt as a cache write, the dearest way to pay
 * for it. Errs high on purpose. With max_tokens added as output it is the request's worst case.
 */
export function estimateInputUsage(request: {
  system: readonly Anthropic.TextBlockParam[];
  messages: readonly Anthropic.MessageParam[];
}): UsageTokens {
  let systemChars = 0;
  for (const block of request.system) systemChars += block.text.length;
  let messageChars = 0;
  for (const message of request.messages) messageChars += contentChars(message.content);
  return {
    inputTokens: Math.ceil(messageChars / CHARS_PER_TOKEN),
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: Math.ceil(systemChars / CHARS_PER_TOKEN),
  };
}

function contentChars(content: Anthropic.MessageParam["content"]): number {
  if (typeof content === "string") return content.length;
  // The assistant only sends plain text; any other block is sized by its JSON, which errs high.
  let chars = 0;
  for (const block of content) chars += block.type === "text" ? block.text.length : JSON.stringify(block).length;
  return chars;
}

function priceFor(model: string): ModelPrice {
  if (Object.hasOwn(MODEL_PRICES, model)) return MODEL_PRICES[model];
  // The API may echo a dated snapshot id ("claude-haiku-5-5-20261001"): price it like its alias
  // instead of falling through to the most expensive model.
  for (const [id, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(`${id}-`)) return price;
  }
  return PRICIEST;
}

function tokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
