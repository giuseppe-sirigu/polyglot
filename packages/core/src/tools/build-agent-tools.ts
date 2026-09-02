import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { createTaskTool } from "./task.js";
import { type ToolDefinition, ToolRegistry } from "./types.js";

export interface BuildAgentToolsOptions {
  baseTools: ToolDefinition[];
  adapter: ProviderAdapter;
  gate: PermissionGate;
  model: string;
  cwd: string;
  /** Hard cap on sub-agent nesting (task calling task calling task...). */
  maxDepth?: number;
  /** Whether to include the `task` sub-agent tool at all. Default true. */
  subAgents?: boolean;
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

  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  if ((opts.subAgents ?? true) && depth < maxDepth) {
    registry.register(
      createTaskTool({
        adapter: opts.adapter,
        gate: opts.gate,
        model: opts.model,
        cwd: opts.cwd,
        buildSubTools: () => buildAgentTools(opts, depth + 1),
      }),
    );
  }

  return registry;
}
