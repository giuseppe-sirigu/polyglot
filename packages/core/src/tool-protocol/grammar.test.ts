import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../tools/types.js";
import { buildToolSystemPrompt } from "./grammar.js";

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `The ${name} tool.`,
    permission: "read",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    async execute() {
      return { ok: true, content: "", toModelText: () => "" };
    },
  };
}

const tools = [tool("read_file"), tool("bash")];

describe("buildToolSystemPrompt", () => {
  it("returns an empty string when there are no tools", () => {
    expect(buildToolSystemPrompt([], "/repo")).toBe("");
  });

  it("tells free-text-grammar models not to describe a tool call in prose", () => {
    const prompt = buildToolSystemPrompt(tools, "/repo");
    expect(prompt).toContain("Do not describe a tool call in prose instead of emitting it");
  });

  it("tells structured-mode models not to describe a tool call in the message field", () => {
    const prompt = buildToolSystemPrompt(tools, "/repo", undefined, { structured: true });
    expect(prompt).toContain('Do not describe a tool call in "message" instead of making it');
  });

  it("carries the plan-mode note explaining exit_plan_mode is the only way to get approval", () => {
    const prompt = buildToolSystemPrompt(tools, "/repo", "plan");
    expect(prompt).toContain("The ONLY way to present a plan for approval is to call");
    expect(prompt).toContain("exit_plan_mode");
    expect(buildToolSystemPrompt(tools, "/repo", "manual")).not.toContain("PLAN MODE");
  });
});
