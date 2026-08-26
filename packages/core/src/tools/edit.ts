import { readFile, writeFile } from "node:fs/promises";
import { resolveToolPath } from "./resolve-path.js";
import { type ToolDefinition, textResult } from "./types.js";

interface EditFileInput {
  path: string;
  old_string: string;
  new_string: string;
}

const PATH_DESCRIPTION = "Absolute path, or relative to the current working directory.";

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const editFileTool: ToolDefinition<EditFileInput> = {
  name: "edit_file",
  description:
    "Replace one exact occurrence of old_string with new_string in a file. old_string must " +
    "match exactly (including whitespace) and appear exactly once, or the edit is refused.",
  permission: "write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: `File path to edit. ${PATH_DESCRIPTION}` },
      old_string: {
        type: "string",
        description: "Exact text to replace. Must be unique in the file.",
      },
      new_string: { type: "string", description: "Replacement text." },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const resolved = resolveToolPath(input.path, ctx.cwd);
    if ("error" in resolved) return textResult(resolved.error, false);
    const target = resolved.path;

    let original: string;
    try {
      original = await readFile(target, { encoding: "utf8", signal: ctx.signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error reading ${input.path}: ${message}`, false);
    }

    if (input.old_string === input.new_string) {
      return textResult("old_string and new_string are identical; nothing to do.", false);
    }

    const matches = countOccurrences(original, input.old_string);
    if (matches === 0) {
      return textResult(
        `No exact match for old_string was found in ${input.path}. Re-read the file and copy the text exactly, including whitespace.`,
        false,
      );
    }
    if (matches > 1) {
      return textResult(
        `old_string appears ${matches} times in ${input.path}, so the edit was refused to avoid changing the wrong occurrence. Include more surrounding context to make it unique.`,
        false,
      );
    }

    const updated = original.replace(input.old_string, input.new_string);
    try {
      await writeFile(target, updated, { encoding: "utf8", signal: ctx.signal });
      return textResult(`Edited ${input.path} (1 occurrence replaced).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error writing ${input.path}: ${message}`, false);
    }
  },
};
