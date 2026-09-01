import { describe, expect, it } from "vitest";
import { AllowAllGate } from "../permissions/gate.js";
import type { ChatRequest, ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { type Session, createSession } from "../session/types.js";
import { type ToolDefinition, ToolRegistry, textResult } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { runAgentTurn } from "./loop.js";

/** A ProviderAdapter whose chat() replays one scripted full-text completion per call, as a
 * single text_delta followed by message_stop - enough to drive runAgentTurn's structured-mode
 * branch without a real HTTP call. */
function fakeStructuredAdapter(
  responses: string[],
  onRequest?: (request: ChatRequest) => void,
): ProviderAdapter {
  let i = 0;
  return {
    id: "fake",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 100_000, structuredOutput: true },
    async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
      onRequest?.(request);
      const text = responses[i++];
      if (text === undefined)
        throw new Error("fakeStructuredAdapter: ran out of scripted responses");
      yield { type: "text_delta", delta: text };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file.",
  permission: "read",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(input) {
    return textResult(`contents of ${(input as { path: string }).path}`);
  },
};

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  return registry;
}

async function run(
  adapter: ProviderAdapter,
  tools: ToolRegistry,
): Promise<{ events: AgentEvent[]; session: Session }> {
  const events: AgentEvent[] = [];
  const session = createSession({ cwd: "/tmp", provider: "fake", model: "fake" });
  await runAgentTurn({
    session,
    adapter,
    userInput: "go",
    systemPrompt: "system",
    tools,
    gate: new AllowAllGate(),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });
  return { events, session };
}

describe("runAgentTurn structured mode", () => {
  it("drives a real tool call from a valid envelope and appends its tool_result", async () => {
    const tools = buildRegistry();
    const adapter = fakeStructuredAdapter([
      JSON.stringify({
        message: "Reading the file.",
        tool_calls: [{ name: "read_file", arguments: { path: "a.ts" } }],
      }),
      JSON.stringify({ message: "Done.", tool_calls: [] }),
    ]);

    const { events } = await run(adapter, tools);

    const toolCall = events.find((e) => e.type === "tool_call");
    expect(toolCall).toMatchObject({
      type: "tool_call",
      name: "read_file",
      input: { path: "a.ts" },
    });
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toMatchObject({
      type: "tool_result",
      name: "read_file",
      resultText: "contents of a.ts",
      isError: false,
    });
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "done" });
  });

  it("surfaces a distinct error and stops on malformed JSON, without throwing", async () => {
    const tools = buildRegistry();
    const adapter = fakeStructuredAdapter(["not json at all, just prose"]);

    const { events } = await run(adapter, tools);

    const parseError = events.find((e) => e.type === "tool_parse_error");
    expect(parseError).toBeDefined();
    if (parseError?.type === "tool_parse_error") {
      expect(parseError.message).toMatch(/does not appear to be honoring/);
    }
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "unreliable_model" });
  });

  it("ends via agent_stop(done) with no text_delta when message and tool_calls are both empty", async () => {
    const tools = buildRegistry();
    const adapter = fakeStructuredAdapter([JSON.stringify({ message: "", tool_calls: [] })]);

    const { events } = await run(adapter, tools);

    expect(events.some((e) => e.type === "text_delta")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "done" });
  });

  it("emits a permission_decision between the tool_call and its tool_result", async () => {
    const adapter = fakeStructuredAdapter([
      JSON.stringify({
        message: "",
        tool_calls: [{ name: "read_file", arguments: { path: "a.ts" } }],
      }),
      JSON.stringify({ message: "done", tool_calls: [] }),
    ]);

    const { events } = await run(adapter, buildRegistry());
    const types = events.map((e) => e.type);
    const call = types.indexOf("tool_call");
    const decision = types.indexOf("permission_decision");
    const result = types.indexOf("tool_result");
    expect(call).toBeGreaterThanOrEqual(0);
    expect(decision).toBeGreaterThan(call);
    expect(result).toBeGreaterThan(decision);
    expect(events[decision]).toMatchObject({
      type: "permission_decision",
      toolName: "read_file",
      decision: "allow",
    });
  });

  it("passes the envelope response schema to the adapter whenever it reports structuredOutput", async () => {
    const requests: ChatRequest[] = [];
    const adapter = fakeStructuredAdapter(
      [JSON.stringify({ message: "hi", tool_calls: [] })],
      (r) => requests.push(r),
    );

    await run(adapter, buildRegistry());

    expect(requests).toHaveLength(1);
    expect(requests[0]?.responseSchema).toBeDefined();
    expect(requests[0]?.responseSchema).toMatchObject({
      properties: { message: expect.anything(), tool_calls: expect.anything() },
    });
  });

  it("persists the full envelope (including tool_calls), not just the prose message, so the model can see its own prior calls on later turns", async () => {
    const tools = buildRegistry();
    const firstTurn = JSON.stringify({
      message: "Reading the file.",
      tool_calls: [{ name: "read_file", arguments: { path: "a.ts" } }],
    });
    const adapter = fakeStructuredAdapter([
      firstTurn,
      JSON.stringify({ message: "Done.", tool_calls: [] }),
    ]);

    const { session } = await run(adapter, tools);

    const assistantMessages = session.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages[0]?.content).toBe(firstTurn);
    expect(assistantMessages[0]?.content).toContain("read_file");
  });
});
