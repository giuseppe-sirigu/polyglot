#!/usr/bin/env tsx
/**
 * Longitudinal view of the scenario matrix. Reads every run recorded in scenario-results.jsonl
 * (written by `pnpm scenario:live`) and, per `scenario x model x invariant`, prints the
 * pass/fail sequence as a sparkline plus a rolling regression rate - the "is this a real
 * regression or weak-model noise?" question answered across releases instead of one run at a
 * time.
 *
 *   pnpm scenario:history                 all scenarios
 *   pnpm scenario:history read-and-report  one scenario
 *
 * scenario-results.jsonl is a git-ignored local artifact; this reads it, writes nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../packages/core/src/testing/scenarios.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS_LOG = join(REPO_ROOT, "scenario-results.jsonl");
const MAX_RUNS = 50;

type Cell = { taskDone: boolean; failed: string[]; skipped?: boolean };
type RunSummary = Record<string, Record<string, Cell>>;
type Run = { at: string; models: string[]; summary: RunSummary };

function readRuns(): Run[] {
  let raw: string;
  try {
    raw = readFileSync(RESULTS_LOG, "utf8");
  } catch {
    console.error(`No ${RESULTS_LOG} yet - run \`pnpm scenario:live\` first.`);
    process.exit(1);
  }
  const runs = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Run);
  return runs.slice(-MAX_RUNS);
}

/** A row of `✓`/`✗`/`·` (skipped/absent) across runs, oldest to newest. */
function sequence(runs: Run[], scenario: string, model: string, invariant: string | null): string {
  return runs
    .map((run) => {
      const cell = run.summary[scenario]?.[model];
      if (!cell || cell.skipped) return "·";
      if (invariant === null) return cell.taskDone ? "✓" : "✗";
      return cell.failed.includes(invariant) ? "✗" : "✓";
    })
    .join("");
}

/** ✓→✗ transitions (regressions) and ✗→✓ (recoveries) over the real (non-`·`) points. */
function transitions(seq: string): { regressions: number; recoveries: number; flips: number } {
  const points = [...seq].filter((c) => c === "✓" || c === "✗");
  let regressions = 0;
  let recoveries = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1] === "✓" && points[i] === "✗") regressions++;
    else if (points[i - 1] === "✗" && points[i] === "✓") recoveries++;
  }
  return { regressions, recoveries, flips: regressions + recoveries };
}

function main(): void {
  const filter = process.argv[2];
  const runs = readRuns();
  if (runs.length === 0) {
    console.error("scenario-results.jsonl is empty.");
    process.exit(1);
  }

  const scenarios = SCENARIOS.filter((s) => !filter || s.name === filter);
  if (scenarios.length === 0) {
    console.error(
      `No scenario named "${filter}". Known: ${SCENARIOS.map((s) => s.name).join(", ")}.`,
    );
    process.exit(1);
  }

  const first = runs[0]?.at.slice(0, 10);
  const last = runs.at(-1)?.at.slice(0, 10);
  console.log(`Scenario history - ${runs.length} run(s), ${first} → ${last}\n`);

  let totalRegressions = 0;
  let flappyRows = 0;

  for (const scenario of scenarios) {
    const models = new Set<string>();
    for (const run of runs) {
      for (const m of Object.keys(run.summary[scenario.name] ?? {})) models.add(m);
    }
    if (models.size === 0) continue;

    console.log(`## ${scenario.name}`);
    const invNames = [...scenario.invariants.map((i) => i.name), null];
    for (const model of [...models].sort()) {
      for (const inv of invNames) {
        const seq = sequence(runs, scenario.name, model, inv);
        if (!seq.includes("✓") && !seq.includes("✗")) continue;
        const { regressions, recoveries, flips } = transitions(seq);
        const label = inv ?? "taskDone";
        // taskDone drifts freely on weak models - it's shown for context but doesn't count
        // toward the regression rate or the flappy tally, which are about invariants.
        const isInvariant = inv !== null;
        if (isInvariant) totalRegressions += regressions;
        const tags: string[] = [];
        if (isInvariant && flips >= 2) {
          tags.push("flappy");
          flappyRows++;
        }
        const points = [...seq].filter((c) => c === "✓" || c === "✗");
        if (isInvariant && points.length >= 2 && points.at(-1) === "✗" && points.at(-2) === "✓") {
          tags.push("REGRESSED last run");
        }
        const trailingFail =
          isInvariant &&
          points.length >= 2 &&
          points.at(-1) === "✗" &&
          !points.slice(0, -1).includes("✗");
        if (trailingFail) tags.push("regressed and stayed");
        const suffix = tags.length
          ? `  <- ${tags.join(", ")}`
          : isInvariant && recoveries
            ? "  (recovered)"
            : "";
        console.log(`  ${model.padEnd(22)} ${label.padEnd(20)} ${seq}${suffix}`);
      }
    }
    console.log("");
  }

  const comparablePairs = runs.length - 1;
  const rate = comparablePairs > 0 ? (totalRegressions / comparablePairs).toFixed(2) : "n/a";
  console.log(
    `Regression rate: ${totalRegressions} invariant regression(s) over ${comparablePairs} run-to-run comparison(s) (${rate}/run).`,
  );
  if (flappyRows > 0) {
    console.log(`${flappyRows} flappy row(s) - treat those invariants as noisy on that model.`);
  }
}

main();
