import { exec } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Infers which package manager installed the running binary by resolving
 * symlinks on the invoked script path and looking for each manager's
 * tell-tale directory marker in its global-install layout. Defaults to npm,
 * which is always present alongside Node and safe as a fallback. */
export function detectPackageManager(scriptPath: string = process.argv[1] ?? ""): PackageManager {
  let realPath: string;
  try {
    realPath = realpathSync(scriptPath);
  } catch {
    realPath = scriptPath;
  }

  if (realPath.includes(".pnpm")) return "pnpm";
  if (realPath.includes("/.bun/")) return "bun";
  if (realPath.includes("/yarn/") || realPath.includes(".yarn")) return "yarn";
  return "npm";
}

function updateCommand(pm: PackageManager, packageName: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm add -g ${packageName}@latest`;
    case "yarn":
      return `yarn global add ${packageName}@latest`;
    case "bun":
      return `bun add -g ${packageName}@latest`;
    default:
      return `npm install -g ${packageName}@latest`;
  }
}

export interface SelfUpdateResult {
  ok: boolean;
  message: string;
  /** A retriable, non-alarming failure (registry lag, offline) - the caller should
   * show it calmly (info tone) rather than as a warning. */
  transient?: boolean;
}

/** Classifies a package-manager failure so the caller can react to a retriable one
 * (registry propagation lag after a `latest` bump, or no network) without alarming
 * the user or dumping raw stderr. */
export function classifyUpdateFailure(raw: string): "registry-lag" | "offline" | "other" {
  if (
    /\bETARGET\b|no matching version|notarget|not in this registry|no versions? found/i.test(raw)
  ) {
    return "registry-lag";
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network|getaddrinfo|offline/i.test(raw)) {
    return "offline";
  }
  return "other";
}

/** Runs the actual global reinstall. Never throws - always resolves with a
 * result the caller can show to the user, since a failed background update
 * should never crash or block the app. The message is a single clean line; the
 * package manager's raw stderr is never surfaced. */
export async function runSelfUpdate(packageName: string): Promise<SelfUpdateResult> {
  const pm = detectPackageManager();
  const command = updateCommand(pm, packageName);
  try {
    await execAsync(command, { timeout: 120_000 });
    return { ok: true, message: `Updated via ${pm}. Restart polyglot to use the new version.` };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    switch (classifyUpdateFailure(raw)) {
      case "registry-lag":
        return {
          ok: false,
          transient: true,
          message:
            "The new version isn't fully published to the registry yet - polyglot will retry on the next start.",
        };
      case "offline":
        return {
          ok: false,
          transient: true,
          message: "Couldn't reach the registry to update - polyglot will retry on the next start.",
        };
      default:
        return { ok: false, message: `Auto-update failed. Update manually with:  ${command}` };
    }
  }
}
