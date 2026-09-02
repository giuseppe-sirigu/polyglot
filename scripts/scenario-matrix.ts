#!/usr/bin/env tsx
/**
 * Live scenario matrix: runs every scenario in the suite against every configured model and
 * prints, per scenario, a `model x invariant` table plus a taskDone column.
 *
 * This is a DISCOVERY tool, not a CI gate - weak models are expected to fail invariants on hard
 * tasks. What matters is the diff from the previous run (a previously-passing pair now failing =
 * a regression) and the captured transcripts (promote into scripted fixture tests).
 *
 *   pnpm scenario:live
 *   SCENARIO_MODELS=llama3.2:3b pnpm scenario:live
 *   SCENARIO_BASE_URL=http://box:11434/v1 SCENARIO_INCLUDE_ANTHROPIC=1 pnpm scenario:live
 *
 * Needs a reachable inference server (Ollama etc.). Unreachable models are skipped.
 * Failure transcripts -> packages/core/src/testing/captured-failures/ (git-ignored).
 * One summary line per run -> scenario-results.jsonl (git-ignored).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EngineConfig,
  type ModelEntry,
  createProviderAdapter,
  resolveEngineConfigForModel,
} from "../packages/core/src/index.js";
import { SCENARIO_MODELS } from "../packages/core/src/testing/scenario-models.js";
import { runScenarioAgainst } from "../packages/core/src/testing/scenario-runner.js";
import { SCENARIOS } from "../packages/core/src/testing/scenarios.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE_DIR = join(REPO_ROOT, "packages/core/src/testing/captured-failures");
const RESULTS_LOG = join(REPO_ROOT, "scenario-results.jsonl");

function selectModels(): (ModelEntry & { label?: string })[] {
  let models: (ModelEntry & { label?: string })[] = [...SCENARIO_MODELS];

  const only = process.env.SCENARIO_MODELS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (only && only.length > 0) {
    const base = (s: string) => s.split(":")[0];
    models = models.filter((m) => only.some((t) => base(t) === base(m.model)));
  }

  const baseOverride = process.env.SCENARIO_BASE_URL;
  if (baseOverride) {
    models = models.map((m) =>
      m.provider === "openai-compatible" ? { ...m, baseURL: baseOverride } : m,
    );
  }

  if (process.env.SCENARIO_INCLUDE_ANTHROPIC === "1") {
    models.unshift({
      provider: "anthropic",
      model: "claude-opus-5",
      label: "Claude Opus 5 (baseline)",
    });
  }
  return models;
}

const CHECK = "✓";
const CROSS = "✗";
const DASH = "—";

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

type Reachability = "ok" | "endpoint-down" | "not-pulled";

async function probeReachable(config: EngineConfig): Promise<Reachability> {
  if (config.provider !== "openai-compatible" || !config.baseURL) return "ok"; // anthropic: assume ok
  try {
    const res = await fetch(`${config.baseURL.replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(4000),
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
    });
    if (!res.ok) return "endpoint-down";
    const body = (await res.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map((m) => m.id ?? "");
    const base = (s: string) => s.split(":")[0];
    // Ollama resolves a bare name to `:latest`, so a base-name match is enough.
    return ids.some((id) => base(id) === base(config.model)) ? "ok" : "not-pulled";
  } catch {
    return "endpoint-down";
  }
}

async function main() {
  const models = selectModels();
  if (models.length === 0) {
    console.error("No models to run (check scenario-models.ts / SCENARIO_MODELS).");
    process.exit(1);
  }
  mkdirSync(CAPTURE_DIR, { recursive: true });

  const runStamp = new Date().toISOString();
  const summary: Record<
    string,
    Record<string, { taskDone: boolean; failed: string[]; skipped?: boolean }>
  > = {};
  let captured = 0;

  for (const scenario of SCENARIOS) {
    const invNames = scenario.invariants.map((i) => i.name);
    const colW = Math.max(12, ...invNames.map((n) => n.length));
    const labelW = Math.max(20, ...models.map((m) => (m.label ?? m.model).length));

    console.log(`\n── ${scenario.name} ──  ${scenario.description}`);
    console.log(
      `  ${pad("model", labelW)}  ${invNames.map((n) => pad(n, colW)).join("  ")}  taskDone`,
    );

    for (const entry of models) {
      const label = entry.label ?? entry.model;
      const config = resolveEngineConfigForModel(entry);
      summary[scenario.name] ??= {};

      const reach = await probeReachable(config);
      if (reach !== "ok") {
        summary[scenario.name][entry.model] = { taskDone: false, failed: [], skipped: true };
        const why = reach === "not-pulled" ? "not pulled" : "endpoint down";
        console.log(`  ${pad(label, labelW)}  (${why} - skipped)`);
        continue;
      }

      let adapter: ReturnType<typeof createProviderAdapter>;
      try {
        adapter = createProviderAdapter(config);
      } catch (err) {
        summary[scenario.name][entry.model] = {
          taskDone: false,
          failed: ["adapter"],
          skipped: true,
        };
        console.log(`  ${pad(label, labelW)}  adapter error: ${(err as Error).message}`);
        continue;
      }

      const outcome = await runScenarioAgainst(scenario, adapter, { modelId: entry.model });
      const cells = invNames.map((n) => {
        const r = outcome.invariantResults.find((x) => x.name === n);
        if (!r) return pad(DASH, colW);
        return pad(r.status === "pass" ? CHECK : CROSS, colW);
      });
      const doneCell = outcome.aborted ? "abort" : outcome.taskDone ? CHECK : CROSS;
      console.log(`  ${pad(label, labelW)}  ${cells.join("  ")}  ${pad(doneCell, 8)}`);

      const failed = outcome.invariantResults.filter((r) => r.status === "fail").map((r) => r.name);
      summary[scenario.name][entry.model] = { taskDone: outcome.taskDone, failed };

      if (failed.length > 0 || outcome.aborted || outcome.error) {
        const file = join(
          CAPTURE_DIR,
          `${entry.model.replace(/[^\w.-]/g, "_")}__${scenario.name}__${runStamp.replace(/[:.]/g, "-")}.json`,
        );
        writeFileSync(
          file,
          `${JSON.stringify(
            {
              at: runStamp,
              model: entry.model,
              scenario: scenario.name,
              userInput: scenario.userInput,
              stopReason: outcome.stopReason,
              aborted: outcome.aborted,
              error: outcome.error,
              failedInvariants: outcome.invariantResults.filter((r) => r.status === "fail"),
              completions: outcome.transcript.completions,
              resultsSeenByModel: outcome.transcript.resultsSeenByModel,
              finalAssistantText: outcome.transcript.finalAssistantText,
              events: outcome.transcript.events,
            },
            null,
            2,
          )}\n`,
        );
        captured += 1;
      }
    }
  }

  appendFileSync(
    RESULTS_LOG,
    `${JSON.stringify({ at: runStamp, models: models.map((m) => m.model), summary })}\n`,
  );

  let done = 0;
  let attempted = 0;
  for (const perModel of Object.values(summary)) {
    for (const cell of Object.values(perModel)) {
      if (cell.skipped) continue;
      attempted += 1;
      if (cell.taskDone) done += 1;
    }
  }
  console.log(
    `\ntaskDone ${done}/${attempted} · ${captured} failure transcript(s) in ` +
      `${CAPTURE_DIR.replace(`${REPO_ROOT}/`, "")} · summary → scenario-results.jsonl`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
