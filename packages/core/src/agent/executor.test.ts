import { describe, expect, it } from "vitest";
import { AllowAllGate, type PermissionGate } from "../permissions/gate.js";
import { scanContent } from "../permissions/secret-patterns.js";
import type { ParsedToolCall } from "../tool-protocol/types.js";
import { type ToolDefinition, ToolRegistry, textResult } from "../tools/types.js";
import { type ScanToolOutput, executeToolCall } from "./executor.js";

const echoTool: ToolDefinition = {
  name: "echo",
  description: "echo",
  permission: "read",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
  async execute(input) {
    return textResult(`echoed ${JSON.stringify(input)}`);
  },
};

const leakyTool: ToolDefinition = {
  name: "leaky",
  description: "leaks a key",
  permission: "read",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
  async execute() {
    return textResult("here it is: AKIAIOSFODNN7EXAMPLE done");
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

describe("executeToolCall content scanning", () => {
  const reg = () => {
    const r = new ToolRegistry();
    r.register(leakyTool);
    return r;
  };
  const leakyCall: ParsedToolCall = { id: "c2", name: "leaky", input: {}, raw: "" };

  const warnScan: ScanToolOutput = ({ text }) => ({
    ...scanContent(text, { redact: false }),
    redacted: false,
  });
  const redactScan: ScanToolOutput = ({ text }) => ({
    ...scanContent(text, { redact: true }),
    redacted: true,
  });

  it("passes the result through untouched when no scanner is set", async () => {
    const executed = await executeToolCall(leakyCall, reg(), new AllowAllGate(), ctx);
    expect(executed.resultText).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(executed.findings).toBeUndefined();
  });

  it("warn mode: leaves resultText intact but records findings", async () => {
    const executed = await executeToolCall(leakyCall, reg(), new AllowAllGate(), {
      ...ctx,
      scanOutput: warnScan,
    });
    expect(executed.resultText).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(executed.findings).toEqual([{ label: "aws-key", count: 1 }]);
    expect(executed.redacted).toBe(false);
  });

  it("redact mode: scrubs resultText and records findings", async () => {
    const executed = await executeToolCall(leakyCall, reg(), new AllowAllGate(), {
      ...ctx,
      scanOutput: redactScan,
    });
    expect(executed.resultText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(executed.resultText).toContain("[redacted:aws-key]");
    expect(executed.findings).toEqual([{ label: "aws-key", count: 1 }]);
    expect(executed.redacted).toBe(true);
  });

  it("no findings on clean output means no findings field", async () => {
    const executed = await executeToolCall(call, registry(), new AllowAllGate(), {
      ...ctx,
      scanOutput: warnScan,
    });
    expect(executed.findings).toBeUndefined();
  });
});
