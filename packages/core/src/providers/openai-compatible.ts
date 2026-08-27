import OpenAI from "openai";
import { ENVELOPE_SCHEMA_NAME } from "../tool-protocol/structured-schema.js";
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderStreamEvent,
} from "./types.js";

export interface OpenAICompatibleConfig {
  id: string;
  baseURL?: string;
  apiKey?: string;
  capabilities: ProviderCapabilities;
}

/** Extracted as a standalone pure function so request-shape can be unit-tested without mocking
 * the OpenAI SDK's client. */
export function buildOpenAIRequestBody(
  request: ChatRequest,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
  return {
    model: request.model,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: request.temperature,
    max_tokens: request.maxOutputTokens,
    stream: true,
    // Ask the server to include a final usage chunk in the stream — without this most
    // OpenAI-compatible backends (llama.cpp, vLLM, LM Studio, Ollama) omit token counts from
    // streamed responses entirely. Servers that don't support it just ignore the field.
    stream_options: { include_usage: true },
    response_format: request.responseSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: ENVELOPE_SCHEMA_NAME,
            schema: request.responseSchema,
            strict: true,
          },
        }
      : undefined,
  };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  private readonly client: OpenAI;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.capabilities = config.capabilities;
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey ?? "not-needed",
    });
  }

  async *chat(
    request: ChatRequest,
    opts: { signal: AbortSignal },
  ): AsyncIterable<ProviderStreamEvent> {
    const stream = await this.client.chat.completions.create(buildOpenAIRequestBody(request), {
      signal: opts.signal,
    });

    let stopReason: "end_turn" | "max_tokens" | "error" = "end_turn";
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        yield { type: "text_delta", delta };
      }
      if (choice?.finish_reason === "length") {
        stopReason = "max_tokens";
      }
      const usage = chunk.usage;
      if (usage) {
        yield {
          type: "usage",
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
        };
      }
    }
    yield { type: "message_stop", stopReason };
  }
}
