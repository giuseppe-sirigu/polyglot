import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderStreamEvent,
} from "./types.js";

export interface AnthropicConfig {
  apiKey: string;
  capabilities: ProviderCapabilities;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = "anthropic";
  readonly capabilities: ProviderCapabilities;
  private readonly client: Anthropic;

  constructor(config: AnthropicConfig) {
    this.capabilities = config.capabilities;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async *chat(
    request: ChatRequest,
    opts: { signal: AbortSignal },
  ): AsyncIterable<ProviderStreamEvent> {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const turnMessages = request.messages.filter((m) => m.role !== "system");

    const stream = this.client.messages.stream(
      {
        model: request.model,
        system: systemMessages.map((m) => m.content).join("\n\n") || undefined,
        messages: turnMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        max_tokens: request.maxOutputTokens ?? 4096,
        temperature: request.temperature,
      },
      { signal: opts.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", delta: event.delta.text };
      }
      if (event.type === "message_delta") {
        if (event.delta.stop_reason === "max_tokens") {
          yield { type: "message_stop", stopReason: "max_tokens" };
        }
        if (event.usage) {
          yield {
            type: "usage",
            inputTokens: 0,
            outputTokens: event.usage.output_tokens,
          };
        }
      }
    }
    const finalMessage = await stream.finalMessage();
    yield {
      type: "usage",
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };
    yield {
      type: "message_stop",
      stopReason: finalMessage.stop_reason === "max_tokens" ? "max_tokens" : "end_turn",
    };
  }
}
