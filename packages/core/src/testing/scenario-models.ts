import type { ModelEntry } from "../config/schema.js";

/**
 * Models the live scenario matrix (`pnpm scenario:live`) runs against. Each entry is a settings
 * `ModelEntry` plus an optional display `label`. This is the default set; override per run:
 *
 *   SCENARIO_MODELS=llama3.2:3b,qwen3-coder   comma-separated `model` ids to run just those
 *   SCENARIO_BASE_URL=http://box:11434/v1     override baseURL for every openai-compatible row
 *   SCENARIO_INCLUDE_ANTHROPIC=1              add a claude-opus-5 baseline (needs ANTHROPIC_API_KEY)
 *
 * A key for an openai-compatible endpoint, if one is needed, comes from `POLYGLOT_API_KEY` in
 * the environment - never checked in here. Unreachable / not-pulled models are skipped.
 */
export const SCENARIO_MODELS: (ModelEntry & { label?: string })[] = [
  {
    provider: "openai-compatible",
    model: "llama3.2:3b",
    baseURL: "http://localhost:11434/v1",
    label: "Llama 3.2 3B (weak baseline)",
  },
  {
    provider: "openai-compatible",
    model: "qwen2.5-coder:7b",
    baseURL: "http://localhost:11434/v1",
    label: "Qwen 2.5 Coder 7B (common first pick)",
  },
  {
    provider: "openai-compatible",
    model: "qwen2.5-coder:14b",
    baseURL: "http://localhost:11434/v1",
    label: "Qwen 2.5 Coder 14B",
  },
  {
    provider: "openai-compatible",
    model: "qwen3-coder",
    baseURL: "http://localhost:11434/v1",
    label: "Qwen 3 Coder",
  },
  {
    provider: "openai-compatible",
    model: "gpt-oss:20b",
    baseURL: "http://localhost:11434/v1",
    label: "gpt-oss 20B",
  },
];
