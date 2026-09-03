import { buildToolSystemPrompt } from "../tool-protocol/grammar.js";
import type { ToolDefinition } from "../tools/types.js";

export const PERSONA =
  "You are polyglot, a concise coding assistant that works the same way regardless of which model is answering.";

/** exit_plan_mode / ask_user_question are always in the registry (so calling them never fails
 * with "Unknown tool"), but are only worth advertising to the model while actually in plan
 * mode - listing them elsewhere just invites confusion about when to use them. */
const PLAN_ONLY_TOOLS = new Set(["exit_plan_mode", "ask_user_question"]);

/**
 * Assembles the full system prompt for a turn: the persona line, the project's own
 * instructions (`AGENTS.md` / `POLYGLOT.md`, when present), then the tool-call grammar and tool
 * docs. Single source of truth for both the interactive TUI and headless (`-p`) mode - each
 * used to build this inline, so a guardrail added to one prompt path could silently miss the
 * other.
 */
export function assembleSystemPrompt(opts: {
  tools: ToolDefinition[];
  cwd: string;
  mode?: "manual" | "auto" | "plan";
  structured: boolean;
  /** `AGENTS.md` / `POLYGLOT.md` contents - see config/instructions.ts. */
  projectInstructions?: string;
}): string {
  const promptTools =
    opts.mode === "plan" ? opts.tools : opts.tools.filter((t) => !PLAN_ONLY_TOOLS.has(t.name));
  const instructions = opts.projectInstructions?.trim()
    ? `## Project instructions\n\n${opts.projectInstructions.trim()}\n\n`
    : "";
  return `${PERSONA}\n\n${instructions}${buildToolSystemPrompt(promptTools, opts.cwd, opts.mode, {
    structured: opts.structured,
  })}`;
}
