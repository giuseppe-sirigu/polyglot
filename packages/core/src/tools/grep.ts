import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { SECRET_DIR_NAMES, isSecretFilename } from "../permissions/secret-paths.js";
import { resolveToolPath } from "./resolve-path.js";
import { type ToolDefinition, textResult } from "./types.js";

interface GrepInput {
  pattern: string;
  path?: string;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".next", "build"]);
const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 2_000_000;

async function* walk(dir: string, signal: AbortSignal): AsyncGenerator<string> {
  if (signal.aborted) return;
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal.aborted) return;
    if (entry.isDirectory()) {
      if (
        IGNORED_DIRS.has(entry.name) ||
        SECRET_DIR_NAMES.has(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      yield* walk(join(dir, entry.name), signal);
    } else if (entry.isFile()) {
      if (isSecretFilename(entry.name)) continue;
      yield join(dir, entry.name);
    }
  }
}

export const grepTool: ToolDefinition<GrepInput> = {
  name: "grep",
  description: "Search file contents for a regular expression, recursively under a directory.",
  permission: "read",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: {
        type: "string",
        description:
          "Directory to search under (default: cwd). Absolute path, or relative to the current working directory.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Invalid regular expression: ${message}`, false);
    }

    let root = ctx.cwd;
    if (input.path) {
      const resolved = resolveToolPath(input.path, ctx.cwd);
      if ("error" in resolved) return textResult(resolved.error, false);
      root = resolved.path;
    }

    const results: string[] = [];
    for await (const file of walk(root, ctx.signal)) {
      if (results.length >= MAX_MATCHES) break;
      let content: string;
      try {
        const { size } = await stat(file);
        if (size > MAX_FILE_BYTES) continue;
        content = await readFile(file, { encoding: "utf8", signal: ctx.signal });
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_MATCHES) break;
        const line = lines[i] ?? "";
        if (regex.test(line)) {
          results.push(`${relative(ctx.cwd, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    if (results.length === 0) {
      return textResult(`No matches for /${input.pattern}/ under ${input.path ?? "."}`);
    }
    const suffix = results.length >= MAX_MATCHES ? `\n[truncated at ${MAX_MATCHES} matches]` : "";
    return textResult(results.join("\n") + suffix);
  },
};
