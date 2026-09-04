import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { SECRET_DIR_NAMES, isSecretFilename } from "../permissions/secret-paths.js";

/** Dirs never worth walking for a file picker - the heavy ones plus VCS. Mirrors grep.ts. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".next",
  "build",
  "out",
  ".cache",
  ".turbo",
  ".venv",
  "__pycache__",
]);

const DEFAULT_LIMIT = 2000;

/** Reads `<cwd>/.gitignore` and `<cwd>/.git/info/exclude` into one matcher. Nested `.gitignore`
 * files aren't honoured (v1 simplification - the hardcoded `IGNORED_DIRS` covers the common
 * heavy dirs, and repos rarely nest ignore rules for what the picker needs). */
async function loadGitignore(cwd: string): Promise<Ignore> {
  const ig = ignore();
  for (const rel of [".gitignore", ".git/info/exclude"]) {
    try {
      ig.add(await readFile(join(cwd, rel), "utf8"));
    } catch {
      // missing - normal
    }
  }
  return ig;
}

/**
 * Lists the project's files relative to `cwd` (POSIX-separated, sorted), for the `@`-mention
 * file picker. Honours `.gitignore` (root only), skips `node_modules` / VCS / build dirs and
 * secret files, and caps the result so a huge monorepo can't stall the UI.
 */
export async function listProjectFiles(
  cwd: string,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const ig = await loadGitignore(cwd);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || SECRET_DIR_NAMES.has(entry.name)) continue;
        if (ig.ignores(`${rel}/`)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (isSecretFilename(entry.name)) continue;
        if (ig.ignores(rel)) continue;
        out.push(rel);
      }
    }
  }

  await walk(cwd);
  return out;
}
