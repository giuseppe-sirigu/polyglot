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
    max_tokens: request.maxOutputTokens ?? defaultMaxOutputTokens(request.model),
    temperature: request.temperature,
    stream: true,
  };
}

/** Output tokens asked for when the caller sets none. Room for a large file in one write_file call:
 * at 4,096 those were often cut off by the limit. Claude 3 and 3.5 models refuse a request above
 * their own maximum instead of capping it, so they keep theirs. */
export function defaultMaxOutputTokens(model: string): number {
  if (/^claude-3-(haiku|sonnet|opus)/.test(model)) return 4096;
  if (/^claude-3-5-/.test(model)) return 8192;
  return 16_384;
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
