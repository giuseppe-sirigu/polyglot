import { describe, expect, it } from "vitest";
import {
  addGiveUp,
  addParseError,
  addToolCall,
  emptyReliabilityTotals,
} from "./reliability-accounting.js";

describe("reliability-accounting", () => {
  it("starts empty", () => {
    expect(emptyReliabilityTotals()).toEqual({
      toolCalls: 0,
      repaired: 0,
      nameCorrected: 0,
      parseErrors: 0,
      gaveUp: 0,
      byModel: {},
    });
  });

  it("folds tool calls per model, keeping repaired ⊆ toolCalls and nameCorrected ⊆ repaired", () => {
    let acc = emptyReliabilityTotals();
    acc = addToolCall(acc, { model: "q3", repaired: false, nameCorrected: false });
    acc = addToolCall(acc, { model: "q3", repaired: true, nameCorrected: false });
    acc = addToolCall(acc, { model: "q3", repaired: true, nameCorrected: true });
    acc = addToolCall(acc, { model: "7b", repaired: false, nameCorrected: false });

    expect(acc.toolCalls).toBe(4);
    expect(acc.repaired).toBe(2);
    expect(acc.nameCorrected).toBe(1);
    expect(acc.byModel.q3).toMatchObject({ toolCalls: 3, repaired: 2, nameCorrected: 1 });
    expect(acc.byModel["7b"]).toMatchObject({ toolCalls: 1, repaired: 0 });
  });

  it("tracks parse errors and give-ups per model", () => {
    let acc = emptyReliabilityTotals();
    acc = addParseError(acc, "7b");
    acc = addParseError(acc, "7b");
    acc = addGiveUp(acc, "7b");
    acc = addToolCall(acc, { model: "q3", repaired: false, nameCorrected: false });

    expect(acc.parseErrors).toBe(2);
    expect(acc.gaveUp).toBe(1);
    expect(acc.byModel["7b"]).toMatchObject({ parseErrors: 2, gaveUp: 1, toolCalls: 0 });
    expect(acc.byModel.q3?.parseErrors).toBe(0);
  });

  it("is pure - does not mutate the accumulator", () => {
    const acc = emptyReliabilityTotals();
    const next = addToolCall(acc, { model: "m", repaired: true, nameCorrected: false });
    expect(acc.toolCalls).toBe(0);
    expect(next).not.toBe(acc);
  });
});
