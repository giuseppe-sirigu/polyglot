import type { EngineConfig } from "../config/loader.js";
import type { JsonSchema } from "../tools/types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** When set, the provider should constrain the entire completion to this JSON Schema
   * (grammar/schema-constrained decoding). Only honored by adapters whose capabilities
   * advertise `structuredOutput: true`. */
  responseSchema?: JsonSchema;
}

export type ProviderStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_stop"; stopReason: "end_turn" | "max_tokens" | "error" }
  // `inputTokens` is the full prompt size (including any cached portion); `cachedInputTokens`
  // is the subset that was a prompt-cache read, priced at ~0.1x - see pricing/computeCost.
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
    };

export interface ProviderCapabilities {
  nativeToolCalling: "reliable" | "unreliable" | "none";
  maxContextTokens: number;
  /** True when this adapter should be sent a `responseSchema` for grammar/schema-constrained
   * decoding instead of relying on the free-text `<tool_call>` tag protocol. Decided once at
   * adapter construction (see providers/registry.ts), not per-call. */
  structuredOutput: boolean;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ProviderStreamEvent>;
}

/** Builds an adapter for one `EngineConfig`. `capabilityOverrides` (only the defined keys)
 * are applied over the factory's built-in defaults - used to feed in results from a live
 * capability probe (see providers/probe.ts). Register with `registerProvider` in
 * providers/registry.ts. */
export type ProviderFactory = (
  config: EngineConfig,
  capabilityOverrides?: Partial<ProviderCapabilities>,
) => ProviderAdapter;
