import { describe, expect, it } from "vitest";
import { addTurnUsage, emptyUsageTotals, turnUsageFromEvent } from "./usage-accounting.js";

describe("addTurnUsage", () => {
  it("sums tokens and cost across turns of the same model", () => {
    let acc = emptyUsageTotals();
    acc = addTurnUsage(acc, { model: "m", inputTokens: 100, outputTokens: 20, costUSD: 0.01 });
    acc = addTurnUsage(acc, { model: "m", inputTokens: 150, outputTokens: 30, costUSD: 0.02 });
    expect(acc).toMatchObject({ inputTokens: 250, outputTokens: 50, costUSD: 0.03 });
    expect(acc.byModel.m).toMatchObject({ inputTokens: 250, outputTokens: 50, costUSD: 0.03 });
  });

  it("splits byModel across a model switch while keeping the session total", () => {
    let acc = emptyUsageTotals();
    acc = addTurnUsage(acc, { model: "a", inputTokens: 100, outputTokens: 10, costUSD: 0.01 });
    acc = addTurnUsage(acc, { model: "b", inputTokens: 200, outputTokens: 20, costUSD: 0.02 });
    expect(acc.inputTokens).toBe(300);
    expect(Object.keys(acc.byModel).sort()).toEqual(["a", "b"]);
    expect(acc.byModel.a?.inputTokens).toBe(100);
    expect(acc.byModel.b?.costUSD).toBe(0.02);
  });

  it("does not mutate the accumulator it was given", () => {
    const acc = emptyUsageTotals();
    addTurnUsage(acc, { model: "m", inputTokens: 100, outputTokens: 20, costUSD: 0.01 });
    expect(acc).toEqual(emptyUsageTotals());
  });
});

describe("turnUsageFromEvent", () => {
  it("prices an anthropic turn from the built-in table", () => {
    const turn = turnUsageFromEvent(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { provider: "anthropic", model: "claude-opus-5" },
    );
    expect(turn).toMatchObject({ model: "claude-opus-5", inputTokens: 1_000_000, costUSD: 30 });
  });

  it("prices a local turn at 0 unless an override is given", () => {
    expect(
      turnUsageFromEvent(
        { inputTokens: 1000, outputTokens: 500 },
        { provider: "openai-compatible", model: "qwen3-coder" },
      ).costUSD,
    ).toBe(0);
    expect(
      turnUsageFromEvent(
        { inputTokens: 1_000_000, outputTokens: 0 },
        {
          provider: "openai-compatible",
          model: "qwen3-coder",
          overrides: { "qwen3-coder": { input: 0.2, output: 0.8 } },
        },
      ).costUSD,
    ).toBeCloseTo(0.2, 9);
  });
});
