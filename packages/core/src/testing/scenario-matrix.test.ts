import { describe, expect, it } from "vitest";
import { outcomePassed, runScenarioAgainst } from "./scenario-runner.js";
import { SCENARIOS } from "./scenarios.js";

/**
 * Runs every scenario against its own `goldenTurns` (a scripted competent model). This proves
 * (a) each golden transcript actually completes the task, (b) every declared invariant holds on
 * a good run, and (c) the harness + invariants line up. The live matrix (`pnpm scenario:live`)
 * runs the same scenarios against real models - this is its deterministic CI counterpart.
 */
describe("scenario suite - golden runs", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: golden transcript passes every invariant and completes the task`, async () => {
      const outcome = await runScenarioAgainst(scenario, scenario.goldenTurns);

      expect(outcome.error).toBeUndefined();
      expect(outcome.aborted).toBe(false);
      const failed = outcome.invariantResults.filter((r) => r.status === "fail");
      expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
      expect(outcome.taskDone, "taskDone").toBe(true);
      expect(outcomePassed(outcome)).toBe(true);
    });
  }
});

describe("runScenarioAgainst", () => {
  it("never throws - a broken script becomes an aborted outcome", async () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error("no scenarios");
    // one turn, no tool call, no completion: the model just "stops" immediately
    const outcome = await runScenarioAgainst({ ...scenario, goldenTurns: [""] }, [""]);
    expect(outcome.taskDone).toBe(false);
    // stopped clean with nothing done - not aborted, but taskDone false and honestCompletion
    // is fine (empty text isn't a hand-off), so this is a "model did nothing" outcome.
    expect(outcome.error).toBeUndefined();
  });

  it("captures the raw completions so a failure is promotable to a fixture", async () => {
    const scenario = SCENARIOS.find((s) => s.name === "read-and-report");
    if (!scenario) throw new Error("missing scenario");
    const outcome = await runScenarioAgainst(scenario, scenario.goldenTurns);
    expect(outcome.transcript.completions).toEqual(scenario.goldenTurns);
  });
});
