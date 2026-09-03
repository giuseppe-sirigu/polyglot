import {
  type ModelEntry,
  type ProviderAdapter,
  type ResolvedConfig,
  createProviderAdapter,
  findModelOption,
  listModelOptions,
  resolveEngineConfigForModel,
} from "@usepolyglot/core";

/** The `/model`-selectable entries: `resolved.models` plus the startup engine (which isn't
 * necessarily one of them), so routing/failover/sub-agent lookups can always name the model the
 * session started on. Shared by App.tsx and headless.ts. */
export function configuredModelEntries(resolved: ResolvedConfig): ModelEntry[] {
  const startup: ModelEntry = {
    provider: resolved.engine.provider,
    model: resolved.engine.model,
    label: resolved.engine.model,
    baseURL: resolved.engine.baseURL,
    apiKey: resolved.engine.apiKey,
    structuredOutput: resolved.engine.structuredOutput,
  };
  const alreadyListed = resolved.models.some(
    (m) => m.provider === startup.provider && m.model === startup.model,
  );
  return alreadyListed ? resolved.models : [startup, ...resolved.models];
}

export interface ResolvedModel {
  adapter: ProviderAdapter;
  model: string;
  provider: "anthropic" | "openai-compatible";
  label: string;
}

export interface ModelResolutionContext {
  /** The `/model`-selectable entries (see App.tsx `modelEntries` - includes the startup model). */
  modelEntries: ModelEntry[];
  /** The model currently running - a query that resolves to it returns `current` unchanged. */
  current: ResolvedModel;
  /** Resolved top-level settings, so an entry that omits `structuredOutput` inherits it. */
  defaults: { structuredOutput?: boolean };
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves a model id or `/model`-style label (from `subAgentModel`, `routing.failover`, …) to a
 * ready-to-use adapter. Returns `null` when the query matches nothing configured - callers fall
 * back to the parent model and warn.
 *
 * Note: an openai-compatible target is not capability-probed here, so it inherits the registry
 * defaults (128k context, structuredOutput from config only) - the same gap a runtime `/model`
 * switch has. A6's failover chain adds probing; the sub-agent model does not (yet).
 */
export function resolveConfiguredModel(
  query: string,
  ctx: ModelResolutionContext,
): ResolvedModel | null {
  const options = listModelOptions(
    { provider: ctx.current.provider, model: ctx.current.model, label: ctx.current.label },
    ctx.modelEntries,
  );
  const match = findModelOption(query, options);
  if (!match) return null;
  // The synthetic "current" option (or an entry that is the running model) - no new adapter.
  if (match.isCurrent || !match.entry) return ctx.current;

  const engine = resolveEngineConfigForModel(match.entry, ctx.env ?? process.env, ctx.defaults);
  try {
    return {
      adapter: createProviderAdapter(engine),
      model: match.model,
      provider: match.provider,
      label: match.label,
    };
  } catch {
    return null;
  }
}
