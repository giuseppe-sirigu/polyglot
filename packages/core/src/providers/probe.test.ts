import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineConfig } from "../config/loader.js";
import {
  loadCachedCapabilities,
  parseModelsContextLength,
  probeCapabilities,
  probeResultToCapabilities,
  saveCachedCapabilities,
} from "./probe.js";
import type { ProviderAdapter, ProviderStreamEvent } from "./types.js";

function fakeAdapter(events: ProviderStreamEvent[] | (() => never)): ProviderAdapter {
  return {
    id: "fake",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 1, structuredOutput: false },
    async *chat(): AsyncIterable<ProviderStreamEvent> {
      if (typeof events === "function") events();
      for (const event of events as ProviderStreamEvent[]) yield event;
    },
  };
}

const openaiConfig: EngineConfig = { provider: "openai-compatible", model: "m" }; // no baseURL -> skips the /models fetch

describe("parseModelsContextLength", () => {
  it("reads vLLM's max_model_len for the matching model", () => {
    const body = { object: "list", data: [{ id: "m", max_model_len: 32768 }, { id: "other" }] };
    expect(parseModelsContextLength(body, "m")).toBe(32768);
  });

  it("falls back to the first entry and recognizes context_length", () => {
    expect(parseModelsContextLength({ data: [{ id: "x", context_length: 8192 }] }, "m")).toBe(8192);
  });

  it("reads a bare single-model object", () => {
    expect(parseModelsContextLength({ id: "m", max_context_length: 4096 }, "m")).toBe(4096);
  });

  it("returns undefined when nothing recognizable is present", () => {
    expect(parseModelsContextLength({ data: [{ id: "m" }] }, "m")).toBeUndefined();
    expect(parseModelsContextLength("garbage", "m")).toBeUndefined();
    expect(parseModelsContextLength(null, "m")).toBeUndefined();
  });
});

describe("probeResultToCapabilities", () => {
  it("maps only the fields it determined", () => {
    expect(probeResultToCapabilities({ probedAt: "t", structuredOutput: true })).toEqual({
      structuredOutput: true,
    });
    expect(
      probeResultToCapabilities({ probedAt: "t", maxContextTokens: 8192, structuredOutput: false }),
    ).toEqual({ maxContextTokens: 8192, structuredOutput: false });
    expect(probeResultToCapabilities({ probedAt: "t" })).toEqual({});
  });
});

describe("probeCapabilities", () => {
  it("detects structured output and token usage from a clean envelope response", async () => {
    const adapter = fakeAdapter([
      { type: "text_delta", delta: '{"message":"ok","tool_calls":[]}' },
      { type: "usage", inputTokens: 12, outputTokens: 5 },
      { type: "message_stop", stopReason: "end_turn" },
    ]);
    const result = await probeCapabilities(adapter, openaiConfig, { timeoutMs: 1000 });
    expect(result.structuredOutput).toBe(true);
    expect(result.reportsTokenUsage).toBe(true);
    expect(result.probedAt).toBeTruthy();
  });

  it("reports structuredOutput: false when the backend answers with prose", async () => {
    const adapter = fakeAdapter([
      { type: "text_delta", delta: "Sure, here you go: ok" },
      { type: "message_stop", stopReason: "end_turn" },
    ]);
    const result = await probeCapabilities(adapter, openaiConfig, { timeoutMs: 1000 });
    expect(result.structuredOutput).toBe(false);
    expect(result.reportsTokenUsage).toBeUndefined();
  });

  it("never throws when the probe turn fails - leaves fields undefined", async () => {
    const adapter = fakeAdapter(() => {
      throw new Error("connection refused");
    });
    const result = await probeCapabilities(adapter, openaiConfig, { timeoutMs: 1000 });
    expect(result.structuredOutput).toBeUndefined();
    expect(result.probedAt).toBeTruthy();
  });
});

describe("capability cache", () => {
  const dirs: string[] = [];
  function tmp() {
    const d = mkdtempSync(join(tmpdir(), "polyglot-caps-"));
    dirs.push(d);
    return d;
  }
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a probe result by key", () => {
    const dir = tmp();
    saveCachedCapabilities("http://x|m", { probedAt: "t", structuredOutput: true }, dir);
    saveCachedCapabilities("http://x|n", { probedAt: "t2", maxContextTokens: 4096 }, dir);
    expect(loadCachedCapabilities("http://x|m", dir)).toEqual({
      probedAt: "t",
      structuredOutput: true,
    });
    expect(loadCachedCapabilities("http://x|n", dir)?.maxContextTokens).toBe(4096);
  });

  it("returns null for a missing key or an unreadable file", () => {
    const dir = tmp();
    expect(loadCachedCapabilities("absent", dir)).toBeNull();
    writeFileSync(join(dir, "capabilities.json"), "{ not json", "utf8");
    expect(loadCachedCapabilities("absent", dir)).toBeNull();
  });
});
