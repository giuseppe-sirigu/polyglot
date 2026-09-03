import { describe, expect, it } from "vitest";
import { AllowAllGate } from "../permissions/gate.js";
import type { ChatRequest, ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { type Session, createSession } from "../session/types.js";
import { type ToolDefinition, ToolRegistry, textResult } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { type FailoverModel, runAgentTurn } from "./loop.js";

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

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(readFileTool);
  return r;
}

/** Structured adapter that replays scripted completions; a `null` entry throws (a provider
 * error) and a function entry is called for its side effect then replays "". */
function scriptedAdapter(
  id: string,
  script: (string | null)[],
  opts: { structured?: boolean; onRequest?: (r: ChatRequest) => void } = {},
): ProviderAdapter {
  let i = 0;
  return {
    id,
    capabilities: {
      nativeToolCalling: "none",
      maxContextTokens: 100_000,
      structuredOutput: opts.structured ?? true,
    },
    async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
      opts.onRequest?.(request);
      const entry = script[i++];
      if (entry === undefined) throw new Error(`${id}: out of scripted responses`);
      if (entry === null) throw new Error(`${id}: simulated provider error`);
      yield { type: "text_delta", delta: entry };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

const envelope = (calls: { name: string; arguments: unknown }[], message = "") =>
  JSON.stringify({ message, tool_calls: calls });
const DONE = envelope([], "done");
const READ = envelope([{ name: "read_file", arguments: { path: "a.ts" } }]);

interface RunResult {
  events: AgentEvent[];
  session: Session;
}

async function run(
  adapter: ProviderAdapter,
  failover: FailoverModel[],
  opts: { maxSteps?: number } = {},
): Promise<RunResult> {
  const events: AgentEvent[] = [];
  const session = createSession({ cwd: "/tmp", provider: "prov-a", model: "model-a" });
  await runAgentTurn({
    session,
    adapter,
    userInput: "go",
    systemPrompt: "system-a",
    buildSystemPrompt: ({ structured }) => `system-rebuilt structured=${structured}`,
    tools: registry(),
    gate: new AllowAllGate(),
    signal: new AbortController().signal,
    failover,
    maxSteps: opts.maxSteps ?? 25,
    onEvent: (e) => events.push(e),
  });
  return { events, session };
}

function failoverEntry(
  adapter: ProviderAdapter,
  model = "model-b",
  provider = "prov-b",
): FailoverModel & { calls: number } {
  const entry = {
    model,
    provider,
    label: model,
    calls: 0,
    getAdapter() {
      entry.calls++;
      return adapter;
    },
  };
  return entry;
}

describe("runAgentTurn model failover", () => {
  it("falls over to the next model on a provider error and finishes the turn", async () => {
    const primary = scriptedAdapter("a", [null]);
    const backup = scriptedAdapter("b", [READ, DONE]);
    const fb = failoverEntry(backup);

    const { events, session } = await run(primary, [fb]);

    const fell = events.find((e) => e.type === "model_fell_back");
    expect(fell).toMatchObject({
      type: "model_fell_back",
      from: "model-a",
      to: "model-b",
      reason: "error",
    });
    expect(session.model).toBe("model-b");
    expect(session.provider).toBe("prov-b");
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "done" });
    expect(fb.calls).toBe(1);
  });

  it("rethrows the provider error unchanged when the chain is empty", async () => {
    const primary = scriptedAdapter("a", [null]);
    await expect(run(primary, [])).rejects.toThrow(/simulated provider error/);
  });

  it("does not fall over when the signal was aborted", async () => {
    const controller = new AbortController();
    const primary: ProviderAdapter = {
      id: "a",
      capabilities: { nativeToolCalling: "none", maxContextTokens: 1000, structuredOutput: true },
      chat(): AsyncIterable<ProviderStreamEvent> {
        controller.abort();
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error("aborted mid-stream")),
          }),
        };
      },
    };
    const backup = scriptedAdapter("b", [DONE]);
    const events: AgentEvent[] = [];
    const session = createSession({ cwd: "/tmp", provider: "prov-a", model: "model-a" });
    await expect(
      runAgentTurn({
        session,
        adapter: primary,
        userInput: "go",
        systemPrompt: "s",
        tools: registry(),
        gate: new AllowAllGate(),
        signal: controller.signal,
        failover: [failoverEntry(backup)],
        onEvent: (e) => events.push(e),
      }),
    ).rejects.toThrow();
    expect(events.some((e) => e.type === "model_fell_back")).toBe(false);
    expect(session.model).toBe("model-a");
  });

  it("falls over on a structured-envelope parse failure and drops the malformed completion", async () => {
    const primary = scriptedAdapter("a", ["not json, just prose"]);
    const backup = scriptedAdapter("b", [DONE]);

    const { events, session } = await run(primary, [failoverEntry(backup)]);

    expect(events.find((e) => e.type === "model_fell_back")).toMatchObject({
      reason: "unreliable_model",
    });
    // the primary's malformed completion never made it into history
    expect(session.messages.some((m) => m.content.includes("just prose"))).toBe(false);
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "done" });
  });

  it("falls over after the consecutive-parse-failure counter trips, and resets it", async () => {
    // free-text mode so the counter path (not the structured-parse path) runs
    const broken = '<tool_call name="read_file">\nnot json { [ }\n</tool_call>';
    const primary = scriptedAdapter("a", [broken, broken, broken, broken], { structured: false });
    const backup = scriptedAdapter("b", [DONE], { structured: true });

    const { events } = await run(primary, [failoverEntry(backup)]);

    expect(events.filter((e) => e.type === "model_fell_back")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "done" });
  });

  it("stops as unreliable_model once the chain is exhausted", async () => {
    const primary = scriptedAdapter("a", ["prose"]);
    const backup = scriptedAdapter("b", ["also prose"]);

    const { events } = await run(primary, [failoverEntry(backup)]);

    expect(events.filter((e) => e.type === "model_fell_back")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "unreliable_model" });
  });

  it("a failover does not consume a step", async () => {
    // maxSteps 2: primary errors on step 0, backup needs 2 good steps (READ then DONE)
    const primary = scriptedAdapter("a", [null]);
    const backup = scriptedAdapter("b", [READ, DONE]);

    const { events } = await run(primary, [failoverEntry(backup)], { maxSteps: 2 });

    expect(events.at(-1)).toEqual({ type: "agent_stop", reason: "done" });
  });

  it("rebuilds the system prompt for the fallback adapter's protocol", async () => {
    const seen: string[] = [];
    const primary = scriptedAdapter("a", [null]);
    const backup = scriptedAdapter("b", [DONE], {
      structured: true,
      onRequest: (r) => seen.push(r.messages[0]?.content ?? ""),
    });

    await run(primary, [failoverEntry(backup)]);

    expect(seen[0]).toBe("system-rebuilt structured=true");
  });
});
