export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached-read input tokens. Defaults to `input * CACHE_READ_MULTIPLIER`. */
  cachedInput?: number;
}

/** Anthropic prompt-cache reads are billed at ~0.1x the base input rate. Used as the fallback
 * when a table/override entry omits `cachedInput`. Cache *writes* (~1.25x) are folded into
 * `inputTokens` and billed at the base rate - the 0.25x write premium applies only to the
 * system block, once per ~5-min cache lifetime, so the rounding error is sub-cent. */
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Anthropic list prices, USD per 1M tokens (input / output). Refresh when Anthropic changes
 * pricing - the `claude-api` skill's model table is the source of truth. Local /
 * openai-compatible models are not here: they cost $0 unless the user adds a `pricing`
 * override in settings.json.
 */
export const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
};

/** Family fallback for an anthropic model id not in `PRICING_TABLE` (a newer point release, a
 * dated snapshot). Prefix-matched against the id. */
const FAMILY_FALLBACK: [prefix: string, pricing: ModelPricing][] = [
  ["claude-fable-", { input: 10, output: 50 }],
  ["claude-mythos-", { input: 10, output: 50 }],
  ["claude-opus-", { input: 5, output: 25 }],
  ["claude-sonnet-", { input: 3, output: 15 }],
  ["claude-haiku-", { input: 1, output: 5 }],
];

/**
 * Resolves per-token pricing for a model. `overrides` (from `settings.json`'s `pricing` map)
 * wins for any provider and any model id. Otherwise: anthropic models resolve to an exact
 * table hit, then a `claude-<tier>-` family fallback; openai-compatible models have no built-in
 * price. Returns `null` when the model is free (a local model with no override).
 */
export function resolveModelPricing(
  provider: "anthropic" | "openai-compatible",
  model: string,
  overrides: Record<string, ModelPricing> = {},
): ModelPricing | null {
  const override = overrides[model];
  if (override) return override;
  if (provider !== "anthropic") return null;
  const exact = PRICING_TABLE[model];
  if (exact) return exact;
  const family = FAMILY_FALLBACK.find(([prefix]) => model.startsWith(prefix));
  return family ? family[1] : null;
}

/** Estimated USD cost of one turn's token usage. `0` when `pricing` is null (free / local). */
export function computeCost(
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
  pricing: ModelPricing | null,
): number {
  if (!pricing) return 0;
  const cachedRate = pricing.cachedInput ?? pricing.input * CACHE_READ_MULTIPLIER;
  const cached = usage.cachedInputTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cached);
  return (
    (uncachedInput * pricing.input) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (usage.outputTokens * pricing.output) / 1_000_000
  );
}
