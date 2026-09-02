import type { ScenarioBudget, ScenarioResult } from "./agent-scenario.js";
import { invariants } from "./invariants.js";

/** A named `{ name, check }` invariant - so a scenario's declared list and a matrix report can
 * refer to invariants by a stable string. */
export interface NamedInvariant {
  name: string;
  check: (r: ScenarioResult) => void;
}

export const INV = {
  noRunaway: { name: "noRunaway", check: invariants.noRunaway },
  honestCompletion: { name: "honestCompletion", check: invariants.honestCompletion },
  resultsPairedToCalls: { name: "resultsPairedToCalls", check: invariants.resultsPairedToCalls },
  shellFailuresSurfaced: { name: "shellFailuresSurfaced", check: invariants.shellFailuresSurfaced },
  subAgentSpawnsBounded: {
    name: "subAgentSpawnsBounded",
    check: (r: ScenarioResult) => invariants.subAgentSpawnsBounded(r, 3),
  },
} satisfies Record<string, NamedInvariant>;

/** Every scenario asserts these regardless of the task. */
const UNIVERSAL: NamedInvariant[] = [INV.noRunaway, INV.honestCompletion, INV.resultsPairedToCalls];

export interface Scenario {
  name: string;
  description: string;
  fixture?: "todo-demo";
  files?: Record<string, string>;
  userInput: string;
  subAgents?: boolean;
  maxSteps?: number;
  budget?: ScenarioBudget;
  /** Invariants every model must satisfy on this scenario. */
  invariants: NamedInvariant[];
  /** Best-effort: did the model actually accomplish the task? Judged from final file state /
   * reported text, tolerant of formatting. */
  taskDone: (r: ScenarioResult) => boolean;
  /**
   * A scripted free-text transcript of a competent model completing this scenario. Drives the
   * deterministic CI test (scenario-matrix.test.ts) and documents what a correct run looks like.
   */
  goldenTurns: string[];
}

function xml(name: string, args: Record<string, unknown>): string {
  return `<tool_call name="${name}">\n${JSON.stringify(args)}\n</tool_call>`;
}

const collapseWs = (s: string) => s.replace(/\s+/g, " ").trim();

export const SCENARIOS: Scenario[] = [
  {
    name: "add-count-command",
    description: "Add a `count` subcommand to a small CLI, matching existing style.",
    fixture: "todo-demo",
    userInput:
      'Read todo.mjs, then add a "count" command to the switch that prints the number of todos. Match the existing code style.',
    invariants: [...UNIVERSAL, INV.shellFailuresSurfaced],
    taskDone: (r) => {
      const src = r.readWorkFile("todo.mjs") ?? "";
      return /case ["']count["']/.test(src) && /todos\.length/.test(src);
    },
    goldenTurns: [
      xml("read_file", { path: "todo.mjs" }),
      xml("edit_file", {
        path: "todo.mjs",
        old_string: '  default:\n    console.log("usage: todo <add|done|list>");',
        new_string:
          '  case "count":\n    console.log(todos.length);\n    break;\n  default:\n    console.log("usage: todo <add|done|list>");',
      }),
      'Added a "count" command that logs `todos.length`, matching the existing case style.',
    ],
  },

  {
    name: "fix-bug",
    description: "Find and fix an off-by-one in a sum function.",
    files: {
      "sum.mjs":
        "export function sum(nums) {\n  let total = 0;\n  for (let i = 1; i < nums.length; i++) {\n    total += nums[i];\n  }\n  return total;\n}\n\nconsole.log(sum([10, 20, 30]));\n",
    },
    userInput:
      "sum.mjs prints 50 for [10, 20, 30] but should print 60. Find and fix the bug, then verify.",
    invariants: [...UNIVERSAL, INV.shellFailuresSurfaced],
    taskDone: (r) => {
      const src = r.readWorkFile("sum.mjs") ?? "";
      return /for \(let i = 0;/.test(src) && !/for \(let i = 1;/.test(src);
    },
    goldenTurns: [
      xml("read_file", { path: "sum.mjs" }),
      xml("edit_file", {
        path: "sum.mjs",
        old_string: "for (let i = 1; i < nums.length; i++)",
        new_string: "for (let i = 0; i < nums.length; i++)",
      }),
      xml("bash", { command: "node sum.mjs" }),
      "Fixed: the loop started at index 1, skipping the first element. It now prints 60.",
    ],
  },

  {
    name: "read-and-report",
    description: "Answer a question from a file without editing anything or hallucinating.",
    files: {
      "service.json": '{\n  "name": "api",\n  "port": 8443,\n  "replicas": 3\n}\n',
    },
    userInput: "What port does service.json configure? Just tell me the number.",
    invariants: [
      ...UNIVERSAL,
      {
        name: "noWrites",
        check: (r) => {
          const wrote = r.toolCalls.find(
            (c) => c.name === "write_file" || c.name === "edit_file" || c.name === "bash",
          );
          if (wrote) throw new Error(`noWrites: a read-only task called ${wrote.name}`);
        },
      },
      {
        name: "reportsRealValue",
        check: (r) => {
          if (r.stopReason !== "done") return;
          if (!collapseWs(r.finalAssistantText).includes("8443")) {
            throw new Error(
              `reportsRealValue: finished without reporting the actual port (8443):\n  ${r.finalAssistantText.slice(0, 160)}`,
            );
          }
        },
      },
    ],
    taskDone: (r) => collapseWs(r.finalAssistantText).includes("8443"),
    goldenTurns: [xml("read_file", { path: "service.json" }), "The port is 8443."],
  },

  {
    name: "delete-dead-code",
    description: "Remove an unused exported function.",
    files: {
      "util.mjs":
        "export function used(x) {\n  return x * 2;\n}\n\nexport function unused(x) {\n  // legacy, nothing calls this\n  return x + 1;\n}\n\nconsole.log(used(21));\n",
    },
    userInput: "Remove the unused() function from util.mjs. Nothing imports it.",
    invariants: [...UNIVERSAL],
    taskDone: (r) => {
      const src = r.readWorkFile("util.mjs") ?? "";
      return !/function unused/.test(src) && /function used/.test(src);
    },
    goldenTurns: [
      xml("read_file", { path: "util.mjs" }),
      xml("edit_file", {
        path: "util.mjs",
        old_string:
          "\n\nexport function unused(x) {\n  // legacy, nothing calls this\n  return x + 1;\n}\n",
        new_string: "\n",
      }),
      "Removed the unused() function.",
    ],
  },
];
