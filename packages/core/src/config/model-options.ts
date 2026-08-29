import type { EngineConfig } from "./loader.js";
import { resolveApiKey } from "./loader.js";
import type { ModelEntry } from "./schema.js";

/** Fills in an entry's `apiKey` (via the same provider-conditional env var resolution
 * loadConfig() uses for the top-level engine) and default `baseURL` for openai-compatible, so
 * the result can be passed straight to createProviderAdapter().
 *
 * `defaults` carries the resolved top-level settings so a `/model` switch keeps whatever the
 * session started with unless the entry overrides it - mirroring loadConfig()'s "per-model
 * field wins, else top-level" merge. Without this, switching models silently drops a top-level
 * `structuredOutput: true` (entries rarely repeat it) and falls back to free-text tool calling. */
export function resolveEngineConfigForModel(
  entry: ModelEntry,
  env: NodeJS.ProcessEnv = process.env,
  defaults?: { structuredOutput?: boolean },
): EngineConfig {
  return {
    provider: entry.provider,
    model: entry.model,
    baseURL:
      entry.provider === "openai-compatible"
        ? (entry.baseURL ?? "http://localhost:11434/v1")
        : undefined,
    apiKey: resolveApiKey(entry.provider, entry.apiKey, env),
    structuredOutput:
      entry.provider === "openai-compatible"
        ? (entry.structuredOutput ?? defaults?.structuredOutput)
        : undefined,
  };
}

export interface ModelOption {
  provider: "anthropic" | "openai-compatible";
  model: string;
  label: string;
  /** True for the synthetic option representing whatever the session actually started with -
   * always listed first, even when not itself present in `models[]`. */
  isCurrent: boolean;
  /** Undefined only for the synthetic current-model option. */
  entry?: ModelEntry;
}

/** Builds the full list `/model` shows: every entry in `entries`, with whichever one matches
 * `current` (by provider+model) flagged `isCurrent`. If none matches - the session started on a
 * model that isn't itself configured - a synthetic current entry is prepended instead, the same
 * as before. Entries are never duplicated: once you've switched to a configured model, it's the
 * "current" row rather than getting a second synthetic copy of itself. */
export function listModelOptions(
  current: { provider: "anthropic" | "openai-compatible"; model: string; label?: string },
  entries: ModelEntry[],
): ModelOption[] {
  const rest: ModelOption[] = entries.map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    label: entry.label ?? entry.model,
    isCurrent: entry.provider === current.provider && entry.model === current.model,
    entry,
  }));
  if (rest.some((o) => o.isCurrent)) return rest;

  const currentOption: ModelOption = {
    provider: current.provider,
    model: current.model,
    label: current.label ?? current.model,
    isCurrent: true,
  };
  return [currentOption, ...rest];
}

/** Matches a `/model <query>` argument against the option list: an exact `model` id match wins
 * first, then a case-insensitive substring match against `model` or `label`. Returns the first
 * hit, or null if nothing matches. */
export function findModelOption(query: string, options: ModelOption[]): ModelOption | null {
  const exact = options.find((o) => o.model === query);
  if (exact) return exact;

  const needle = query.toLowerCase();
  return (
    options.find(
      (o) => o.model.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle),
    ) ?? null
  );
}
