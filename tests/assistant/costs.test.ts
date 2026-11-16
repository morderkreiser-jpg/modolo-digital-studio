// Cost estimation (lib/assistant/server/costs.ts): exact USD math from the contract's price table.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODEL_PRICES, estimateCostUsd, estimateInputUsage } from "@/lib/assistant/server/costs";
import type { UsageTokens } from "@/lib/assistant/server/costs";

const ZERO: UsageTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const MILLION: UsageTokens = { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6 };

function assertUsd(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message ?? ""} expected ${expected} USD, got ${actual}`);
}

describe("MODEL_PRICES", () => {
  it("lists the three models at the contract's USD-per-MTok prices", () => {
    assert.deepEqual(MODEL_PRICES["claude-haiku-5-5"], { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 });
    assert.deepEqual(MODEL_PRICES["claude-sonnet-5-5"], { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 });
    assert.deepEqual(MODEL_PRICES["claude-opus-5-5"], { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 });
  });
});

describe("estimateCostUsd", () => {
  it("prices each token class separately (input excludes cached tokens)", () => {
    assertUsd(estimateCostUsd("claude-haiku-5-5", MILLION), 0.1 + 0.5 + 0.01 + 0.125);
    assertUsd(estimateCostUsd("claude-haiku-5-5", { ...ZERO, inputTokens: 1e6 }), 0.1);
    assertUsd(estimateCostUsd("claude-haiku-5-5", { ...ZERO, outputTokens: 1e6 }), 0.5);
    assertUsd(estimateCostUsd("claude-haiku-5-5", { ...ZERO, cacheReadTokens: 1e6 }), 0.01);
    assertUsd(estimateCostUsd("claude-haiku-5-5", { ...ZERO, cacheWriteTokens: 1e6 }), 0.125);
  });

  it("computes a realistic cached Haiku turn exactly", () => {
    // 1200 fresh input + 300 output + 5000 cache read: (120 + 150 + 50) / 1e6
    assertUsd(estimateCostUsd("claude-haiku-5-5", { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 5000, cacheWriteTokens: 0 }), 0.00032);
    // First turn writes the cache: 42 input + 17 output + 600 written + 1800 read (the mock's usage)
    assertUsd(
      estimateCostUsd("claude-haiku-5-5", { inputTokens: 42, outputTokens: 17, cacheReadTokens: 1800, cacheWriteTokens: 600 }),
      (42 * 0.1 + 17 * 0.5 + 1800 * 0.01 + 600 * 0.125) / 1e6,
    );
  });

  it("uses each advanced model's own prices", () => {
    const usage: UsageTokens = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 1000 };
    assertUsd(estimateCostUsd("claude-sonnet-5-5", usage), (2000 + 5000 + 200 + 2500) / 1e6);
    assertUsd(estimateCostUsd("claude-opus-5-5", usage), (4000 + 10000 + 400 + 5000) / 1e6);
  });

  it("is zero for zero usage and linear in tokens", () => {
    assert.equal(estimateCostUsd("claude-haiku-5-5", ZERO), 0);
    const usage: UsageTokens = { inputTokens: 321, outputTokens: 123, cacheReadTokens: 4567, cacheWriteTokens: 89 };
    const double: UsageTokens = { inputTokens: 642, outputTokens: 246, cacheReadTokens: 9134, cacheWriteTokens: 178 };
    assertUsd(estimateCostUsd("claude-opus-5-5", double), 2 * estimateCostUsd("claude-opus-5-5", usage));
  });

  it("prices a dated snapshot id like its alias", () => {
    const usage: UsageTokens = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 1000 };
    assertUsd(estimateCostUsd("claude-haiku-5-5-20261001", usage), estimateCostUsd("claude-haiku-5-5", usage));
  });

  it("prices an unknown model at least as high as every known model, for every token class", () => {
    const shapes: UsageTokens[] = [
      { ...ZERO, inputTokens: 1e6 },
      { ...ZERO, outputTokens: 1e6 },
      { ...ZERO, cacheReadTokens: 1e6 },
      { ...ZERO, cacheWriteTokens: 1e6 },
      { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 5000, cacheWriteTokens: 700 },
    ];
    for (const model of ["claude-unknown-9", "gpt-x", ""]) {
      for (const usage of shapes) {
        const unknown = estimateCostUsd(model, usage);
        for (const known of Object.keys(MODEL_PRICES)) {
          assert.ok(unknown >= estimateCostUsd(known, usage), `${JSON.stringify(model)} vs ${known} for ${JSON.stringify(usage)}`);
        }
      }
    }
  });
});

describe("estimateInputUsage", () => {
  it("counts 3 characters per token, rounded up: messages as input, the system prompt as a cache write", () => {
    const usage = estimateInputUsage({
      system: [
        { type: "text", text: "s".repeat(9000), cache_control: { type: "ephemeral" } },
        { type: "text", text: "d".repeat(301) },
      ],
      messages: [
        { role: "user", content: "u".repeat(700) },
        { role: "assistant", content: "a".repeat(200) },
        { role: "user", content: "q".repeat(1) },
      ],
    });
    assert.deepEqual(usage, { inputTokens: 301, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 3101 });
  });

  it("sizes text blocks by their text and any other block by its JSON (erring high)", () => {
    const image = { type: "image", source: { type: "url", url: "https://example.com/x.png" } } as const;
    const usage = estimateInputUsage({
      system: [],
      messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(30) }, image] }],
    });
    assert.equal(usage.inputTokens, Math.ceil((30 + JSON.stringify(image).length) / 3));
  });

  it("is all zeros for an empty request", () => {
    assert.deepEqual(estimateInputUsage({ system: [], messages: [] }), { ...ZERO });
  });

  it("errs high against real usage, so a reservation built on it covers the reply", () => {
    // ~18k characters of system prompt and a 700-character history, as on the live site: the
    // estimate prices it as a fresh cache write, the dearest way the API could bill it.
    const estimate = estimateInputUsage({
      system: [{ type: "text", text: "k".repeat(18_000) }],
      messages: [{ role: "user", content: "m".repeat(700) }],
    });
    const worstCase = { ...estimate, outputTokens: 1024 };
    const cachedTurn = { inputTokens: 200, outputTokens: 300, cacheReadTokens: 4500, cacheWriteTokens: 0 };
    assert.ok(estimateCostUsd("claude-haiku-5-5", worstCase) > estimateCostUsd("claude-haiku-5-5", cachedTurn));
  });
});
