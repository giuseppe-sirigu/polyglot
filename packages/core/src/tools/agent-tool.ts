import { runSubAgent } from "../agent/sub-agent.js";
import type { AgentDefinition } from "../config/agents.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { buildToolSystemPrompt } from "../tool-protocol/grammar.js";
import { type ToolDefinition, ToolRegistry, textResult } from "./types.js";

export interface AgentToolConfig {
  adapter: ProviderAdapter;
  model: string;
  gate: PermissionGate;
  cwd: string;
  /** The tools an agent may use (its own `tools` allowlist is intersected with these). Never
   * includes `task` or other `agent_*` tools - a delegated agent doesn't sub-delegate. */
  baseTools: ToolDefinition[];
  maxSteps?: number;
}

const MAX_REPORT_CHARS = 4000;

/**
 * Wraps an agent definition as a `agent_<name>` tool the main model can call to hand a
 * sub-task to that agent (its pinned prompt / tool allowlist). The one-shot direct form
 * (`@name <task>` typed as the whole message) is handled in the CLI; this is the model-driven
 * delegation form.
 */
export function createAgentTool(agent: AgentDefinition, config: AgentToolConfig): ToolDefinition {
  const registry = new ToolRegistry();
  for (const tool of config.baseTools) registry.register(tool);
  const allowed = agent.tools ? registry.subset(agent.tools) : registry;

  return {
    name: `agent_${agent.name}`,
    description: `Delegate a sub-task to the "${agent.name}" agent${
      agent.description ? `: ${agent.description}` : ""
    }. It works autonomously and reports back a result.`,
    permission: "execute",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The full task for the agent to carry out." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const { prompt } = input as { prompt: string };
      const systemPrompt = `You are the "${agent.name}" agent.\n${agent.prompt}\n\n${buildToolSystemPrompt(
        allowed.list(),
        config.cwd,
        undefined,
        { structured: config.adapter.capabilities.structuredOutput },
      )}`;

      const { text, stopReason } = await runSubAgent({
        adapter: config.adapter,
        model: config.model,
        gate: config.gate,
        cwd: config.cwd,
        systemPrompt,
        userInput: prompt,
        tools: allowed,
        maxSteps: config.maxSteps ?? 15,
        signal: ctx.signal,
      });

      if (stopReason === "unreliable_model") {
        return textResult(
          `The "${agent.name}" agent's model stopped producing valid output. Do this yourself instead.`,
        );
      }
      const report =
        text.length > MAX_REPORT_CHARS
          ? `${text.slice(0, MAX_REPORT_CHARS)}\n\n[report truncated]`
          : text;
      const note = stopReason === "done" ? "" : `\n\n[agent stopped early: ${stopReason}]`;
      return textResult((report || "(agent produced no text output)") + note);
    },
  };
}
