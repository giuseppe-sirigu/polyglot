import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DAY_MS = 86_400_000;

export function plansDir(): string {
  return join(homedir(), ".polyglot", "plans");
}

/** Deletes saved plan files older than `maxAgeDays`. Best-effort; returns the count removed. */
export async function prunePlans(maxAgeDays: number): Promise<number> {
  if (!(maxAgeDays > 0)) return 0;
  const dir = plansDir();
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  let removed = 0;
  for (const file of files) {
    const full = join(dir, file);
    try {
      const { mtimeMs } = await stat(full);
      if (mtimeMs < cutoff) {
        await rm(full, { force: true });
        removed++;
      }
    } catch {
      // skip this file
    }
  }
  return removed;
}

export interface PersistedPlan {
  path: string;
}

/** Saves a proposed plan to disk, one file per exit_plan_mode call — a durable record of what
 * was proposed, independent of whether the user approved it, mirroring what Claude Code's own
 * ~/.claude/plans directory is for. Named by timestamp + a session-id prefix so files sort
 * chronologically and stay attributable to the session that produced them, without needing any
 * extra counter/state to keep unique. */
export async function persistPlan(sessionId: string, plan: string): Promise<PersistedPlan> {
  const dir = plansDir();
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${timestamp}-${sessionId.slice(0, 8)}.md`);
  await writeFile(path, plan, "utf8");
  return { path };
}
