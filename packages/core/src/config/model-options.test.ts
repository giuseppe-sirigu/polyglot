import { describe, expect, it } from "vitest";
import { resolveApiKey } from "./loader.js";
import { findModelOption, listModelOptions, resolveEngineConfigForModel } from "./model-options.js";
import type { ModelEntry } from "./schema.js";

describe("resolveApiKey", () => {
  it("prefers ANTHROPIC_API_KEY for the anthropic provider over the explicit value", () => {
    expect(resolveApiKey("anthropic", "explicit", { ANTHROPIC_API_KEY: "from-env" })).toBe(
      "from-env",
    );
  });

  it("prefers POLYGLOT_API_KEY for openai-compatible, ignoring ANTHROPIC_API_KEY", () => {
    expect(
      resolveApiKey("openai-compatible", "explicit", {
        ANTHROPIC_API_KEY: "wrong-one",
        POLYGLOT_API_KEY: "from-env",
      }),
    ).toBe("from-env");
  });

  it("falls back to the explicit value when no relevant env var is set", () => {
    expect(resolveApiKey("anthropic", "explicit", {})).toBe("explicit");
  });

  it("returns undefined when neither env nor explicit is set", () => {
    expect(resolveApiKey("openai-compatible", undefined, {})).toBeUndefined();
  });
});

describe("resolveEngineConfigForModel", () => {
  it("defaults baseURL for openai-compatible when omitted", () => {
    const entry: ModelEntry = { provider: "openai-compatible", model: "qwen3-coder" };
    expect(resolveEngineConfigForModel(entry, {}).baseURL).toBe("http://localhost:11434/v1");
  });

  it("leaves an explicit baseURL alone", () => {
    const entry: ModelEntry = {
      provider: "openai-compatible",
      model: "m",
      baseURL: "http://elsewhere:1234/v1",
    };
    expect(resolveEngineConfigForModel(entry, {}).baseURL).toBe("http://elsewhere:1234/v1");
  });

  it("leaves baseURL undefined for anthropic", () => {
    const entry: ModelEntry = { provider: "anthropic", model: "claude-sonnet-4-5" };
    expect(resolveEngineConfigForModel(entry, {}).baseURL).toBeUndefined();
  });

  it("fills in apiKey from the env when the entry omits one", () => {
    const entry: ModelEntry = { provider: "anthropic", model: "claude-sonnet-4-5" };
    expect(resolveEngineConfigForModel(entry, { ANTHROPIC_API_KEY: "key" }).apiKey).toBe("key");
  });

  it("prefers the env var over an explicit apiKey, matching resolveApiKey's own precedence", () => {
    const entry: ModelEntry = { provider: "anthropic", model: "m", apiKey: "explicit-key" };
    expect(resolveEngineConfigForModel(entry, { ANTHROPIC_API_KEY: "env-key" }).apiKey).toBe(
      "env-key",
    );
  });

  it("only carries structuredOutput through for openai-compatible", () => {
    const entry: ModelEntry = { provider: "anthropic", model: "m", structuredOutput: true };
    expect(resolveEngineConfigForModel(entry, {}).structuredOutput).toBeUndefined();
  });
});

describe("listModelOptions", () => {
  const entries: ModelEntry[] = [
    { provider: "openai-compatible", model: "qwen2.5-coder-24k", label: "Qwen 2.5 Coder" },
    { provider: "openai-compatible", model: "qwen3-coder" },
  ];

  it("lists every configured entry, flagging whichever matches current", () => {
    const options = listModelOptions(
      { provider: "openai-compatible", model: "qwen2.5-coder-24k" },
      entries,
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ isCurrent: true, model: "qwen2.5-coder-24k" });
    expect(options[1]).toMatchObject({ isCurrent: false, model: "qwen3-coder" });
  });

  it("prepends a synthetic current entry when current isn't itself configured", () => {
    const options = listModelOptions(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      entries,
    );
    expect(options).toHaveLength(3);
    expect(options[0]).toMatchObject({
      isCurrent: true,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    expect(options[0]?.entry).toBeUndefined();
  });

  it("never duplicates an entry that matches current", () => {
    const options = listModelOptions(
      { provider: "openai-compatible", model: "qwen3-coder" },
      entries,
    );
    const matches = options.filter((o) => o.model === "qwen3-coder");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ isCurrent: true, label: "qwen3-coder" });
  });
});

describe("findModelOption", () => {
  const options = listModelOptions({ provider: "openai-compatible", model: "qwen2.5-coder-24k" }, [
    { provider: "openai-compatible", model: "qwen3-coder", label: "Qwen 3 Coder" },
    { provider: "anthropic", model: "claude-sonnet-4-5", label: "Claude Sonnet" },
  ]);

  it("matches an exact model id", () => {
    expect(findModelOption("qwen3-coder", options)?.model).toBe("qwen3-coder");
  });

  it("matches a case-insensitive label substring", () => {
    expect(findModelOption("sonnet", options)?.model).toBe("claude-sonnet-4-5");
  });

  it("returns null when nothing matches", () => {
    expect(findModelOption("gpt-4", options)).toBeNull();
  });
});
