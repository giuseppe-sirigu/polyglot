import { describe, expect, it } from "vitest";
import { AllowAllGate } from "../permissions/gate.js";
import type { ChatRequest, ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { ToolRegistry } from "../tools/types.js";
import { runSubAgent } from "./sub-agent.js";

function textAdapter(responses: string[], onRequest?: (r: ChatRequest) => void): ProviderAdapter {
  let i = 0;
  return {
    id: "fake",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 100_000, structuredOutput: false },
    async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
      onRequest?.(request);
      yield { type: "text_delta", delta: responses[i++] ?? "" };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

const base = {
  gate: new AllowAllGate(),
  cwd: "/tmp",
  systemPrompt: "You are a helper.",
  tools: new ToolRegistry(),
  signal: new AbortController().signal,
};

describe("runSubAgent", () => {
  it("returns the trimmed final text on a clean run", async () => {
    const result = await runSubAgent({
      ...base,
      adapter: textAdapter(["  the answer  "]),
      model: "m",
      userInput: "question",
    });
    expect(result).toEqual({ text: "the answer", stopReason: "done" });
  });

  it("runs on the given model in a fresh sub-agent session", async () => {
    const seen: ChatRequest[] = [];
    await runSubAgent({
      ...base,
      adapter: textAdapter(["done."], (r) => seen.push(r)),
      model: "cheap-model",
      userInput: "hi",
    });
    expect(seen[0]?.model).toBe("cheap-model");
  });

  it("forwards every event to onEvent", async () => {
    const kinds: string[] = [];
    await runSubAgent({
      ...base,
      adapter: textAdapter(["hello"]),
      model: "m",
      userInput: "hi",
      onEvent: (e) => kinds.push(e.type),
    });
    expect(kinds).toContain("text_delta");
    expect(kinds).toContain("agent_stop");
  });
});
