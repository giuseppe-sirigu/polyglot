import type { AgentDefinition } from "@usepolyglot/core";

export interface AgentInvocation {
  agent: AgentDefinition;
  /** The task text after `@<name>`. */
  rest: string;
}

// `@<name> <rest>` at the very start of the message. `<name>` is the agent-def name grammar.
const INVOKE_RE = /^@([a-z0-9][a-z0-9_-]*)\s+([\s\S]+)$/;

/**
 * Detects a first-token agent invocation: `@reviewer look at src/`. Returns the matched agent
 * and the remaining task text, or null when the message doesn't start with `@<known-agent> `.
 */
export function resolveAgentInvocation(
  text: string,
  agents: AgentDefinition[],
): AgentInvocation | null {
  const m = text.match(INVOKE_RE);
  if (!m) return null;
  const [, name, rawRest] = m;
  const agent = agents.find((a) => a.name === name);
  const rest = rawRest?.trim() ?? "";
  if (!agent || !rest) return null;
  return { agent, rest };
}
