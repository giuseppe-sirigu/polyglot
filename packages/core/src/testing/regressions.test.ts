import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Message, Session } from "../session/types.js";
import { ToolRegistry } from "../tools/types.js";
import type { ScenarioResult } from "./agent-scenario.js";
import { runScenario } from "./agent-scenario.js";
import { DEFAULT_SCENARIO_TOOLS } from "./agent-scenario.js";
import { invariants } from "./invariants.js";
import { replaySession } from "./replay.js";

/** The invariants a regression fixture may assert (the single-arg ones - the sub-agent cap
 * invariant takes a bound and isn't meaningful for a scripted fixture). */
const FIXTURE_INVARIANTS: Record<string, (r: ScenarioResult) => void> = {
  noRunaway: invariants.noRunaway,
  honestCompletion: invariants.honestCompletion,
  shellFailuresSurfaced: invariants.shellFailuresSurfaced,
  resultsPairedToCalls: invariants.resultsPairedToCalls,
};

/**
 * The regression gate. Each `regressions/*.json` is a real (or realistic) weak-model failure
 * that a since-released parser / loop fix now handles - captured with `polyglot replay --save`,
 * eyeballed, and committed. This test keeps every one of them fixed: it re-runs the recorded
 * completions against the current build with no inference server, deterministically.
 *
 * Two modes, chosen by the fixture's `expect` block:
 *   - parse-level (default): re-resolve each completion through the current tool-call pipeline
 *     and assert on the tool calls / parse errors it now produces.
 *   - execute: replay the completions through the whole agent loop in a temp working dir
 *     (`seedFiles`) and assert on invariants + final file state.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), "regressions");

interface RegressionFixture {
  name: string;
  capturedFrom: string;
  structured?: boolean;
  userInput: string;
  seedFiles?: Record<string, string>;
  completions: string[];
  expect: {
    resolvedToolCalls?: { name: string; input?: unknown }[];
    noParseErrors?: boolean;
    stopReason?: "done" | "max_steps" | "unreliable_model";
    invariants?: (keyof typeof FIXTURE_INVARIANTS)[];
    finalFiles?: Record<string, string>;
  };
}

function loadFixtures(): RegressionFixture[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as RegressionFixture);
}

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const tool of DEFAULT_SCENARIO_TOOLS) r.register(tool);
  return r;
}

function syntheticSession(fixture: RegressionFixture): Session {
  const messages: Message[] = [
    { id: "u0", role: "user", content: fixture.userInput, createdAt: 0 },
    ...fixture.completions.map(
      (c, i): Message => ({ id: `a${i}`, role: "assistant", content: c, createdAt: i + 1 }),
    ),
  ];
  return { id: fixture.name, cwd: "/tmp", provider: "fixture", model: "fixture", messages };
}

const fixtures = loadFixtures();

describe("regression fixtures", () => {
  it("the regressions/ directory has fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    const isExecute = Boolean(fixture.expect.invariants || fixture.expect.finalFiles);

    it(`${fixture.name} (${isExecute ? "execute" : "parse-level"})`, async () => {
      if (!isExecute) {
        const report = replaySession(syntheticSession(fixture), registry(), {
          structured: fixture.structured,
        });
        const calls = report.turns.flatMap((t) => t.resolvedCalls);
        const parseErrors = report.turns.flatMap((t) => t.parseErrors);

        if (fixture.expect.noParseErrors) {
          expect(parseErrors, JSON.stringify(parseErrors, null, 2)).toHaveLength(0);
        }
        if (fixture.expect.resolvedToolCalls) {
          expect(calls.map((c) => c.name)).toEqual(
            fixture.expect.resolvedToolCalls.map((c) => c.name),
          );
          fixture.expect.resolvedToolCalls.forEach((want, i) => {
            if (want.input !== undefined) expect(calls[i]?.input).toEqual(want.input);
          });
        }
        return;
      }

      const result = await runScenario({
        model: fixture.completions,
        userInput: fixture.userInput,
        files: fixture.seedFiles ?? {},
        structured: fixture.structured,
      });

      for (const name of fixture.expect.invariants ?? []) {
        const check = FIXTURE_INVARIANTS[name];
        expect(check, `unknown invariant ${name}`).toBeDefined();
        expect(() => check?.(result), `invariant ${name}`).not.toThrow();
      }
      for (const [path, want] of Object.entries(fixture.expect.finalFiles ?? {})) {
        const actual = result.readWorkFile(path);
        if (want === "unchanged") {
          expect(actual, `${path} should be unchanged`).toBe(fixture.seedFiles?.[path] ?? null);
        } else {
          expect(actual, path).toBe(want);
        }
      }
      if (fixture.expect.stopReason) {
        expect(result.stopReason).toBe(fixture.expect.stopReason);
      }
    });
  }
});
