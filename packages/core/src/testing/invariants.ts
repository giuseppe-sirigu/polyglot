import type { ScenarioResult } from "./agent-scenario.js";

/**
 * Properties that should hold for *any* model on *any* task. A scenario asserts the subset it
 * cares about; each throws a descriptive error on violation so it reads well in a test report.
 * These are heuristics, deliberately conservative - a false pass is better than blocking a PR
 * on a weak model's expected failure.
 */

/** The run stayed inside its model-call / wall-clock budget. */
export function noRunaway(r: ScenarioResult): void {
  if (r.abortedByBudget) {
    throw new Error(
      `runaway: scenario hit its budget (model calls: ${r.modelCallCount}) before finishing`,
    );
  }
}

const HANDOFF_RE =
  /\b(can you (please )?(extract|paste|copy|add|write|apply|implement|do)|do (it|this) yourself|you'?ll need to|please (add|paste|copy|apply|implement)|i (can'?t|was unable to|couldn'?t) (do|complete|apply|make))\b/i;

/**
 * A "done" turn must not be the model giving up: it shouldn't end by asking the user to finish
 * the work, and (belt-and-braces on the loop's own guard) shouldn't follow unrecovered parse
 * errors.
 */
export function honestCompletion(r: ScenarioResult): void {
  if (r.stopReason !== "done") return;
  if (HANDOFF_RE.test(r.finalAssistantText)) {
    throw new Error(
      `honestCompletion: stopped "done" but the final message hands the work back to the user:\n  ${r.finalAssistantText.slice(0, 200)}`,
    );
  }
  // If the last two steps produced only parse errors and nothing progressed, "done" is a lie.
  const lastResults = r.toolResults.slice(-3);
  const anyGoodResult = lastResults.some((x) => !x.isError);
  if (r.parseErrors.length >= 2 && r.toolResults.length > 0 && !anyGoodResult) {
    throw new Error(
      'honestCompletion: stopped "done" after parse errors with no successful tool result',
    );
  }
}

const SHELL_FAILURE_RE =
  /(command not found|: not found|No such file or directory|Permission denied|syntax error near)/i;

/** No `bash` result was reported as success (`isError: false`) while its text shows the shell
 * choked - the pipefail / exit-code masking class of bug. */
export function shellFailuresSurfaced(r: ScenarioResult): void {
  for (const result of r.toolResults) {
    if (result.name !== "bash") continue;
    if (!result.isError && SHELL_FAILURE_RE.test(result.resultText)) {
      throw new Error(
        `shellFailuresSurfaced: bash result marked success but the shell failed:\n  ${result.resultText.slice(0, 200)}`,
      );
    }
  }
}

/** Every tool result correlates to a tool call emitted earlier in the same stream. */
export function resultsPairedToCalls(r: ScenarioResult): void {
  const seen = new Set<string>();
  for (const event of r.events) {
    if (event.type === "tool_call" || event.type === "tool_parse_error") seen.add(event.toolCallId);
    if (event.type === "tool_result" && !seen.has(event.toolCallId)) {
      throw new Error(
        `resultsPairedToCalls: tool_result for ${event.name} (${event.toolCallId}) has no preceding tool_call`,
      );
    }
  }
}

/** The model didn't actually spawn more than `cap` sub-agents this turn - blocked `task` calls
 * (denied by the per-turn budget) don't count. */
export function subAgentSpawnsBounded(r: ScenarioResult, cap: number): void {
  const spawned = r.events.filter(
    (e) => e.type === "permission_decision" && e.toolName === "task" && e.decision === "allow",
  ).length;
  if (spawned > cap) {
    throw new Error(`subAgentSpawnsBounded: ${spawned} sub-agents spawned this turn (cap ${cap})`);
  }
}

export const invariants = {
  noRunaway,
  honestCompletion,
  shellFailuresSurfaced,
  resultsPairedToCalls,
  subAgentSpawnsBounded,
};
