import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "../config/loader.js";
import { createProviderAdapter } from "./registry.js";

describe("createProviderAdapter", () => {
  it("builds the anthropic adapter with fixed, reliable capabilities", () => {
    const adapter = createProviderAdapter({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "k",
    });
    expect(adapter.id).toBe("anthropic");
    expect(adapter.capabilities).toEqual({
      nativeToolCalling: "reliable",
      maxContextTokens: 200_000,
      structuredOutput: false,
    });
  });

  it("throws for the anthropic provider without an apiKey", () => {
    expect(() => createProviderAdapter({ provider: "anthropic", model: "m" })).toThrow(/apiKey/);
  });

  it("enables structured output for openai-compatible only when the config opts in", () => {
    const on = createProviderAdapter({
      provider: "openai-compatible",
      model: "qwen3-coder",
      baseURL: "http://localhost:11434/v1",
      structuredOutput: true,
    });
    expect(on.capabilities.structuredOutput).toBe(true);

    const off = createProviderAdapter({
      provider: "openai-compatible",
      model: "qwen3-coder",
      baseURL: "http://localhost:11434/v1",
    });
    expect(off.capabilities.structuredOutput).toBe(false);
  });

  it("derives maxContextTokens per provider, so a /model switch re-derives it rather than carrying it", () => {
    const anthropic = createProviderAdapter({ provider: "anthropic", model: "m", apiKey: "k" });
    const openai = createProviderAdapter({
      provider: "openai-compatible",
      model: "m",
      baseURL: "http://localhost:11434/v1",
    });
    expect(anthropic.capabilities.maxContextTokens).toBe(200_000);
    expect(openai.capabilities.maxContextTokens).toBe(DEFAULT_MAX_CONTEXT_TOKENS);
    expect(anthropic.capabilities.maxContextTokens).not.toBe(openai.capabilities.maxContextTokens);
  });
});
