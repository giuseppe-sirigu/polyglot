import type { SessionUsageTotals } from "@usepolyglot/core";
import { describe, expect, it } from "vitest";
import { formatCostLine, formatCostReport } from "./costReport.js";

const usage = (over: Partial<SessionUsageTotals> = {}): SessionUsageTotals => ({
  inputTokens: 12_450,
  outputTokens: 3_201,
  costUSD: 0.0342,
  byModel: {
    "claude-opus-5": {
      model: "claude-opus-5",
      inputTokens: 12_450,
      outputTokens: 3_201,
      costUSD: 0.0342,
    },
  },
  ...over,
});

describe("formatCostReport", () => {
  it("shows the session total and a per-model breakdown", () => {
    const out = formatCostReport(usage(), { anyPricing: true });
    expect(out).toMatch(/total:\s+\$0\.0342/);
    expect(out).toMatch(/12,450 in \/ 3,201 out/);
    expect(out).toMatch(/claude-opus-5\s+\$0\.0342/);
    expect(out).toMatch(/estimate from list prices/);
  });

  it("explains the $0 when only a local model ran", () => {
    const local = usage({
      costUSD: 0,
      byModel: {
        qwen3: { model: "qwen3", inputTokens: 12_450, outputTokens: 3_201, costUSD: 0 },
      },
    });
    const out = formatCostReport(local, { anyPricing: false });
    expect(out).toMatch(/local models are free/);
    expect(out).toMatch(/\$0/);
  });

  it("handles no usage recorded", () => {
    expect(formatCostReport(undefined, { anyPricing: true })).toMatch(/No token usage recorded/);
  });
});

describe("formatCostLine", () => {
  it("shows an estimate when cost > 0", () => {
    expect(formatCostLine(usage(), true)).toMatch(/~\$0\.0342 estimated · 12,450 in \/ 3,201 out/);
  });

  it("marks a local-model session", () => {
    expect(formatCostLine(usage({ costUSD: 0 }), false)).toMatch(/\$0 · local model/);
  });

  it("says 'no usage yet' before any turn", () => {
    expect(formatCostLine(undefined, true)).toBe("no usage yet");
  });
});
