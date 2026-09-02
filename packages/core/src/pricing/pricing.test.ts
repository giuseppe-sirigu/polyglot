import { describe, expect, it } from "vitest";
import { computeCost, resolveModelPricing } from "./pricing.js";

describe("resolveModelPricing", () => {
  it("returns the exact table price for a known anthropic model", () => {
    expect(resolveModelPricing("anthropic", "claude-opus-5")).toEqual({ input: 5, output: 25 });
    expect(resolveModelPricing("anthropic", "claude-sonnet-5")).toEqual({ input: 2, output: 10 });
  });

  it("falls back to the family price for an unknown anthropic point release", () => {
    expect(resolveModelPricing("anthropic", "claude-opus-9-9")).toEqual({ input: 5, output: 25 });
    expect(resolveModelPricing("anthropic", "claude-haiku-5-0-20270101")).toEqual({
      input: 1,
      output: 5,
    });
  });

  it("has no built-in price for openai-compatible models", () => {
    expect(resolveModelPricing("openai-compatible", "qwen3-coder")).toBeNull();
  });

  it("lets an override win for any provider and model", () => {
    const overrides = { "qwen3-coder": { input: 0.1, output: 0.4 } };
    expect(resolveModelPricing("openai-compatible", "qwen3-coder", overrides)).toEqual({
      input: 0.1,
      output: 0.4,
    });
    expect(
      resolveModelPricing("anthropic", "claude-opus-5", {
        "claude-opus-5": { input: 1, output: 2 },
      }),
    ).toEqual({ input: 1, output: 2 });
  });

  it("returns null for an unknown model with no override (free/local)", () => {
    expect(resolveModelPricing("anthropic", "gpt-4")).toBeNull();
  });
});

describe("computeCost", () => {
  it("is 0 when pricing is null", () => {
    expect(computeCost({ inputTokens: 1000, outputTokens: 500 }, null)).toBe(0);
  });

  it("prices input and output per million", () => {
    // 1M input @ $5 + 1M output @ $25 = $30
    expect(
      computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { input: 5, output: 25 }),
    ).toBe(30);
  });

  it("prices cached input at 0.1x by default", () => {
    // 1M total input, 800k cached: 200k @ $5/M + 800k @ $0.5/M = $1.0 + $0.4 = $1.4
    const cost = computeCost(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 800_000 },
      { input: 5, output: 25 },
    );
    expect(cost).toBeCloseTo(1.4, 9);
  });

  it("honors an explicit cachedInput rate", () => {
    const cost = computeCost(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 },
      { input: 5, output: 25, cachedInput: 1 },
    );
    expect(cost).toBeCloseTo(1, 9);
  });
});
