import { type ModelPricing, computeCost, resolveModelPricing } from "../pricing/pricing.js";

export interface ModelUsageTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

export interface SessionUsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  /** Per-model breakdown, keyed by model id - a session that switched models has several. */
  byModel: Record<string, ModelUsageTotals>;
}

/** One turn's provider-reported token usage, plus the model that produced it. */
export interface TurnUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** Pre-computed at record time so historical lines keep the price they were billed at even
   * if the pricing table later changes. */
  costUSD: number;
}

export function emptyUsageTotals(): SessionUsageTotals {
  return { inputTokens: 0, outputTokens: 0, costUSD: 0, byModel: {} };
}

/** Folds one turn's usage into a running total. Pure - returns a new object. */
export function addTurnUsage(acc: SessionUsageTotals, turn: TurnUsage): SessionUsageTotals {
  const prior = acc.byModel[turn.model] ?? {
    model: turn.model,
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0,
  };
  return {
    inputTokens: acc.inputTokens + turn.inputTokens,
    outputTokens: acc.outputTokens + turn.outputTokens,
    costUSD: acc.costUSD + turn.costUSD,
    byModel: {
      ...acc.byModel,
      [turn.model]: {
        model: turn.model,
        inputTokens: prior.inputTokens + turn.inputTokens,
        outputTokens: prior.outputTokens + turn.outputTokens,
        costUSD: prior.costUSD + turn.costUSD,
      },
    },
  };
}

/**
 * Builds a `TurnUsage` for a `usage` agent event: resolves the model's price (with the config
 * `pricing` overrides) and computes the turn's cost once, at record time.
 */
export function turnUsageFromEvent(
  event: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
  ctx: {
    provider: "anthropic" | "openai-compatible";
    model: string;
    overrides?: Record<string, ModelPricing>;
  },
): TurnUsage {
  const pricing = resolveModelPricing(ctx.provider, ctx.model, ctx.overrides);
  return {
    model: ctx.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    ...(event.cachedInputTokens !== undefined
      ? { cachedInputTokens: event.cachedInputTokens }
      : {}),
    costUSD: computeCost(event, pricing),
  };
}
