import { glob } from "glob";
import { SECRET_IGNORE_GLOBS } from "../permissions/secret-paths.js";
import { type ToolDefinition, textResult } from "./types.js";

interface GlobInput {
  pattern: string;
}

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/coverage/**",
  // Keep a broad search from surfacing credentials/keys — read_file can still fetch one
  // explicitly (which prompts for approval).
  ...SECRET_IGNORE_GLOBS,
];
const MAX_RESULTS = 500;

export const globTool: ToolDefinition<GlobInput> = {
  name: "glob",
  description:
    'Find files matching a glob pattern (e.g. "src/**/*.ts"). The pattern is absolute, or ' +
    "relative to the current working directory. If a pattern matches nothing, don't assume " +
    "the code doesn't exist — the project may use a different language/extension or directory " +
    'layout than you assumed; try a broader pattern (e.g. "**/*") or grep for a distinctive ' +
    "symbol before concluding the path is wrong.",
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
      return textResult(
        truncated.length > 0
          ? truncated.join("\n") + suffix
          : `No files matched "${input.pattern}". Don't assume the code doesn't exist or the path is wrong — the project may just use a different extension or layout than expected. Try a broader pattern (e.g. "**/*") to see what's actually there, or grep for a distinctive symbol, before concluding otherwise.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error matching pattern "${input.pattern}": ${message}`, false);
    }
  },
};
