import { describe, expect, it } from "vitest";
import { AllowAllGate, type PermissionGate } from "../permissions/gate.js";
import type { ParsedToolCall } from "../tool-protocol/types.js";
import { type ToolDefinition, ToolRegistry, textResult } from "../tools/types.js";
import { executeToolCall } from "./executor.js";

const echoTool: ToolDefinition = {
  name: "echo",
  description: "echo",
  permission: "read",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
  async execute(input) {
    return textResult(`echoed ${JSON.stringify(input)}`);
  },
};

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(echoTool);
  return r;
}

const call: ParsedToolCall = { id: "c1", name: "echo", input: { x: 1 }, raw: "" };
const ctx = { cwd: "/tmp", sessionId: "s1", signal: new AbortController().signal };

const denyGate: PermissionGate = {
  async evaluate() {
    return { decision: "deny", reason: "blocked by policy" };
  },
};

describe("executeToolCall permission reporting", () => {
  it("reports an allow decision when the gate allows and the tool runs", async () => {
    const executed = await executeToolCall(call, registry(), new AllowAllGate(), ctx);
    expect(executed.permission).toEqual({ decision: "allow" });
    expect(executed.isError).toBe(false);
  });

  it("reports the deny decision and reason when the gate blocks", async () => {
    const executed = await executeToolCall(call, registry(), denyGate, ctx);
    expect(executed.permission).toEqual({ decision: "deny", reason: "blocked by policy" });
    expect(executed.isError).toBe(true);
  });

  it("reports an unregistered tool as a deny", async () => {
    const executed = await executeToolCall(
      { ...call, name: "ghost" },
      registry(),
      new AllowAllGate(),
      ctx,
    );
    expect(executed.permission).toEqual({ decision: "deny", reason: "unknown tool" });
    expect(executed.isError).toBe(true);
  });
});
