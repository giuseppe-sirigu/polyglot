import { describe, expect, it } from "vitest";
import { buildToolSystemPrompt } from "../tool-protocol/grammar.js";
import type { ToolDefinition } from "../tools/types.js";
import { PERSONA, assembleSystemPrompt } from "./system-prompt.js";

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `The ${name} tool.`,
    permission: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return { ok: true, content: "", toModelText: () => "" };
    },
  };
}

const tools = [tool("read_file"), tool("bash"), tool("exit_plan_mode"), tool("ask_user_question")];

describe("assembleSystemPrompt", () => {
  it("matches the previous inline assembly (persona + buildToolSystemPrompt) outside plan mode", () => {
    const promptTools = tools.filter(
      (t) => t.name !== "exit_plan_mode" && t.name !== "ask_user_question",
    );
    const expected = `${PERSONA}\n\n${buildToolSystemPrompt(promptTools, "/repo", "manual", {
      structured: false,
    })}`;
    expect(assembleSystemPrompt({ tools, cwd: "/repo", mode: "manual", structured: false })).toBe(
      expected,
    );
  });

  it("advertises exit_plan_mode / ask_user_question only in plan mode", () => {
    const outside = assembleSystemPrompt({
      tools,
      cwd: "/repo",
      mode: "manual",
      structured: false,
    });
    expect(outside).not.toContain("### exit_plan_mode");
    expect(outside).not.toContain("### ask_user_question");

    const inPlan = assembleSystemPrompt({ tools, cwd: "/repo", mode: "plan", structured: false });
    expect(inPlan).toContain("### exit_plan_mode");
    expect(inPlan).toContain("### ask_user_question");
  });

  it("threads the structured flag through to the grammar", () => {
    const free = assembleSystemPrompt({ tools, cwd: "/repo", structured: false });
    const structured = assembleSystemPrompt({ tools, cwd: "/repo", structured: true });
    expect(free).toContain('<tool_call name="TOOL_NAME">');
    expect(structured).toContain("single JSON object matching this shape");
    expect(structured).not.toContain('<tool_call name="TOOL_NAME">');
  });

  it("is just the persona line when there are no tools", () => {
    expect(assembleSystemPrompt({ tools: [], cwd: "/repo", structured: false })).toBe(
      `${PERSONA}\n\n`,
    );
  });

  it("splices project instructions between the persona and the tool section", () => {
    const out = assembleSystemPrompt({
      tools,
      cwd: "/repo",
      mode: "manual",
      structured: false,
      projectInstructions: "Match the existing code style.",
    });
    expect(out).toContain("## Project instructions\n\nMatch the existing code style.");
    expect(out.indexOf(PERSONA)).toBeLessThan(out.indexOf("## Project instructions"));
    expect(out.indexOf("## Project instructions")).toBeLessThan(out.indexOf("## Tools"));
  });

  it("omits the instructions block when none provided or empty", () => {
    const none = assembleSystemPrompt({ tools, cwd: "/repo", structured: false });
    const empty = assembleSystemPrompt({
      tools,
      cwd: "/repo",
      structured: false,
      projectInstructions: "   ",
    });
    expect(none).not.toContain("## Project instructions");
    expect(empty).not.toContain("## Project instructions");
  });
});
