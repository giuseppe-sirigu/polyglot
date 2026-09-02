import { describe, expect, it } from "vitest";
import { runScenario } from "./agent-scenario.js";
import { invariants } from "./invariants.js";

function xmlCall(name: string, args: Record<string, unknown>): string {
  return `<tool_call name="${name}">\n${JSON.stringify(args)}\n</tool_call>`;
}

describe("runScenario", () => {
  it("seeds a real working dir from a fixture and reflects a scripted edit", async () => {
    const r = await runScenario({
      fixture: "todo-demo",
      userInput: "add a count subcommand",
      model: [
        xmlCall("edit_file", {
          path: "todo.mjs",
          old_string: "usage: todo <add|done|list>",
          new_string: "usage: todo <add|done|list|count>",
        }),
        "Done - added the count subcommand.",
      ],
    });

    expect(r.stopReason).toBe("done");
    expect(r.workFileChanged("todo.mjs")).toBe(true);
    expect(r.readWorkFile("todo.mjs")).toContain("<add|done|list|count>");
    expect(r.countToolCalls("edit_file")).toBe(1);
    invariants.resultsPairedToCalls(r);
    invariants.honestCompletion(r);
    invariants.noRunaway(r);
  });

  it("surfaces a bad tool call as a parse error the model sees", async () => {
    const r = await runScenario({
      fixture: "todo-demo",
      userInput: "go",
      model: [
        '<tool_call name="edit_file">\nnot json at all { [ }\n</tool_call>',
        '<tool_call name="edit_file">\nstill { broken\n</tool_call>',
        "I can't seem to format this - can you paste the code yourself?",
      ],
    });

    expect(r.parseErrors.length).toBeGreaterThanOrEqual(1);
    expect(r.resultsSeenByModel.join("\n")).toMatch(/could not be parsed as JSON/);
    // give-up in prose after parse errors must not read as "done"
    expect(r.stopReason).toBe("unreliable_model");
    expect(() => invariants.honestCompletion(r)).not.toThrow();
  });

  it("aborts a runaway model via the call budget instead of hanging", async () => {
    const readForever = xmlCall("read_file", { path: "todo.mjs" });
    const r = await runScenario({
      fixture: "todo-demo",
      userInput: "loop",
      model: Array.from({ length: 50 }, () => readForever),
      budget: { modelCalls: 5 },
    });

    expect(r.abortedByBudget).toBe(true);
    expect(r.modelCallCount).toBeLessThanOrEqual(6);
    expect(() => invariants.noRunaway(r)).toThrow(/runaway/);
  });

  it("gives every tool_result a toolCallId matching an earlier tool_call, even in a multi-call step", async () => {
    const r = await runScenario({
      fixture: "todo-demo",
      userInput: "edit and re-read",
      model: [
        `${xmlCall("edit_file", {
          path: "todo.mjs",
          old_string: "usage: todo <add|done|list>",
          new_string: "usage: todo <add|done|list|count>",
        })}\n${xmlCall("read_file", { path: "todo.mjs" })}`,
        "Both done.",
      ],
    });

    expect(r.toolResults.map((x) => x.name).sort()).toEqual(["edit_file", "read_file"]);
    const callIds = new Set(r.toolCalls.map((c) => c.toolCallId));
    for (const res of r.toolResults) expect(callIds.has(res.toolCallId)).toBe(true);
    invariants.resultsPairedToCalls(r);
  });

  it("caps sub-agent spawns per turn no matter how often the model calls task", async () => {
    const taskCall = xmlCall("task", { description: "sub", prompt: "do a thing" });
    const r = await runScenario({
      fixture: "todo-demo",
      userInput: "delegate everything",
      subAgents: true,
      model: [...Array.from({ length: 10 }, () => taskCall), "ok all delegated"],
    });

    // task tool_call events can be many; actual spawns must be ≤ the default budget (3).
    invariants.subAgentSpawnsBounded(r, 3);
    invariants.noRunaway(r);
    const denied = r.events.filter(
      (e) => e.type === "permission_decision" && e.toolName === "task" && e.decision === "deny",
    );
    expect(denied.length).toBeGreaterThan(0);
    expect(r.resultsSeenByModel.join("\n")).toMatch(/Sub-agent budget for this turn is exhausted/);
  });

  it("drives a tool call from a structured JSON envelope", async () => {
    const r = await runScenario({
      fixture: "todo-demo",
      userInput: "read it",
      structured: true,
      model: [
        JSON.stringify({
          message: "",
          tool_calls: [{ name: "read_file", arguments: { path: "todo.mjs" } }],
        }),
        JSON.stringify({ message: "It's a small CLI todo app.", tool_calls: [] }),
      ],
    });

    expect(r.countToolCalls("read_file")).toBe(1);
    expect(r.toolResults[0]?.resultText).toContain("switch (cmd)");
    expect(r.stopReason).toBe("done");
    expect(r.finalAssistantText).toBe("It's a small CLI todo app.");
  });
});
