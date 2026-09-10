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

  // Harder scenarios: multi-file reasoning and longer tool chains (5-6 steps). These are where
  // "keep the agent loop alive on a weak model" is actually tested - a single dropped or
  // unrepairable tool call several steps in kills the whole task.
  {
    name: "rename-across-files",
    description: "Rename an exported function and update its importer, across two files.",
    files: {
      "math.mjs": "export function add(a, b) {\n  return a + b;\n}\n",
      "main.mjs": 'import { add } from "./math.mjs";\n\nconsole.log(add(2, 3));\n',
    },
    userInput:
      'Rename the exported "add" function in math.mjs to "sum" and update main.mjs to match, then run main.mjs to check it still works.',
    invariants: [...UNIVERSAL, INV.shellFailuresSurfaced],
    taskDone: (r) => {
      const math = r.readWorkFile("math.mjs") ?? "";
      const main = r.readWorkFile("main.mjs") ?? "";
      return (
        /export function sum\(/.test(math) &&
        !/function add\(/.test(math) &&
        /\bsum\b/.test(main) &&
        !/\badd\(/.test(main)
      );
    },
    goldenTurns: [
      xml("read_file", { path: "math.mjs" }),
      xml("read_file", { path: "main.mjs" }),
      xml("edit_file", {
        path: "math.mjs",
        old_string: "export function add(a, b) {",
        new_string: "export function sum(a, b) {",
      }),
      xml("edit_file", {
        path: "main.mjs",
        old_string: 'import { add } from "./math.mjs";\n\nconsole.log(add(2, 3));',
        new_string: 'import { sum } from "./math.mjs";\n\nconsole.log(sum(2, 3));',
      }),
      xml("bash", { command: "node main.mjs" }),
      "Renamed `add` to `sum` in math.mjs and updated the import and call site in main.mjs. `node main.mjs` still prints 5.",
    ],
  },

  {
    name: "locate-and-fix",
    description: "Trace a runtime ReferenceError across files to a typo'd call and fix it.",
    files: {
      "utils.mjs": "export function formatName(first, last) {\n  return `${last}, ${first}`;\n}\n",
      "greet.mjs":
        'import { formatName } from "./utils.mjs";\n\nexport function greet(first, last) {\n  return `Hello, ${fmtName(first, last)}!`;\n}\n',
      "main.mjs":
        'import { greet } from "./greet.mjs";\n\nconsole.log(greet("Ada", "Lovelace"));\n',
    },
    userInput:
      "`node main.mjs` throws a ReferenceError. Find the cause and fix it, then verify it runs.",
    invariants: [...UNIVERSAL, INV.shellFailuresSurfaced],
    taskDone: (r) => {
      const greet = r.readWorkFile("greet.mjs") ?? "";
      return /formatName\(first, last\)/.test(greet) && !/fmtName/.test(greet);
    },
    goldenTurns: [
      xml("bash", { command: "node main.mjs" }),
      xml("grep", { pattern: "fmtName" }),
      xml("read_file", { path: "greet.mjs" }),
      xml("edit_file", {
        path: "greet.mjs",
        old_string: "fmtName(first, last)",
        new_string: "formatName(first, last)",
      }),
      xml("bash", { command: "node main.mjs" }),
      'greet.mjs called `fmtName` instead of the imported `formatName` - a typo. Fixed and verified: `node main.mjs` now prints "Hello, Lovelace, Ada!".',
    ],
  },
];
