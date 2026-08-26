import { glob } from "glob";
import { type ToolDefinition, textResult } from "./types.js";

interface GlobInput {
  pattern: string;
}

const IGNORE_PATTERNS = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"];
const MAX_RESULTS = 500;

export const globTool: ToolDefinition<GlobInput> = {
  name: "glob",
  description:
    'Find files matching a glob pattern (e.g. "src/**/*.ts"). The pattern is absolute, or ' +
    "relative to the current working directory.",
  permission: "read",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match files against." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    try {
      const matches = await glob(input.pattern, {
        cwd: ctx.cwd,
        ignore: IGNORE_PATTERNS,
        nodir: true,
        signal: ctx.signal,
      });
      matches.sort();
      const truncated = matches.slice(0, MAX_RESULTS);
      const suffix =
        matches.length > MAX_RESULTS ? `\n[truncated, ${matches.length} total matches]` : "";
      return textResult(truncated.length > 0 ? truncated.join("\n") + suffix : "No files matched.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error matching pattern "${input.pattern}": ${message}`, false);
    }
  },
};
