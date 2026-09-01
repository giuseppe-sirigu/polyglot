import { describe, expect, it } from "vitest";
import { AllowAllGate } from "../permissions/gate.js";
import type { ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { createTaskTool } from "./task.js";
import { ToolRegistry } from "./types.js";

function freeTextAdapter(responses: string[]): ProviderAdapter {
  let i = 0;
  return {
    id: "fake",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 100_000, structuredOutput: false },
    async *chat(): AsyncIterable<ProviderStreamEvent> {
      const text = responses[i++] ?? "";
      yield { type: "text_delta", delta: text };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

function taskTool(adapter: ProviderAdapter) {
  return createTaskTool({
    adapter,
    gate: new AllowAllGate(),
    model: "fake",
    cwd: "/tmp",
    buildSubTools: () => new ToolRegistry(),
    maxSteps: 5,
  });
}

const ctx = { cwd: "/tmp", sessionId: "s", signal: new AbortController().signal };
const input = { description: "d", prompt: "p" };
const BROKEN = '<tool_call name="edit_file">\nnot json { [ }\n</tool_call>';

describe("task tool result handling", () => {
  it("returns a terse error and discards the transcript when the sub-agent goes unreliable", async () => {
    const garbage = "<block>{ commands: [ { cmd: switch } ] }</block>";
    const adapter = freeTextAdapter([
      `${garbage}\n${BROKEN}`,
      `${garbage}\n${BROKEN}`,
      `${garbage}\n${BROKEN}`,
      `${garbage}\n${BROKEN}`,
    ]);

    const result = await taskTool(adapter).execute(input, ctx);
    const text = result.toModelText();

    expect(text).toContain("stopped producing valid output");
    expect(text).not.toContain("<block>");
    expect(text).not.toContain("commands");
  });

  it("truncates an oversized clean report", async () => {
    const adapter = freeTextAdapter(["A".repeat(9000)]);

    const result = await taskTool(adapter).execute(input, ctx);
    const text = result.toModelText();

    expect(text).toContain("[report truncated]");
    expect(text.length).toBeLessThan(4200);
  });
});
