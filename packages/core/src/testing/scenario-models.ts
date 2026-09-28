import type { ScenarioBudget } from "./agent-scenario.js";
import type { ModelEntry } from "../config/schema.js";

/**
 * A `ModelEntry` plus scenario-matrix-only extras. `budget` is an optional per-model override
 * of the scenario's default model-call/wall-clock budget - for a model that's genuinely slower
 * on this hardware (larger, partially CPU-offloaded, or generating extra reasoning tokens per
 * turn) rather than actually unreliable, the default 60s wall clock (calibrated against fast
 * 7B/14B models) can trip `noRunaway` before a real, on-track run finishes. Bumping wallMs for
 * that one model keeps the test fair without loosening the budget for every other model.
 */
export type ScenarioModelEntry = ModelEntry & { label?: string; budget?: ScenarioBudget };

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
export const SCENARIO_MODELS: ScenarioModelEntry[] = [
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
  // Added 2026-09-25 to test whether the tool-call-repair gap (see the qwen2.5-coder
  // 7B/14B numbers above and the published benchmark) narrows or closes at larger
  // scale within the same model family - not yet run as part of the default matrix,
  // reachable via `SCENARIO_MODELS=qwen2.5-coder:32b`.
  {
    provider: "openai-compatible",
    model: "qwen2.5-coder:32b",
    baseURL: "http://localhost:11434/v1",
    label: "Qwen 2.5 Coder 32B (scale check)",
    // Checked 2026-09-27 after the same pattern surfaced on qwen3.8-27b-toolfix: every single
    // captured 32B failure was noRunaway, and every one at 2-10 of the 40-call budget - nowhere
    // near the call cap, so it can only have been the 60s wall clock. 32B is partially
    // CPU-offloaded on 16GB VRAM (confirmed via `ollama ps`), same root cause as the 27B model.
    budget: { wallMs: 300_000 },
  },
  // A second, different-family scale check, for the same reason - only meaningful if
  // the 32B result above is itself interesting enough to warrant checking generality.
  {
    provider: "openai-compatible",
    model: "llama3.3:70b",
    baseURL: "http://localhost:11434/v1",
    label: "Llama 3.3 70B (scale check, different family)",
  },
  // Added 2026-09-26 - a current-generation (Aug 2026), 27B model, tested to see whether
  // a genuinely newer release closes the tool-call reliability gap rather than just a
  // bigger model within the same older family. Requires a local Ollama model named
  // "qwen3.8-27b-toolfix" with a custom Modelfile (the official Unsloth GGUF's bundled
  // template omits tool-calling support entirely) - see polyglot-benchmarks/harness.
  {
    provider: "openai-compatible",
    model: "qwen3.8-27b-toolfix",
    baseURL: "http://localhost:11434/v1",
    label: "Qwen 3.8 27B (current-gen check)",
    // 27B, partially CPU-offloaded on 16GB VRAM, plus this model reasons (<think>) before every
    // action - real per-call latency is well above what the 60s default assumes. Confirmed live
    // 2026-09-26: locate-and-fix hit noRunaway at only 8/40 model calls (nowhere near the call
    // cap), mid a genuinely correct, on-track fix - the wall clock, not the model, was the
    // limiting factor.
    budget: { wallMs: 300_000 },
  },
];
