import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveToolPath } from "./resolve-path.js";
import { type DiffPreview, type ToolDefinition, textResult } from "./types.js";

interface WriteFileInput {
  path: string;
  content: string;
}

const PATH_DESCRIPTION = "Absolute path, or relative to the current working directory.";

export const writeFileTool: ToolDefinition<WriteFileInput> = {
  name: "write_file",
  description: `Create a file or overwrite it entirely with new content. Creates parent directories as needed. Path: ${PATH_DESCRIPTION}`,
  permission: "write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: `File path to write. ${PATH_DESCRIPTION}` },
      content: { type: "string", description: "The full contents to write." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async previewDiff(input, ctx): Promise<DiffPreview | null> {
    const resolved = resolveToolPath(input.path, ctx.cwd);
    if ("error" in resolved) return null;
    let existing = "";
    try {
      existing = await readFile(resolved.path, { encoding: "utf8", signal: ctx.signal });
    } catch {
      // File doesn't exist yet - diff against empty, which reads as an all-additions preview.
    }
    return { label: input.path, oldText: existing, newText: input.content };
  },
  async execute(input, ctx) {
    const resolved = resolveToolPath(input.path, ctx.cwd);
    if ("error" in resolved) return textResult(resolved.error, false);
    const target = resolved.path;
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.content, { encoding: "utf8", signal: ctx.signal });
      return textResult(`Wrote ${input.content.length} chars to ${input.path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error writing ${input.path}: ${message}`, false);
    }
  },
};
