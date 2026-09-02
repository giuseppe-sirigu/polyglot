import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./loader.js";

function writeSettings(dir: string, settings: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
}

/** Sets up isolated temp dirs for global (~/.polyglot) and project (.polyglot) settings so each
 * test is independent of both the real home directory and of other tests, then cleans them up.
 *
 * Passing HOME inside the `env` object handed to loadConfig() is NOT enough on its own -
 * globalSettingsPath() resolves the global settings path via node:os's homedir(), which reads
 * the real process.env.HOME directly and ignores loadConfig()'s env parameter entirely (that
 * parameter only feeds applyEnvOverrides, e.g. POLYGLOT_MODEL). Without also overriding the real
 * process.env.HOME here, this test would silently read the actual developer's
 * ~/.polyglot/settings.json instead of the fake one it just wrote. */
function loadWithSettings(
  global: Record<string, unknown> | null,
  project: Record<string, unknown> | null,
  env: NodeJS.ProcessEnv = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "polyglot-cwd-"));
  const homeDir = mkdtempSync(join(tmpdir(), "polyglot-home-"));
  const realHome = process.env.HOME;
  try {
    if (project) writeSettings(join(cwd, ".polyglot"), project);
    if (global) writeSettings(join(homeDir, ".polyglot"), global);
    process.env.HOME = homeDir;
    return loadConfig(cwd, { ...env, HOME: homeDir } as NodeJS.ProcessEnv);
  } finally {
    process.env.HOME = realHome;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  }
}

describe("loadConfig structuredOutput", () => {
  it("defaults to undefined when unset anywhere", () => {
    const config = loadWithSettings({ provider: "openai-compatible", model: "m" }, null);
    expect(config.engine.structuredOutput).toBeUndefined();
  });

  it("project settings override global settings", () => {
    const config = loadWithSettings(
      { provider: "openai-compatible", model: "m", structuredOutput: true },
      { structuredOutput: false },
    );
    expect(config.engine.structuredOutput).toBe(false);
  });

  it("env var overrides settings files, accepting true/1", () => {
    const config = loadWithSettings(
      { provider: "openai-compatible", model: "m", structuredOutput: false },
      null,
      { POLYGLOT_STRUCTURED_OUTPUT: "1" },
    );
    expect(config.engine.structuredOutput).toBe(true);
  });

  it("env var accepts false/0", () => {
    const config = loadWithSettings(
      { provider: "openai-compatible", model: "m", structuredOutput: true },
      null,
      { POLYGLOT_STRUCTURED_OUTPUT: "0" },
    );
    expect(config.engine.structuredOutput).toBe(false);
  });

  it("is inert (undefined) for the anthropic provider even if set", () => {
    const config = loadWithSettings(
      { provider: "anthropic", model: "m", apiKey: "key", structuredOutput: true },
      null,
    );
    expect(config.engine.structuredOutput).toBeUndefined();
  });
});

describe("loadConfig probeCapabilities", () => {
  it("defaults to undefined and resolves from settings", () => {
    expect(
      loadWithSettings({ provider: "openai-compatible", model: "m" }, null).probeCapabilities,
    ).toBeUndefined();
    expect(
      loadWithSettings({ provider: "openai-compatible", model: "m", probeCapabilities: true }, null)
        .probeCapabilities,
    ).toBe(true);
  });

  it("POLYGLOT_PROBE overrides settings", () => {
    const config = loadWithSettings(
      { provider: "openai-compatible", model: "m", probeCapabilities: true },
      null,
      { POLYGLOT_PROBE: "0" },
    );
    expect(config.probeCapabilities).toBe(false);
  });
});

describe("loadConfig subAgents", () => {
  const base = { provider: "openai-compatible", model: "m" };

  it("is undefined unless set (frontend decides from model reliability)", () => {
    expect(loadWithSettings(base, null).subAgents).toBeUndefined();
  });

  it("resolves from settings and POLYGLOT_SUB_AGENTS", () => {
    expect(loadWithSettings({ ...base, subAgents: true }, null).subAgents).toBe(true);
    expect(
      loadWithSettings({ ...base, subAgents: true }, null, { POLYGLOT_SUB_AGENTS: "0" }).subAgents,
    ).toBe(false);
  });
});

describe("loadConfig pricing", () => {
  const base = { provider: "openai-compatible", model: "m" };

  it("defaults to an empty map", () => {
    expect(loadWithSettings(base, null).pricing).toEqual({});
  });

  it("shallow-merges project overrides over global, per model id", () => {
    const config = loadWithSettings(
      {
        ...base,
        pricing: {
          "qwen3-coder": { input: 0.1, output: 0.4 },
          "local-70b": { input: 0.5, output: 2 },
        },
      },
      { pricing: { "qwen3-coder": { input: 0.2, output: 0.8 } } },
    );
    expect(config.pricing["qwen3-coder"]).toEqual({ input: 0.2, output: 0.8 });
    expect(config.pricing["local-70b"]).toEqual({ input: 0.5, output: 2 });
  });
});

