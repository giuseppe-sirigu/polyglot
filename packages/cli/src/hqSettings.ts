/**
 * Where to report audit events: the team's HQ, set by POLYGLOT_HQ_URL and
 * POLYGLOT_HQ_TOKEN (POLYGLOT_HQ_INCLUDE_RAW_CALLS=true adds raw calls). Before the
 * control plane was named HQ these were POLYGLOT_CONTROL_PLANE_*; the old names are still
 * read when the new ones aren't set, and `oldNames` lists the ones used so the caller can say so.
 */
export interface HqSettings {
  url?: string;
  token?: string;
  includeRawCalls: boolean;
  oldNames: string[];
}

const NAMES = [
  ["POLYGLOT_HQ_URL", "POLYGLOT_CONTROL_PLANE_URL"],
  ["POLYGLOT_HQ_TOKEN", "POLYGLOT_CONTROL_PLANE_TOKEN"],
  ["POLYGLOT_HQ_INCLUDE_RAW_CALLS", "POLYGLOT_CONTROL_PLANE_INCLUDE_RAW_CALLS"],
] as const;

export function hqSettings(env: NodeJS.ProcessEnv = process.env): HqSettings {
  const oldNames: string[] = [];
  const [url, token, raw] = NAMES.map(([name, oldName]) => {
    if (env[name] !== undefined) return env[name];
    if (env[oldName] !== undefined) oldNames.push(oldName);
    return env[oldName];
  });
  return {
    url: url || undefined,
    token: token || undefined,
    includeRawCalls: raw === "true",
    oldNames,
  };
}

export const oldNamesNotice = (oldNames: string[]): string =>
  `${oldNames.join(", ")} ${oldNames.length === 1 ? "is" : "are"} the old name${oldNames.length === 1 ? "" : "s"} for your team HQ's settings: rename to ${oldNames
    .map((n) => n.replace("CONTROL_PLANE", "HQ"))
    .join(", ")}. The old names still work for now.`;
