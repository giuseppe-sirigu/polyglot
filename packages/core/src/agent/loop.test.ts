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

/** Free-text (non-structured) counterpart of fakeStructuredAdapter - replays each response as
 * one text_delta so the loop's <tool_call> stream-parser / repair path runs. */
function fakeFreeTextAdapter(responses: string[]): ProviderAdapter {
  let i = 0;
  return {
    id: "fake-free",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 100_000, structuredOutput: false },
    async *chat(): AsyncIterable<ProviderStreamEvent> {
      const text = responses[i++];
      if (text === undefined) throw new Error("fakeFreeTextAdapter: ran out of scripted responses");
      yield { type: "text_delta", delta: text };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

const denyAllGate = {
  async evaluate() {
    return { decision: "deny" as const, reason: "denied in test" };
  },
};

async function run(
  adapter: ProviderAdapter,
  tools: ToolRegistry,
  gate: Parameters<typeof runAgentTurn>[0]["gate"] = new AllowAllGate(),
): Promise<{ events: AgentEvent[]; session: Session }> {
  const events: AgentEvent[] = [];
  const session = createSession({ cwd: "/tmp", provider: "fake", model: "fake" });
  await runAgentTurn({
    session,
    adapter,
    userInput: "go",
    systemPrompt: "system",
    tools,
    gate,
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });
  return { events, session };
}

const BROKEN_CALL = '<tool_call name="edit_file">\nthis is not json at all { [ } ]\n</tool_call>';
const lastStop = (events: AgentEvent[]) =>
  [...events].reverse().find((e) => e.type === "agent_stop");

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

describe("runAgentTurn give-up detection (free-text mode)", () => {
  it("stops as unreliable_model - not done - when the model bails to prose after parse errors", async () => {
    const adapter = fakeFreeTextAdapter([
      BROKEN_CALL,
      BROKEN_CALL,
      "It seems that didn't work. Can you extract the code and paste it yourself?",
    ]);

    const { events } = await run(adapter, buildRegistry());

    expect(lastStop(events)).toEqual({ type: "agent_stop", reason: "unreliable_model" });
  });

  it("still reports done when the model finishes cleanly after recovering from a parse error", async () => {
    const adapter = fakeFreeTextAdapter([
      BROKEN_CALL,
      '<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_call>',
      "Here is the summary of a.ts.",
    ]);

    const { events } = await run(adapter, buildRegistry());

    expect(lastStop(events)).toEqual({ type: "agent_stop", reason: "done" });
  });

  it("gives up via the counter after maxConsecutiveParseFailures broken calls in a row", async () => {
    const adapter = fakeFreeTextAdapter([BROKEN_CALL, BROKEN_CALL, BROKEN_CALL, BROKEN_CALL]);

    const { events } = await run(adapter, buildRegistry());

    expect(lastStop(events)).toEqual({ type: "agent_stop", reason: "unreliable_model" });
  });

  it("counts a step whose only real call was permission-denied as no progress", async () => {
    const adapter = fakeFreeTextAdapter([
      `${BROKEN_CALL}\n<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_call>`,
      `${BROKEN_CALL}\n<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_call>`,
      `${BROKEN_CALL}\n<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_call>`,
      `${BROKEN_CALL}\n<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_call>`,
    ]);

    const { events } = await run(adapter, buildRegistry(), denyAllGate);

    // read_file is denied every step, so no outcome "progressed" - the broken edit_file keeps
    // the counter climbing instead of being masked by the dispatched-but-denied read_file.
    expect(lastStop(events)).toEqual({ type: "agent_stop", reason: "unreliable_model" });
  });
});
