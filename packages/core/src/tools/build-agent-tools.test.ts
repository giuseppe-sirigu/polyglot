import { describe, expect, it } from "vitest";
import { AllowAllGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { buildAgentTools } from "./build-agent-tools.js";
import { readFileTool } from "./read.js";

const fakeAdapter: ProviderAdapter = {
  id: "fake",
  capabilities: { nativeToolCalling: "none", maxContextTokens: 1000, structuredOutput: false },
  async *chat() {},
};

const opts = {
  baseTools: [readFileTool],
  adapter: fakeAdapter,
  gate: new AllowAllGate(),
  model: "m",
  cwd: "/tmp",
};

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
