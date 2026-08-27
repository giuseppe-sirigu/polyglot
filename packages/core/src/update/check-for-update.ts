export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

/** Compares dotted version strings (e.g. "1.2.3"); non-numeric/missing segments count as 0.
 * Deliberately simple - good enough for standard X.Y.Z releases, not full semver
 * (prerelease/build metadata) which isn't needed for a "should I nudge the user" check. */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [lMaj = 0, lMin = 0, lPatch = 0] = parse(latest);
  const [cMaj = 0, cMin = 0, cPatch = 0] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

/**
 * Checks the npm registry for the latest published version of `packageName`.
 * Fails silently (returns null) on any error - offline, package not yet
 * published, registry hiccup - since this is a best-effort nudge, never
 * something that should block or disrupt startup.
 */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
  opts: { timeoutMs?: number } = {},
): Promise<UpdateCheckResult | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    if (!data.version) return null;
    return {
      currentVersion,
      latestVersion: data.version,
      updateAvailable: isNewerVersion(data.version, currentVersion),
    };
  } catch {
    return null;
  }
}