describe("loadConfig audit", () => {
  const base = { provider: "openai-compatible", model: "m" };

  it("defaults to disabled with args hashed", () => {
    expect(loadWithSettings(base, null).audit).toEqual({
      enabled: false,
      hashArgs: true,
      path: undefined,
    });
  });

  it("resolves settings and layers project over global", () => {
    const config = loadWithSettings(
      { ...base, audit: { enabled: false, hashArgs: false } },
      { audit: { enabled: true, path: "/logs" } },
    );
    expect(config.audit).toEqual({ enabled: true, hashArgs: false, path: "/logs" });
  });

  it("POLYGLOT_AUDIT toggles enabled", () => {
    expect(loadWithSettings(base, null, { POLYGLOT_AUDIT: "1" }).audit.enabled).toBe(true);
    expect(
      loadWithSettings({ ...base, audit: { enabled: true } }, null, { POLYGLOT_AUDIT: "0" }).audit
        .enabled,
    ).toBe(false);
  });
});

describe("loadConfig models", () => {
  it("defaults to an empty list when unset anywhere", () => {
    const config = loadWithSettings({ provider: "openai-compatible", model: "m" }, null);
    expect(config.models).toEqual([]);
  });

  it("concatenates global and project entries rather than replacing", () => {
    const config = loadWithSettings(
      {
        provider: "openai-compatible",
        model: "m",
        models: [{ provider: "openai-compatible", model: "qwen3-coder" }],
      },
      { models: [{ provider: "anthropic", model: "claude-sonnet-4-5" }] },
    );
    expect(config.models.map((m) => m.model)).toEqual(["qwen3-coder", "claude-sonnet-4-5"]);
  });

  it("dedupes on (provider, model, baseURL), keeping the project entry's data and the original position", () => {
    const config = loadWithSettings(
      {
        provider: "openai-compatible",
        model: "m",
        models: [
          { provider: "openai-compatible", model: "qwen3-coder", label: "global label" },
          { provider: "openai-compatible", model: "qwen2.5-coder-24k" },
        ],
      },
      {
        models: [{ provider: "openai-compatible", model: "qwen3-coder", label: "project label" }],
      },
    );
    expect(config.models.map((m) => m.model)).toEqual(["qwen3-coder", "qwen2.5-coder-24k"]);
    expect(config.models[0]?.label).toBe("project label");
  });

  it("drops malformed entries instead of making the whole settings file fail to load", () => {
    // Regression test: an earlier shape of this field used {name, label} instead of
    // {provider, model, label} - loadConfig() used to throw on any such stale/hand-edited
    // entry, which meant the entire CLI failed to start over one bad array element.
    const config = loadWithSettings(
      {
        provider: "openai-compatible",
        model: "m",
        models: [
          { name: "qwen2.5-coder-24k", label: "Qwen 2.5 Coder 24K" },
          { provider: "openai-compatible", model: "qwen3-coder", label: "Qwen 3 Coder" },
        ],
      },
      null,
    );
    expect(config.models.map((m) => m.model)).toEqual(["qwen3-coder"]);
  });
});

describe("loadConfig data-handling settings", () => {
  const base = { provider: "openai-compatible", model: "m" };

  it("persistTranscripts defaults to true", () => {
    expect(loadWithSettings(base, null).persistTranscripts).toBe(true);
    expect(loadWithSettings(base, null).retentionDays).toBeUndefined();
  });

  it("POLYGLOT_NO_PERSIST=1 forces persistTranscripts off", () => {
    expect(loadWithSettings(base, null, { POLYGLOT_NO_PERSIST: "1" }).persistTranscripts).toBe(
      false,
    );
  });

  it("a project setting of false overrides a global true", () => {
    const config = loadWithSettings(
      { ...base, persistTranscripts: true },
      { persistTranscripts: false },
    );
    expect(config.persistTranscripts).toBe(false);
  });

  it("reads retentionDays from settings and POLYGLOT_RETENTION_DAYS", () => {
    expect(loadWithSettings({ ...base, retentionDays: 30 }, null).retentionDays).toBe(30);
    expect(loadWithSettings(base, null, { POLYGLOT_RETENTION_DAYS: "7" }).retentionDays).toBe(7);
    expect(
      loadWithSettings({ ...base, retentionDays: 30 }, null, {
        POLYGLOT_RETENTION_DAYS: "not-a-number",
      }).retentionDays,
    ).toBe(30);
  });

  it("webSearch defaults to the duckduckgo provider", () => {
    expect(loadWithSettings(base, null).webSearch).toEqual({
      provider: "duckduckgo",
      apiKey: undefined,
      baseURL: undefined,
    });
  });

  it("resolves webSearch from settings, env, and project-over-global field merge", () => {
    expect(
      loadWithSettings({ ...base, webSearch: { provider: "tavily", apiKey: "k" } }, null).webSearch,
    ).toMatchObject({ provider: "tavily", apiKey: "k" });

    expect(
      loadWithSettings(base, null, { POLYGLOT_WEBSEARCH_PROVIDER: "brave" }).webSearch.provider,
    ).toBe("brave");

    const merged = loadWithSettings(
      { ...base, webSearch: { provider: "searxng", baseURL: "https://searx.global" } },
      { webSearch: { baseURL: "https://searx.project" } },
    ).webSearch;
    expect(merged).toMatchObject({ provider: "searxng", baseURL: "https://searx.project" });
  });
});
