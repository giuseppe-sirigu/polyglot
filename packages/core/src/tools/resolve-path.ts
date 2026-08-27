import { isAbsolute, resolve, sep } from "node:path";

export type ResolvedToolPath = { path: string } | { error: string };

/** Detects a path that looks like an absolute path missing its leading separator - e.g. the
 * model meant "/home/user/project/file.js" but sent "home/user/project/file.js". Naively
 * resolving that against cwd would double up cwd's own segments into a bogus nested path
 * instead of the file the model intended. Scoped to cwd's own structure so a genuinely
 * relative path in an unrelated project (e.g. "home/config.json" in some other repo) is never
 * false-positived. */
function looksLikeDroppedLeadingSlash(inputPath: string, cwd: string): boolean {
  if (!isAbsolute(cwd) || inputPath.startsWith(".")) return false;
  const bareCwd = cwd.slice(1);
  return inputPath === bareCwd || inputPath.startsWith(`${bareCwd}${sep}`);
}

export function resolveToolPath(inputPath: string, cwd: string): ResolvedToolPath {
  if (isAbsolute(inputPath)) {
    return { path: inputPath };
  }

  if (looksLikeDroppedLeadingSlash(inputPath, cwd)) {
    return {
      error: `"${inputPath}" looks like an absolute path missing its leading "/" - resolving it relative to the working directory (${cwd}) would produce a nonexistent nested path. Retry with a path starting with "/" (absolute) or "./" (explicitly relative).`,
    };
  }

  return { path: resolve(cwd, inputPath) };
}
