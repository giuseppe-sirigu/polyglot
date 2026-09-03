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

/** Yields one clean text reply plus a usage event per turn, cycling through `usages`. */
function usageAdapter(usages: { inputTokens: number; outputTokens: number }[]): ProviderAdapter {
  let i = 0;
  return {
    id: "fake",
    capabilities: { nativeToolCalling: "none", maxContextTokens: 100_000, structuredOutput: false },
    async *chat(): AsyncIterable<ProviderStreamEvent> {
      const u = usages[i++] ?? { inputTokens: 0, outputTokens: 0 };
      yield { type: "text_delta", delta: "done." };
      yield { type: "usage", inputTokens: u.inputTokens, outputTokens: u.outputTokens };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

function taskTool(adapter: ProviderAdapter, extra?: Partial<Parameters<typeof createTaskTool>[0]>) {
  return createTaskTool({
    adapter,
    gate: new AllowAllGate(),
    model: "fake",
    cwd: "/tmp",
    buildSubTools: () => new ToolRegistry(),
    maxSteps: 5,
    ...extra,
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

describe("task tool sub-agent usage forwarding", () => {
  it("forwards the sub-agent turn's token usage to onSubAgentUsage", async () => {
    const seen: { inputTokens: number; outputTokens: number }[] = [];
    const adapter = usageAdapter([{ inputTokens: 1200, outputTokens: 90 }]);

    await taskTool(adapter, { onSubAgentUsage: (u) => seen.push(u) }).execute(input, ctx);

    expect(seen).toEqual([{ inputTokens: 1200, outputTokens: 90 }]);
  });

  it("does not call onSubAgentUsage when the sub-agent reports no usage", async () => {
    const seen: unknown[] = [];
    const adapter = freeTextAdapter(["all done"]);

    await taskTool(adapter, { onSubAgentUsage: (u) => seen.push(u) }).execute(input, ctx);

    expect(seen).toHaveLength(0);
  });
});
