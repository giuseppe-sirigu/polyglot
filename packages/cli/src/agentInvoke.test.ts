import type { AgentDefinition } from "@usepolyglot/core";
import { describe, expect, it } from "vitest";
import { resolveAgentInvocation } from "./agentInvoke.js";

function agent(name: string): AgentDefinition {
  return { name, description: "", prompt: "p", source: `${name}.md` };
}

const agents = [agent("reviewer"), agent("test-runner")];

describe("resolveAgentInvocation", () => {
  it("matches `@name <task>` at the start of a message", () => {
    const inv = resolveAgentInvocation("@reviewer look at src/", agents);
    expect(inv?.agent.name).toBe("reviewer");
    expect(inv?.rest).toBe("look at src/");
  });

  it("trims the task text and spans newlines", () => {
    const inv = resolveAgentInvocation("@reviewer  line one\nline two  ", agents);
    expect(inv?.rest).toBe("line one\nline two");
  });

  it("accepts hyphenated agent names", () => {
    expect(resolveAgentInvocation("@test-runner run all", agents)?.agent.name).toBe("test-runner");
  });

  it("returns null for an unknown agent name", () => {
    expect(resolveAgentInvocation("@nobody do a thing", agents)).toBeNull();
  });

  it("returns null when there is no task after the name", () => {
    expect(resolveAgentInvocation("@reviewer", agents)).toBeNull();
    expect(resolveAgentInvocation("@reviewer   ", agents)).toBeNull();
  });

  it("returns null when `@name` is not the first token", () => {
    expect(resolveAgentInvocation("hey @reviewer look", agents)).toBeNull();
  });

  it("returns null with no agents configured", () => {
    expect(resolveAgentInvocation("@reviewer look", [])).toBeNull();
  });
});
