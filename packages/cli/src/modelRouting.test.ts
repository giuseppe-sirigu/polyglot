import type { ModelEntry, ProviderAdapter } from "@usepolyglot/core";
import { describe, expect, it } from "vitest";
import {
  type ResolvedModel,
  configuredModelEntries,
  resolveConfiguredModel,
} from "./modelRouting.js";

const fakeCurrentAdapter = { id: "current" } as unknown as ProviderAdapter;

const current: ResolvedModel = {
  adapter: fakeCurrentAdapter,
  provider: "openai-compatible",
  model: "qwen3-coder",
  label: "Qwen 3 Coder",
};

const entries: ModelEntry[] = [
  { provider: "openai-compatible", model: "qwen3-coder", label: "Qwen 3 Coder" },
  {
    provider: "openai-compatible",
    model: "llama3.2:3b",
    label: "Llama Small",
    baseURL: "http://localhost:11434/v1",
  },
];

const ctx = { modelEntries: entries, current, defaults: {} };

describe("resolveConfiguredModel", () => {
  it("resolves an exact model id to a fresh adapter", () => {
    const r = resolveConfiguredModel("llama3.2:3b", ctx);
    expect(r?.model).toBe("llama3.2:3b");
    expect(r?.provider).toBe("openai-compatible");
    expect(r?.adapter).not.toBe(fakeCurrentAdapter);
  });

  it("resolves by case-insensitive substring of the label", () => {
    expect(resolveConfiguredModel("llama small", ctx)?.model).toBe("llama3.2:3b");
  });

  it("returns the running model unchanged when the query points at it", () => {
    expect(resolveConfiguredModel("qwen3-coder", ctx)).toBe(current);
  });

  it("returns null when nothing matches", () => {
    expect(resolveConfiguredModel("gpt-4o", ctx)).toBeNull();
  });

  it("carries the top-level structuredOutput default into a resolved openai-compatible adapter", () => {
    const r = resolveConfiguredModel("llama3.2:3b", {
      ...ctx,
      defaults: { structuredOutput: true },
    });
    expect(r?.adapter.capabilities.structuredOutput).toBe(true);
  });
});

describe("configuredModelEntries", () => {
  const base = {
    engine: {
      provider: "anthropic" as const,
      model: "claude-sonnet-5",
      apiKey: "x",
    },
    models: entries,
  } as unknown as Parameters<typeof configuredModelEntries>[0];

  it("prepends the startup engine when it isn't already a configured entry", () => {
    const result = configuredModelEntries(base);
    expect(result[0]?.model).toBe("claude-sonnet-5");
    expect(result).toHaveLength(entries.length + 1);
  });

  it("does not duplicate the startup engine when it is already listed", () => {
    const withStartupListed = {
      ...base,
      engine: { provider: "openai-compatible", model: "qwen3-coder" },
    } as typeof base;
    expect(configuredModelEntries(withStartupListed)).toHaveLength(entries.length);
  });
});
