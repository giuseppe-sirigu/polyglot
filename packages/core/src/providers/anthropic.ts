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

type MessageParams = Anthropic.MessageCreateParamsStreaming;

/**
 * Builds the streaming `messages.create` params. The system prompt (persona + project
 * instructions + tool docs) is sent as a single cached text block: it's identical on every
 * turn of a session, so from the second turn on it's a prompt-cache read (~0.1x input cost and
 * lower latency) instead of being re-billed in full. The API ignores `cache_control` when the
 * block is under the model's minimum cacheable size, so this is safe to always set.
 */
export function buildAnthropicRequest(request: ChatRequest): MessageParams {
  const systemText = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turnMessages = request.messages.filter((m) => m.role !== "system");

  return {
    model: request.model,
    system: systemText
      ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
      : undefined,
    messages: turnMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    max_tokens: request.maxOutputTokens ?? 4096,
    temperature: request.temperature,
    stream: true,
  };
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
    const stream = this.client.messages.stream(buildAnthropicRequest(request), {
      signal: opts.signal,
    });

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
    const u = finalMessage.usage;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    yield {
      type: "usage",
      // The full prompt the model saw, whether or not it was billed at the cache rate.
      inputTokens: u.input_tokens + cacheRead + cacheWrite,
      outputTokens: u.output_tokens,
      cachedInputTokens: cacheRead,
    };
    yield {
      type: "message_stop",
      stopReason: finalMessage.stop_reason === "max_tokens" ? "max_tokens" : "end_turn",
    };
  }
}
