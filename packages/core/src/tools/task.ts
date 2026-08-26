import { runAgentTurn } from "../agent/loop.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { createSession } from "../session/types.js";
import { buildToolSystemPrompt } from "../tool-protocol/grammar.js";
import { type ToolDefinition, type ToolRegistry, textResult } from "./types.js";

export interface TaskToolConfig {
  adapter: ProviderAdapter;
  gate: PermissionGate;
  model: string;
  cwd: string;
  /** Builds a fresh tool registry for the sub-agent — recursively includes another
   * "task" tool if the caller's depth budget allows, or omits it at the depth limit. */
  buildSubTools: () => ToolRegistry;
  maxSteps?: number;
}

interface TaskInput {
  description: string;
  prompt: string;
}

export function createTaskTool(config: TaskToolConfig): ToolDefinition<TaskInput> {
  return {
    name: "task",
    description:
      "Delegate a self-contained sub-task to a fresh sub-agent that works autonomously and " +
      "reports back a result. Good for well-scoped, parallelizable work (e.g. investigating one " +
      "part of a codebase) — call it multiple times in one turn to run sub-agents in parallel.",
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
      const subSession = createSession({
        cwd: config.cwd,
        provider: "sub-agent",
        model: config.model,
      });
      const instructions =
        "Work autonomously, use tools as needed, and end with a concise final report of what you " +
        "found or did — that report is the only thing the orchestrating agent will see.";
      const systemPrompt = `You are a sub-agent handling: ${input.description}\n${instructions}\n\n${buildToolSystemPrompt(subTools.list(), config.cwd)}`;

      let finalText = "";
      let stopReason = "done";
      await runAgentTurn({
        session: subSession,
        adapter: config.adapter,
        userInput: input.prompt,
        systemPrompt,
        tools: subTools,
        gate: config.gate,
        signal: ctx.signal,
        maxSteps: config.maxSteps ?? 15,
        onEvent: (event) => {
          if (event.type === "text_delta") finalText += event.delta;
          if (event.type === "agent_stop") stopReason = event.reason;
        },
      });

      const note = stopReason === "done" ? "" : `\n\n[sub-agent stopped early: ${stopReason}]`;
      return textResult((finalText.trim() || "(sub-agent produced no text output)") + note);
    },
  };
}
