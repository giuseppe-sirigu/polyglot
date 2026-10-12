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

describe("buildToolSystemPrompt - the tool's full schema", () => {
  const job: ToolDefinition = {
    ...tool("schedule_job"),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^[a-z_]+$" },
        priority: { type: "string", enum: ["low", "high"] },
        retries: { type: "integer", minimum: 0, maximum: 5 },
        tags: { type: "array", items: { type: "string" }, maxItems: 3 },
        payload: {
          type: "object",
          properties: {
            queue: { type: "string", description: "Queue name" },
            delay: { type: ["integer", "null"] },
          },
          required: ["queue"],
        },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["name", "priority", "payload"],
    },
  };
  const prompt = buildToolSystemPrompt([job], "/repo");

  it("shows allowed values, item types, nested objects and limits", () => {
    expect(prompt).toContain("  name: string; // must match /^[a-z_]+$/");
    expect(prompt).toContain('  priority: "low" | "high";');
    expect(prompt).toContain("  retries?: integer; // minimum 0; maximum 5");
    expect(prompt).toContain("  tags?: string[]; // at most 3 items");
    expect(prompt).toContain(
      "  payload: {\n    queue: string; // Queue name\n    delay?: integer | null;\n  };",
    );
    expect(prompt).toContain("  headers?: Record<string, string>;");
  });

  it("gives an example call that fits the schema", () => {
    const example = prompt.slice(prompt.indexOf('<tool_call name="schedule_job">'));
    const args = JSON.parse(example.split("\n")[1] ?? "{}") as Record<string, unknown>;
    expect(args.priority).toBe("low");
    expect(args.retries).toBe(0);
    expect(args.tags).toEqual(["example"]);
    expect(args.payload).toEqual({ queue: "example", delay: 1 });
  });
});
