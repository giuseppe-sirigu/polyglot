import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Per-file cap - a runaway instructions file shouldn't be able to crowd out the conversation
 * in the context window. Anything past this is dropped with a visible marker. */
const MAX_FILE_BYTES = 16_384;

/** Instruction files, lowest priority first. Global comes before project so a project file
 * refines rather than is refined; `POLYGLOT.md` comes after `AGENTS.md` so a polyglot-specific
 * file wins over the cross-tool one. */
export function globalInstructionsPaths(): string[] {
  const dir = join(homedir(), ".polyglot");
  return [join(dir, "AGENTS.md"), join(dir, "POLYGLOT.md")];
}

export function projectInstructionsPaths(cwd: string): string[] {
  return [join(cwd, "AGENTS.md"), join(cwd, "POLYGLOT.md")];
}

export interface ProjectInstructions {
  /** The concatenated instruction text, ready to splice into the system prompt. Empty when no
   * file was found (or loading is disabled). */
  text: string;
  /** Basenames of the files that actually contributed, in prompt order - shown in `/status`. */
  sources: string[];
}

export const EMPTY_INSTRUCTIONS: ProjectInstructions = { text: "", sources: [] };

function readInstructionFile(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null; // missing / unreadable - normal
  }
  if (raw.trim().length === 0) return null;
  if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) {
    return `${raw.slice(0, MAX_FILE_BYTES)}\n\n[... truncated at ${MAX_FILE_BYTES / 1024} KB]`;
  }
  return raw;
}

/**
 * Reads the project (and global) instruction files - `AGENTS.md` for cross-tool interop,
 * `POLYGLOT.md` for polyglot-specific rules - and returns their concatenated text for the
 * system prompt. Set `POLYGLOT_NO_INSTRUCTIONS` to skip loading entirely (clean-room runs).
 */
export function loadProjectInstructions(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ProjectInstructions {
  if (env.POLYGLOT_NO_INSTRUCTIONS === "1" || env.POLYGLOT_NO_INSTRUCTIONS === "true") {
    return EMPTY_INSTRUCTIONS;
  }

  const globalPaths = globalInstructionsPaths();
  const blocks: string[] = [];
  const sources: string[] = [];
  for (const path of [...globalPaths, ...projectInstructionsPaths(cwd)]) {
    const body = readInstructionFile(path);
    if (body === null) continue;
    const where = globalPaths.includes(path) ? `~/.polyglot/${basename(path)}` : basename(path);
    blocks.push(`# From ${where}\n\n${body.trim()}`);
    if (!sources.includes(where)) sources.push(where);
  }

  return { text: blocks.join("\n\n"), sources };
}
