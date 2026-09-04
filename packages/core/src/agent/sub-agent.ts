import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import { createSession } from "../session/types.js";
import type { ToolRegistry } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { runAgentTurn } from "./loop.js";

export interface RunSubAgentOptions {
  adapter: ProviderAdapter;
  model: string;
  /** Session `provider` field for the sub-run (default `"sub-agent"`). */
  provider?: string;
  gate: PermissionGate;
  cwd: string;
  /** The fully-assembled system prompt for the sub-agent. */
  systemPrompt: string;
  userInput: string;
  tools: ToolRegistry;
  maxSteps?: number;
  signal: AbortSignal;
  /** Every event from the sub-run - so a caller can stream text / tool activity / usage. */
  onEvent?: (event: AgentEvent) => void;
}

export interface SubAgentResult {
  /** Concatenated `text_delta` output, trimmed. */
  text: string;
  stopReason: "done" | "max_steps" | "unreliable_model";
}

/**
 * Runs one self-contained sub-agent turn to completion in a fresh session and returns its
 * final text. Shared by the `task` tool (model-driven delegation) and the CLI's `@agent`
 * path (user-driven invocation).
 */
export async function runSubAgent(opts: RunSubAgentOptions): Promise<SubAgentResult> {
  const session = createSession({
    cwd: opts.cwd,
    provider: opts.provider ?? "sub-agent",
    model: opts.model,
  });

  let text = "";
  let stopReason: SubAgentResult["stopReason"] = "done";

  await runAgentTurn({
    session,
    adapter: opts.adapter,
    userInput: opts.userInput,
    systemPrompt: opts.systemPrompt,
    tools: opts.tools,
    gate: opts.gate,
    signal: opts.signal,
    maxSteps: opts.maxSteps ?? 15,
    onEvent: (event) => {
      if (event.type === "text_delta") text += event.delta;
      if (event.type === "agent_stop") stopReason = event.reason;
      opts.onEvent?.(event);
    },
  });

  return { text: text.trim(), stopReason };
}
