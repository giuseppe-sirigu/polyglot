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
    // Ask the server to include a final usage chunk in the stream - without this most
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

/**
 * Renders natively-emitted tool calls as the `<tool_call>` envelopes the agent loop parses, so a
 * model that answers through the native `tool_calls` channel (gpt-oss via Ollama does, even when
 * no `tools` are declared) is handled exactly like one that follows the text grammar. Arguments
 * are passed through as-is; the resolver repairs and validates them like any other body.
 */
export function renderNativeToolCalls(calls: { name: string; arguments: string }[]): string {
  return calls
    .filter((c) => c.name.length > 0)
    .map((c) => `\n<tool_call name="${c.name}">\n${c.arguments.trim() || "{}"}\n</tool_call>\n`)
    .join("");
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
    // Native tool calls stream as fragments keyed by index: the name arrives once, the
    // arguments in pieces. Accumulated here and emitted as text once the stream ends.
    const nativeCalls: { name: string; arguments: string }[] = [];
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        yield { type: "text_delta", delta };
      }
      for (const call of choice?.delta?.tool_calls ?? []) {
        const slot = nativeCalls[call.index] ?? { name: "", arguments: "" };
        nativeCalls[call.index] = slot;
        if (call.function?.name) slot.name += call.function.name;
        if (call.function?.arguments) slot.arguments += call.function.arguments;
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
    const rendered = renderNativeToolCalls(nativeCalls.filter(Boolean));
    if (rendered) yield { type: "text_delta", delta: rendered };
    yield { type: "message_stop", stopReason };
  }
}
