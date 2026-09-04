import { runSubAgent } from "../agent/sub-agent.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { buildToolSystemPrompt } from "../tool-protocol/grammar.js";
import { type ToolDefinition, type ToolRegistry, textResult } from "./types.js";

export interface TaskToolConfig {
  adapter: ProviderAdapter;
  gate: PermissionGate;
  model: string;
  cwd: string;
  /** `AGENTS.md` / `POLYGLOT.md` contents - a sub-agent editing the same repo follows the
   * same project conventions as the parent. */
  projectInstructions?: string;
  /** Builds a fresh tool registry for the sub-agent - recursively includes another
   * "task" tool if the caller's depth budget allows, or omits it at the depth limit. */
  buildSubTools: () => ToolRegistry;
  maxSteps?: number;
  /** Forwards each sub-agent turn's token usage to the caller so its cost (on `model`, which
   * may be a cheaper sub-agent model) rolls into the parent session's totals. */
  onSubAgentUsage?: (u: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  }) => void;
}

interface TaskInput {
  description: string;
  prompt: string;
}

/** Cap on how much of the sub-agent's report is fed back into the orchestrator's context - a
 * runaway or repetitive sub-agent must not be able to blow up the parent's context (or, worse,
 * prime the parent with its own broken output format). */
const MAX_REPORT_CHARS = 4000;

export function createTaskTool(config: TaskToolConfig): ToolDefinition<TaskInput> {
  return {
    name: "task",
    description:
      "Delegate a self-contained sub-task to a fresh sub-agent that works autonomously and " +
      "reports back a result. Good for well-scoped, parallelizable work (e.g. investigating one " +
      "part of a codebase) - call it multiple times in one turn to run sub-agents in parallel.",
    permission: "execute",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short label for this sub-task (for logging).",
        },
        prompt: { type: "string", description: "The full task for the sub-agent to carry out." },
      },
      required: ["description", "prompt"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const subTools = config.buildSubTools();
      const instructions =
        "Work autonomously, use tools as needed, and end with a concise final report of what you " +
        "found or did - that report is the only thing the orchestrating agent will see.";
      const projectBlock = config.projectInstructions?.trim()
        ? `\n\n## Project instructions\n\n${config.projectInstructions.trim()}`
        : "";
      const systemPrompt = `You are a sub-agent handling: ${input.description}\n${instructions}${projectBlock}\n\n${buildToolSystemPrompt(subTools.list(), config.cwd, undefined, { structured: config.adapter.capabilities.structuredOutput })}`;

      const { text: finalText, stopReason } = await runSubAgent({
        adapter: config.adapter,
        model: config.model,
        gate: config.gate,
        cwd: config.cwd,
        systemPrompt,
        userInput: input.prompt,
        tools: subTools,
        maxSteps: config.maxSteps ?? 15,
        signal: ctx.signal,
        onEvent: (event) => {
          if (event.type === "usage" && event.inputTokens > 0) {
            config.onSubAgentUsage?.({
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              ...(event.cachedInputTokens !== undefined
                ? { cachedInputTokens: event.cachedInputTokens }
                : {}),
            });
          }
        },
      });

      // A sub-agent whose model went unreliable produced no usable result, only noise - don't
      // hand that noise back to the orchestrator.
      if (stopReason === "unreliable_model") {
        return textResult(
          "The sub-agent's model stopped producing valid output before it could report a " +
            "result. Do this task yourself with read_file / edit_file instead of delegating.",
        );
      }

      const report = finalText.trim();
      const truncated =
        report.length > MAX_REPORT_CHARS
          ? `${report.slice(0, MAX_REPORT_CHARS)}\n\n[report truncated]`
          : report;
      const note = stopReason === "done" ? "" : `\n\n[sub-agent stopped early: ${stopReason}]`;
      return textResult((truncated || "(sub-agent produced no text output)") + note);
    },
  };
}
