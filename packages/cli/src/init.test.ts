import { describe, expect, it } from "vitest";
import { settingsFromAnswers } from "./init.js";

describe("settingsFromAnswers", () => {
  it("builds a local-model settings object with the base URL", () => {
    expect(
      settingsFromAnswers({
        provider: "openai-compatible",
        model: "qwen3-coder",
        baseURL: "http://box:11434/v1",
      }),
    ).toEqual({
      provider: "openai-compatible",
      model: "qwen3-coder",
      baseURL: "http://box:11434/v1",
    });
  });

  it("defaults the base URL for a local model when blank", () => {
    const s = settingsFromAnswers({ provider: "openai-compatible", model: "m", baseURL: "" });
    expect(s.baseURL).toBe("http://localhost:11434/v1");
  });

  it("builds an anthropic settings object with no base URL", () => {
    expect(settingsFromAnswers({ provider: "anthropic", model: "claude-sonnet-4-5" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });
});
