export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export type ProviderStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_stop"; stopReason: "end_turn" | "max_tokens" | "error" }
  | { type: "usage"; inputTokens: number; outputTokens: number };

export interface ProviderCapabilities {
  nativeToolCalling: "reliable" | "unreliable" | "none";
  maxContextTokens: number;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ProviderStreamEvent>;
}
