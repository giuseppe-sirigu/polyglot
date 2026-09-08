import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Per-file cap on a skill's body, same as project instructions / agent prompts. */
const MAX_BODY_BYTES = 16_384;

export interface Skill {
  /** Activation name - `@<name>`. Lowercased directory name, or the frontmatter `name`. */
  name: string;
  description: string;
  /** The skill's instructions (everything after the frontmatter block). */
  body: string;
  /** Absolute path to the skill's directory - the model reads bundled resource files from here
   * by relative path. */
  dir: string;
  /** `~/.polyglot/skills/<name>/SKILL.md` or `.polyglot/skills/<name>/SKILL.md` - shown in `/skills`. */
  source: string;
}

function skillDirs(cwd: string): { dir: string; scope: "global" | "project" }[] {
  return [
    { dir: join(homedir(), ".polyglot", "skills"), scope: "global" },
    { dir: join(cwd, ".polyglot", "skills"), scope: "project" },
  ];
}

/** Parses a leading `---\n…\n---` block of `key: value` lines. Returns the parsed keys (lower-cased)
 * and the body after the block. Only `name` / `description` matter for a skill. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: raw };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    const key = kv?.[1];
    const value = kv?.[2];
    if (key === undefined || value === undefined) continue;
    meta[key.toLowerCase()] = value.trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: lines.slice(end + 1).join("\n") };
}

function readSkill(dir: string, dirName: string, source: string): Skill | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const { meta, body: rawBody } = parseFrontmatter(raw);
  let body = rawBody.trim();
  if (body.length === 0) return null;
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    body = `${body.slice(0, MAX_BODY_BYTES)}\n\n[... truncated]`;
  }
  const name = (meta.name || dirName).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
  return { name, description: meta.description ?? "", body, dir, source };
}

/**
 * Loads skills from `~/.polyglot/skills/<name>/SKILL.md` (global) and
 * `<cwd>/.polyglot/skills/<name>/SKILL.md` (project). A project skill with the same `name`
 * overrides the global one. Directories without a readable `SKILL.md`, or with an empty body /
 * bad name, are skipped. `POLYGLOT_NO_SKILLS` disables loading entirely.
 */
export function loadSkills(cwd: string, env: NodeJS.ProcessEnv = process.env): Skill[] {
  if (env.POLYGLOT_NO_SKILLS === "1" || env.POLYGLOT_NO_SKILLS === "true") return [];

  const byName = new Map<string, Skill>();
  for (const { dir, scope } of skillDirs(cwd)) {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const label =
        scope === "global"
          ? `~/.polyglot/skills/${entry}/SKILL.md`
          : `.polyglot/skills/${entry}/SKILL.md`;
      const skill = readSkill(join(dir, entry), entry, label);
      if (skill) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
