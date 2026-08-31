import type { EngineConfig } from "../config/loader.js";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "../config/loader.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter, ProviderCapabilities, ProviderFactory } from "./types.js";

const registry = new Map<string, ProviderFactory>();

/** Registers a provider factory under `id` (matched against `EngineConfig.provider`). The
 * built-ins register themselves at the bottom of this file; this hook is exported so a test -
 * or, later, a plugin - can add another without editing the hard-coded branch this replaced. */
export function registerProvider(id: string, factory: ProviderFactory): void {
  registry.set(id, factory);
}

export function getRegisteredProviders(): string[] {
  return [...registry.keys()];
}

/** Applies only the *defined* keys of `overrides` over `base` - an `undefined` value (e.g. a
 * probe that couldn't determine one field) must not clobber the built-in default. */
function mergeCapabilities(
  base: ProviderCapabilities,
  overrides?: Partial<ProviderCapabilities>,
): ProviderCapabilities {
  return {
    nativeToolCalling: overrides?.nativeToolCalling ?? base.nativeToolCalling,
    maxContextTokens: overrides?.maxContextTokens ?? base.maxContextTokens,
    structuredOutput: overrides?.structuredOutput ?? base.structuredOutput,
  };
}

export function createProviderAdapter(
  config: EngineConfig,
  capabilityOverrides?: Partial<ProviderCapabilities>,
): ProviderAdapter {
  const factory = registry.get(config.provider);
  if (!factory) {
    throw new Error(
      `Unknown provider "${config.provider}". Registered providers: ${
        getRegisteredProviders().join(", ") || "(none)"
      }.`,
    );
  }
  return factory(config, capabilityOverrides);
}

registerProvider("anthropic", (config, overrides) => {
  if (!config.apiKey) {
    throw new Error("Anthropic provider requires an apiKey.");
  }
  return new AnthropicAdapter({
    apiKey: config.apiKey,
    capabilities: mergeCapabilities(
      { nativeToolCalling: "reliable", maxContextTokens: 200_000, structuredOutput: false },
      overrides,
    ),
  });
});

registerProvider("openai-compatible", (config, overrides) => {
  return new OpenAICompatibleAdapter({
    id: `openai-compatible:${config.baseURL ?? "default"}`,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    capabilities: mergeCapabilities(
      {
        nativeToolCalling: "unreliable",
        maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
        structuredOutput: config.structuredOutput === true,
      },
      overrides,
    ),
  });
});
