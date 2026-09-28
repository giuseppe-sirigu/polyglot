import type { ModelEntry } from "../config/schema.js";
import type { ScenarioBudget } from "./agent-scenario.js";

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
];

/**
 * Heavy, hardware-constrained scale-check models - deliberately kept OUT of
 * `SCENARIO_MODELS` so they never run as part of the unconditional default matrix.
 * Reachable only via an explicit `SCENARIO_MODELS=<model>` filter (see
 * `scripts/scenario-matrix.ts`'s `selectModels()`, which searches this array too once a
 * filter is given).
 *
 * Why this split exists (found the hard way, 2026-09-28): with `qwen2.5-coder:32b` briefly
 * living in the main array, a full default-matrix run interleaved it with the five fast
 * models - each switch meant Ollama swapping a 21GB, partially CPU-offloaded model in and
 * out of VRAM. The result was materially worse than testing 32B alone: the same scenarios
 * that hit `noRunaway` at 2-10 of the 40-call budget in isolation hit it at 10-24 calls when
 * interleaved. Testing a slow model back-to-back with fast ones doesn't just take longer, it
 * changes the result - so it needs its own explicit, isolated run, not a spot in the default
 * sweep every release gate triggers.
 */
export const SCENARIO_SCALE_CHECK_MODELS: ScenarioModelEntry[] = [
  // Added 2026-09-25 to test whether the tool-call-repair gap (see the qwen2.5-coder
  // 7B/14B numbers above and the published benchmark) narrows or closes at larger
  // scale within the same model family.
  {
    provider: "openai-compatible",
    model: "qwen2.5-coder:32b",
    baseURL: "http://localhost:11434/v1",
    label: "Qwen 2.5 Coder 32B (scale check)",
    // Checked 2026-09-27 after the same pattern surfaced on qwen3.8-27b-toolfix: every single
    // captured 32B failure was noRunaway, and every one at 2-10 of the 40-call budget - nowhere
    // near the call cap, so it can only have been the 60s wall clock. 32B is partially
    // CPU-offloaded on 16GB VRAM (confirmed via `ollama ps`), same root cause as the 27B model.
    // Only accurate when run in isolation - see the module-level comment above.
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
    // limiting factor. Only accurate when run in isolation - see the module-level comment above.
    budget: { wallMs: 300_000 },
  },
];
