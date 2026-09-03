export type AgentEvent =
  | { type: "turn_start" }
  | { type: "text_delta"; delta: string }
  | { type: "turn_end"; stopReason: "end_turn" | "max_tokens" | "error" }
  // `toolCallId` correlates a call with its result / permission decision / parse error, even
  // when several calls in one step execute concurrently and their results interleave.
  | {
      type: "tool_call";
      toolCallId: string;
      name: string;
      input: unknown;
      correctedFromName?: string;
      /** Set when the model's raw output needed repair to resolve (malformed JSON, a wrapper,
       * args pulled out by name, a fuzzy tool name). `rawCall` is the verbatim block. */
      repaired?: boolean;
      rawCall?: string;
    }
  | { type: "tool_result"; toolCallId: string; name: string; resultText: string; isError: boolean }
  | {
      type: "permission_decision";
      toolCallId: string;
      toolName: string;
      decision: "allow" | "deny";
      reason?: string;
    }
  | { type: "tool_parse_error"; toolCallId: string; attemptedName: string | null; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedInputTokens?: number }
  | { type: "agent_stop"; reason: "done" | "max_steps" | "unreliable_model" };
