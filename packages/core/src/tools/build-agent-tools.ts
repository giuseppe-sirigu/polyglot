import type { AgentDefinition } from "../config/agents.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { createAgentTool } from "./agent-tool.js";
import { createTaskTool } from "./task.js";
import { type ToolDefinition, ToolRegistry } from "./types.js";

export interface BuildAgentToolsOptions {
  baseTools: ToolDefinition[];
  adapter: ProviderAdapter;
  gate: PermissionGate;
  model: string;
  cwd: string;
  /** Agent definitions to expose as `agent_<name>` delegation tools the model can call.
   * Only registered at the top level - a sub-agent never gets them, so no nested delegation.
   * Their pinned `model` is not honoured here (delegate runs on the sub-agent / active model);
   * the first-token `@name` invoke path does honour it. */
  agents?: AgentDefinition[];
  /** Hard cap on sub-agent nesting (task calling task calling task...). */
  maxDepth?: number;
  /** Whether to include the `task` sub-agent tool at all. Default true. */
  subAgents?: boolean;
  /** `AGENTS.md` / `POLYGLOT.md` contents - passed to sub-agents so they follow the same
   * project conventions as the parent. */
  projectInstructions?: string;
  /** Run `task` sub-agents on a different model than the parent. Both must be set; when unset,
   * sub-agents use `adapter` / `model`. The recursive `buildSubTools` closure recaptures
   * `opts`, so this applies at every nesting depth. */
  subAgentAdapter?: ProviderAdapter;
  subAgentModel?: string;
  /** Called with a sub-agent turn's token usage (the caller knows which model produced it -
   * see App.tsx / headless.ts) so sub-agent cost rolls into the parent session's totals. */
  onSubAgentUsage?: (u: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  }) => void;
}

const DEFAULT_MAX_DEPTH = 3;

/**
 * Builds a tool registry containing the base tools plus a "task" sub-agent tool -
 * recursively, so a sub-agent can itself delegate further, up to maxDepth. At the
 * depth limit, "task" is simply omitted: a sub-agent there has no way to recurse
 * further, so runaway sub-agent spawning is bounded by construction. `subAgents: false`
 * omits "task" entirely (registry and system prompt).
 */
export function buildAgentTools(opts: BuildAgentToolsOptions, depth = 0): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of opts.baseTools) registry.register(tool);

  if (depth === 0 && opts.agents) {
    for (const agent of opts.agents) {
      registry.register(
        createAgentTool(agent, {
          adapter: opts.subAgentAdapter ?? opts.adapter,
          model: opts.subAgentModel ?? opts.model,
          gate: opts.gate,
          cwd: opts.cwd,
          baseTools: opts.baseTools,
        }),
      );
    }
  }

  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  if ((opts.subAgents ?? true) && depth < maxDepth) {
    registry.register(
      createTaskTool({
        adapter: opts.subAgentAdapter ?? opts.adapter,
        gate: opts.gate,
        model: opts.subAgentModel ?? opts.model,
        cwd: opts.cwd,
        projectInstructions: opts.projectInstructions,
        onSubAgentUsage: opts.onSubAgentUsage,
        buildSubTools: () => buildAgentTools(opts, depth + 1),
      }),
    );
  }

  return registry;
}
