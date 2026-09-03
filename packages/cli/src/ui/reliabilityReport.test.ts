import type { SessionReliabilityTotals } from "@usepolyglot/core";
import { describe, expect, it } from "vitest";
import {
  formatReliabilityLine,
  formatReliabilityReport,
  reliabilityBadge,
} from "./reliabilityReport.js";

function totals(over: Partial<SessionReliabilityTotals> = {}): SessionReliabilityTotals {
  return {
    toolCalls: 0,
    repaired: 0,
    nameCorrected: 0,
    parseErrors: 0,
    gaveUp: 0,
    byModel: {},
    ...over,
  };
}

const q3 = (over: Record<string, number> = {}) => ({
  model: "qwen3-coder",
  toolCalls: 8,
  repaired: 2,
  nameCorrected: 1,
  parseErrors: 0,
  gaveUp: 0,
  ...over,
});

describe("formatReliabilityLine", () => {
  it("says so when the active model has no tool calls", () => {
    expect(formatReliabilityLine(undefined, "qwen3-coder")).toBe("no tool calls yet");
    expect(formatReliabilityLine(totals({ byModel: { m: q3({ toolCalls: 0 }) } }), "m")).toBe(
      "no tool calls yet",
    );
  });

  it("summarises clean rate, repairs and parse errors for the active model", () => {
    const r = totals({ byModel: { "qwen3-coder": q3({ parseErrors: 1 }) } });
    const line = formatReliabilityLine(r, "qwen3-coder");
    expect(line).toContain("qwen3-coder");
    expect(line).toContain("6/9 clean (67%)");
    expect(line).toContain("2 repaired");
    expect(line).toContain("1 parse error");
    expect(line).toContain("(see /reliability)");
  });
});

describe("formatReliabilityReport", () => {
  it("says so with no data", () => {
    expect(formatReliabilityReport(totals())).toMatch(/No tool calls this session yet/);
  });

  it("lists each model with data, most-active first", () => {
    const r = totals({
      byModel: {
        "qwen3-coder": q3(),
        "llama3.2:3b": {
          model: "llama3.2:3b",
          toolCalls: 1,
          repaired: 0,
          nameCorrected: 0,
          parseErrors: 3,
          gaveUp: 1,
        },
      },
    });
    const out = formatReliabilityReport(r);
    expect(out.indexOf("qwen3-coder")).toBeLessThan(out.indexOf("llama3.2:3b"));
    expect(out).toContain("gave up 1×");
    expect(out).toMatch(/mistyped tool name/);
  });
});

describe("reliabilityBadge", () => {
  it("is undefined without data", () => {
    expect(reliabilityBadge(undefined, "m")).toBeUndefined();
  });
  it("prefers give-ups, then parse errors, then clean rate", () => {
    expect(
      reliabilityBadge(
        totals({ byModel: { m: { ...q3({ gaveUp: 1, parseErrors: 2 }), model: "m" } } }),
        "m",
      ),
    ).toMatch(/gave up 1×/);
    expect(
      reliabilityBadge(totals({ byModel: { m: { ...q3({ parseErrors: 2 }), model: "m" } } }), "m"),
    ).toMatch(/2 parse errors/);
    expect(reliabilityBadge(totals({ byModel: { m: { ...q3(), model: "m" } } }), "m")).toMatch(
      /\d+% clean this session/,
    );
  });
});
