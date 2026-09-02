import type { SessionUsageTotals } from "./usage-accounting.js";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface Session {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  messages: Message[];
  /** Set via /rename - undefined until the user gives the session a name. */
  name?: string;
  /** Most recent known size of the full prompt (system + tool docs + history), in tokens -
   * the provider-measured input-token count from the last turn's usage. Undefined before the
   * first turn and immediately after compaction; callers fall back to estimateSessionTokens(). */
  lastContextTokens?: number;
  /** Cumulative token + estimated-cost totals for the session, per model. Undefined until the
   * first turn reports usage; restored by loadSession from the persisted turn_usage lines. */
  usage?: SessionUsageTotals;
}

export function createSession(params: { cwd: string; provider: string; model: string }): Session {
  return {
    id: crypto.randomUUID(),
    cwd: params.cwd,
    provider: params.provider,
    model: params.model,
    messages: [],
  };
}
