import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../agent/events.js";
import type { ScenarioResult } from "./agent-scenario.js";
import {
  honestCompletion,
  noRunaway,
  resultsPairedToCalls,
  shellFailuresSurfaced,
  subAgentSpawnsBounded,
} from "./invariants.js";

/** Minimal ScenarioResult with just the fields an invariant reads; the rest are stubs. */
function fakeResult(over: Partial<ScenarioResult>): ScenarioResult {
  return {
    events: [],
    session: { id: "s", cwd: "/", provider: "x", model: "m", messages: [] },
    cwd: "/",
    stopReason: "done",
    abortedByBudget: false,
    modelCallCount: 1,
    completions: [],
    toolCalls: [],
    toolResults: [],
    parseErrors: [],
    resultsSeenByModel: [],
    finalAssistantText: "",
    finalFiles: {},
    countToolCalls: () => 0,
    readWorkFile: () => null,
    workFileChanged: () => false,
    ...over,
  };
}

describe("noRunaway", () => {
  it("passes when the run finished inside budget", () => {
    expect(() => noRunaway(fakeResult({ abortedByBudget: false }))).not.toThrow();
  });
  it("throws when a budget tripped", () => {
    expect(() => noRunaway(fakeResult({ abortedByBudget: true }))).toThrow(/runaway/);
  });
});

describe("honestCompletion", () => {
  it("passes for a normal finish", () => {
    expect(() =>
      honestCompletion(fakeResult({ finalAssistantText: "Added the count command." })),
    ).not.toThrow();
  });
  it("throws when the model hands the work back to the user", () => {
    expect(() =>
      honestCompletion(
        fakeResult({
          finalAssistantText: "I couldn't format this - can you paste the code yourself?",
        }),
      ),
    ).toThrow(/hands the work back/);
  });
  it("ignores a non-done stop reason", () => {
    expect(() =>
      honestCompletion(
        fakeResult({ stopReason: "unreliable_model", finalAssistantText: "do it yourself" }),
      ),
    ).not.toThrow();
  });
});

describe("shellFailuresSurfaced", () => {
  it("passes when a shell failure is reported as an error", () => {
    expect(() =>
      shellFailuresSurfaced(
        fakeResult({
          toolResults: [
            {
              toolCallId: "1",
              name: "bash",
              resultText: "bash: nope: command not found",
              isError: true,
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
  it("throws when a shell failure is reported as success (pipefail masking)", () => {
    expect(() =>
      shellFailuresSurfaced(
        fakeResult({
          toolResults: [
            {
              toolCallId: "1",
              name: "bash",
              resultText: "0\nbash: count: command not found",
              isError: false,
            },
          ],
        }),
      ),
    ).toThrow(/marked success but the shell failed/);
  });
});

describe("resultsPairedToCalls", () => {
  it("passes when every result follows a call with the same id", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", toolCallId: "a", name: "read_file", input: {} },
      { type: "tool_call", toolCallId: "b", name: "edit_file", input: {} },
      { type: "tool_result", toolCallId: "b", name: "edit_file", resultText: "ok", isError: false },
      { type: "tool_result", toolCallId: "a", name: "read_file", resultText: "ok", isError: false },
    ];
    expect(() => resultsPairedToCalls(fakeResult({ events }))).not.toThrow();
  });
  it("throws on a result with no matching call", () => {
    const events: AgentEvent[] = [
      { type: "tool_result", toolCallId: "z", name: "edit_file", resultText: "ok", isError: false },
    ];
    expect(() => resultsPairedToCalls(fakeResult({ events }))).toThrow(/no preceding tool_call/);
  });
});

describe("subAgentSpawnsBounded", () => {
  const spawn = (id: string): AgentEvent => ({
    type: "permission_decision",
    toolCallId: id,
    toolName: "task",
    decision: "allow",
  });
  it("passes at the cap", () => {
    expect(() =>
      subAgentSpawnsBounded(fakeResult({ events: [spawn("1"), spawn("2"), spawn("3")] }), 3),
    ).not.toThrow();
  });
  it("throws past the cap", () => {
    expect(() =>
      subAgentSpawnsBounded(
        fakeResult({ events: [spawn("1"), spawn("2"), spawn("3"), spawn("4")] }),
        3,
      ),
    ).toThrow(/sub-agents spawned/);
  });
  it("doesn't count denied task calls", () => {
    const denied: AgentEvent = {
      type: "permission_decision",
      toolCallId: "x",
      toolName: "task",
      decision: "deny",
    };
    expect(() =>
      subAgentSpawnsBounded(fakeResult({ events: [spawn("1"), denied, denied, denied] }), 3),
    ).not.toThrow();
  });
});
