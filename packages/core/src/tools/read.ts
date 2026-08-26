import { readFile } from "node:fs/promises";
import { resolveToolPath } from "./resolve-path.js";
import { type ToolDefinition, textResult } from "./types.js";

const MAX_CHARS = 100_000;

interface ReadFileInput {
  path: string;
}

const PATH_DESCRIPTION = "Absolute path, or relative to the current working directory.";

export const readFileTool: ToolDefinition<ReadFileInput> = {
  name: "read_file",
  description: `Read the contents of a file. Path: ${PATH_DESCRIPTION}`,
  permission: "read",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: `File path to read. ${PATH_DESCRIPTION}` },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const resolved = resolveToolPath(input.path, ctx.cwd);
    if ("error" in resolved) return textResult(resolved.error, false);
    const target = resolved.path;
    try {
      const contents = await readFile(target, { encoding: "utf8", signal: ctx.signal });
      if (contents.length > MAX_CHARS) {
        const truncated = contents.slice(0, MAX_CHARS);
        return textResult(
          `${truncated}\n\n[truncated: file is ${contents.length} chars, showing first ${MAX_CHARS}]`,
        );
      }
      return textResult(contents);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error reading ${input.path}: ${message}`, false);
    }
  },
};
