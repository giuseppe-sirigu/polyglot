import type { AgentEvent } from "../agent/events.js";
import type { ProviderAdapter } from "../providers/types.js";
import { type ScenarioResult, type ScenarioStopReason, runScenario } from "./agent-scenario.js";
import type { Scenario } from "./scenarios.js";

export interface InvariantResult {
  name: string;
  status: "pass" | "fail";
  error?: string;
}

export interface ScenarioOutcome {
  scenario: string;
  /** The scenario itself failed to run (budget abort or an unexpected throw). */
  aborted: boolean;
  /** Present when `runScenario` threw for a reason other than a budget abort. */
  error?: string;
  invariantResults: InvariantResult[];
  taskDone: boolean;
  modelCallCount: number;
  stopReason: ScenarioStopReason;
  /** Everything needed to promote a failure into a scripted fixture test. */
  transcript: {
    userInput: string;
    completions: string[];
    resultsSeenByModel: string[];
    finalAssistantText: string;
    events: AgentEvent[];
  };
}

/** True across all invariant results and taskDone. */
export function outcomePassed(o: ScenarioOutcome): boolean {
  return (
    !o.aborted && !o.error && o.taskDone && o.invariantResults.every((r) => r.status === "pass")
  );
}

/**
 * Runs one scenario against one model (scripted turns or a real adapter) and collects the
 * result without throwing - every invariant is checked in isolation so one failure doesn't hide
 * the rest. Used by both the deterministic CI test and the live matrix script.
 */
export async function runScenarioAgainst(
  scenario: Scenario,
  model: string[] | ProviderAdapter,
  opts: { modelId?: string } = {},
): Promise<ScenarioOutcome> {
  let result: ScenarioResult;
  try {
    result = await runScenario({
      model,
      modelId: opts.modelId,
      userInput: scenario.userInput,
      fixture: scenario.fixture,
      files: scenario.files,
      subAgents: scenario.subAgents,
      maxSteps: scenario.maxSteps,
      budget: scenario.budget,
    });
  } catch (err) {
    return {
      scenario: scenario.name,
      aborted: true,
      error: err instanceof Error ? err.message : String(err),
      invariantResults: [],
      taskDone: false,
      modelCallCount: 0,
      stopReason: undefined,
      transcript: {
        userInput: scenario.userInput,
        completions: [],
        resultsSeenByModel: [],
        finalAssistantText: "",
        events: [],
      },
    };
  }

  const invariantResults: InvariantResult[] = scenario.invariants.map((inv) => {
    try {
      inv.check(result);
      return { name: inv.name, status: "pass" as const };
    } catch (err) {
      return {
        name: inv.name,
        status: "fail" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  let taskDone = false;
  try {
    taskDone = scenario.taskDone(result);
  } catch {
    taskDone = false;
  }

  return {
    scenario: scenario.name,
    aborted: result.abortedByBudget,
    invariantResults,
    taskDone,
    modelCallCount: result.modelCallCount,
    stopReason: result.stopReason,
    transcript: {
      userInput: scenario.userInput,
      completions: result.completions,
      resultsSeenByModel: result.resultsSeenByModel,
      finalAssistantText: result.finalAssistantText,
      events: result.events,
    },
  };
}
