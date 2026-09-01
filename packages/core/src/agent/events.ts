export type AgentEvent =
  | { type: "turn_start" }
  | { type: "text_delta"; delta: string }
  | { type: "turn_end"; stopReason: "end_turn" | "max_tokens" | "error" }
  | { type: "tool_call"; name: string; input: unknown; correctedFromName?: string }
  | { type: "tool_result"; name: string; resultText: string; isError: boolean }
  | { type: "permission_decision"; toolName: string; decision: "allow" | "deny"; reason?: string }
  | { type: "tool_parse_error"; attemptedName: string | null; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "agent_stop"; reason: "done" | "max_steps" | "unreliable_model" };
