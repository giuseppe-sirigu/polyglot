import { describe, expect, it } from "vitest";
import { AllowAllGate } from "../permissions/gate.js";
import type { ChatRequest, ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { buildAgentTools } from "./build-agent-tools.js";
import { readFileTool } from "./read.js";

const fakeAdapter: ProviderAdapter = {
  id: "fake",
  capabilities: { nativeToolCalling: "none", maxContextTokens: 1000, structuredOutput: false },
  async *chat() {},
};

/** Records the model of every chat request and answers with a clean one-liner. */
function spyAdapter(): ProviderAdapter & { models: string[] } {
  const models: string[] = [];
  return {
    id: "spy",
    models,
    capabilities: { nativeToolCalling: "none", maxContextTokens: 1000, structuredOutput: false },
    async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
      models.push(request.model);
      yield { type: "text_delta", delta: "done." };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

const opts = {
  baseTools: [readFileTool],
  adapter: fakeAdapter,
  gate: new AllowAllGate(),
  model: "m",
  cwd: "/tmp",
};

const taskCtx = { cwd: "/tmp", sessionId: "s", signal: new AbortController().signal };
const taskInput = { description: "d", prompt: "p" };

describe("buildAgentTools subAgents gate", () => {
  it("includes the task tool by default", () => {
    expect(buildAgentTools(opts).names()).toContain("task");
  });

  it("omits the task tool entirely when subAgents is false", () => {
    const registry = buildAgentTools({ ...opts, subAgents: false });
    expect(registry.names()).not.toContain("task");
    expect(registry.get("task")).toBeUndefined();
  });

  it("keeps task when subAgents is explicitly true", () => {
    expect(buildAgentTools({ ...opts, subAgents: true }).names()).toContain("task");
  });
});

describe("buildAgentTools agent delegation tools", () => {
  const reviewer = {
    name: "reviewer",
    description: "reviews code",
    tools: ["read_file"],
    prompt: "You review code.",
    source: "reviewer.md",
  };

  it("registers an agent_<name> tool per agent definition, top level only", () => {
    const top = buildAgentTools({ ...opts, agents: [reviewer] });
    expect(top.names()).toContain("agent_reviewer");
    const nested = buildAgentTools({ ...opts, agents: [reviewer] }, 1);
    expect(nested.names()).not.toContain("agent_reviewer");
  });

  it("runs the delegated agent on the sub-agent model when set", async () => {
    const parent = spyAdapter();
    const sub = spyAdapter();
    const tools = buildAgentTools({
      ...opts,
      adapter: parent,
      model: "parent",
      subAgentAdapter: sub,
      subAgentModel: "cheap",
      agents: [reviewer],
    });
    await tools.get("agent_reviewer")?.execute({ prompt: "check src/" }, taskCtx);
    expect(parent.models).toEqual([]);
    expect(sub.models).toEqual(["cheap"]);
  });
});

describe("buildAgentTools sub-agent model override", () => {
  it("runs the sub-agent on the parent model when subAgentModel is unset", async () => {
    const spy = spyAdapter();
    const tools = buildAgentTools({ ...opts, adapter: spy, model: "parent" });
    await tools.get("task")?.execute(taskInput, taskCtx);
    expect(spy.models).toEqual(["parent"]);
  });

  it("runs the sub-agent on subAgentModel / subAgentAdapter when set", async () => {
    const parent = spyAdapter();
    const sub = spyAdapter();
    const tools = buildAgentTools({
      ...opts,
      adapter: parent,
      model: "parent",
      subAgentAdapter: sub,
      subAgentModel: "cheap",
    });
    await tools.get("task")?.execute(taskInput, taskCtx);
    expect(parent.models).toEqual([]);
    expect(sub.models).toEqual(["cheap"]);
  });

  it("propagates the override to nested sub-agents", async () => {
    const sub = spyAdapter();
    // depth-1 registry: a sub-agent that can itself delegate
    const nested = buildAgentTools(
      {
        ...opts,
        adapter: spyAdapter(),
        model: "parent",
        subAgentAdapter: sub,
        subAgentModel: "cheap",
      },
      1,
    );
    await nested.get("task")?.execute(taskInput, taskCtx);
    expect(sub.models).toEqual(["cheap"]);
  });
});
