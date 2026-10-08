import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../agent/events.js";
import { runAgentTurn } from "../agent/loop.js";
import { AllowAllGate } from "../permissions/gate.js";
import { createSession } from "../session/types.js";
import { ToolRegistry } from "../tools/types.js";
import {
  checkTruncation,
  effectiveOllamaContext,
  parseOllamaPs,
  parseOllamaShow,
  probeOllamaContext,
} from "./context-window.js";
import type { ProviderAdapter, ProviderStreamEvent } from "./types.js";

describe("checkTruncation", () => {
  it("flags a server that read far less than it was sent", () => {
    // ~7,500 tokens sent, 4,096 read: Ollama at its default window.
    expect(checkTruncation(30_000, 4096)).toEqual({
      truncated: true,
      estimatedTokens: 7500,
      reportedTokens: 4096,
    });
  });

  it("doesn't flag a server that read about what was sent, or a short prompt", () => {
    expect(checkTruncation(30_000, 8200).truncated).toBe(false);
    expect(checkTruncation(4000, 100).truncated).toBe(false);
    expect(checkTruncation(30_000, 0).truncated).toBe(false);
  });
});

describe("Ollama's context window", () => {
  it("reads the loaded window from /api/ps", () => {
    const body = {
      models: [{ name: "qwen2.5-coder:7b", model: "qwen2.5-coder:7b", context_length: 4096 }],
    };
    expect(parseOllamaPs(body, "qwen2.5-coder:7b")).toBe(4096);
    expect(parseOllamaPs(body, "other")).toBeUndefined();
    expect(parseOllamaPs({}, "x")).toBeUndefined();
  });

  it("reads num_ctx and the trained maximum from /api/show", () => {
    expect(
      parseOllamaShow({
        parameters: 'stop "<|im_end|>"\nnum_ctx 32768\n',
        model_info: { "qwen2.context_length": 131072 },
      }),
    ).toEqual({
      configured: 32768,
      trained: 131072,
    });
    expect(parseOllamaShow({ model_info: { "llama.context_length": 8192 } })).toEqual({
      trained: 8192,
    });
  });

  it("prefers the loaded window, then num_ctx; the trained maximum isn't what runs", () => {
    expect(effectiveOllamaContext({ loaded: 4096, configured: 32768, trained: 131072 })).toBe(4096);
    expect(effectiveOllamaContext({ configured: 32768, trained: 131072 })).toBe(32768);
    expect(effectiveOllamaContext({ trained: 131072 })).toBeUndefined();
  });

  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/ps")
        res.end(JSON.stringify({ models: [{ name: "m", context_length: 8192 }] }));
      else if (req.url === "/api/show")
        res.end(
          JSON.stringify({
            parameters: "num_ctx 16384",
            model_info: { "x.context_length": 32768 },
          }),
        );
      else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("asks the Ollama API next to the OpenAI-compatible one", async () => {
    expect(await probeOllamaContext(`${base}/v1`, "m")).toEqual({
      loaded: 8192,
      configured: 16384,
      trained: 32768,
    });
  });

  it("returns nothing for a server that isn't Ollama", async () => {
    expect(await probeOllamaContext("http://127.0.0.1:1/v1", "m")).toEqual({});
  });
});

describe("the agent loop", () => {
  /** A model server that reports reading `reported` prompt tokens, whatever it's sent. */
  const adapter = (reported: number): ProviderAdapter => ({
    id: "fake",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 100_000, structuredOutput: false },
    async *chat(): AsyncIterable<ProviderStreamEvent> {
      yield { type: "text_delta", delta: "done" };
      yield { type: "usage", inputTokens: reported, outputTokens: 1 };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  });
  const run = async (reported: number) => {
    const events: AgentEvent[] = [];
    await runAgentTurn({
      session: createSession({ cwd: "/tmp", provider: "fake", model: "fake" }),
      adapter: adapter(reported),
      userInput: "go",
      systemPrompt: "x".repeat(30_000), // ~7,500 tokens of instructions
      tools: new ToolRegistry(),
      gate: new AllowAllGate(),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    return events.filter((e) => e.type === "context_truncated");
  };

  it("warns when the server read far less than it was sent", async () => {
    expect(await run(4096)).toEqual([
      { type: "context_truncated", estimatedTokens: expect.any(Number), reportedTokens: 4096 },
    ]);
  });

  it("stays quiet when the server read the whole prompt", async () => {
    expect(await run(8000)).toEqual([]);
  });
});
