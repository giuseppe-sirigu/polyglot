import type { EngineConfig } from "../config/loader.js";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "../config/loader.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter } from "./types.js";

export function createProviderAdapter(config: EngineConfig): ProviderAdapter {
  if (config.provider === "anthropic") {
    if (!config.apiKey) {
      throw new Error("Anthropic provider requires an apiKey.");
    }
    return new AnthropicAdapter({
      apiKey: config.apiKey,
      capabilities: { nativeToolCalling: "reliable", maxContextTokens: 200_000 },
    });
  }

  return new OpenAICompatibleAdapter({
    id: `openai-compatible:${config.baseURL ?? "default"}`,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    capabilities: { nativeToolCalling: "unreliable", maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS },
  });
}
