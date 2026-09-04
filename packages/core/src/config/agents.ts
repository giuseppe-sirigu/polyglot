import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Per-file cap on an agent definition's prompt, same as project instructions. */
const MAX_PROMPT_BYTES = 16_384;

export interface AgentDefinition {
  /** Invoke name - `@<name>`. Lowercased filename stem, or the frontmatter `name`. */
  name: string;
  description: string;
  /** Tool-name allowlist. Undefined = all of the caller's tools. */
  tools?: string[];
  /** Model id/label to run this agent on. Undefined = the active model. */
  model?: string;
  /** The agent's system prompt (everything after the frontmatter block). */
  prompt: string;
  /** `~/.polyglot/agents/<file>` or `<file>` (project) - shown in `/agents`. */
  source: string;
}

function agentDirs(cwd: string): { dir: string; scope: "global" | "project" }[] {
  return [
    { dir: join(homedir(), ".polyglot", "agents"), scope: "global" },
    { dir: join(cwd, ".polyglot", "agents"), scope: "project" },
  ];
}

/** Parses a leading `---\n…\n---` YAML-ish frontmatter block: `key: value` lines, plus a
 * `tools` value that may be an inline comma list or a following `- item` block. Returns the
 * parsed keys and the body after the block. Not a full YAML parser - only what agent defs need. */
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: raw };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { meta: {}, body: raw };

  const meta: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem?.[1] !== undefined && currentListKey) {
      const list = meta[currentListKey];
      if (Array.isArray(list)) list.push(listItem[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    const key = kv?.[1];
    const value = kv?.[2];
    if (key === undefined || value === undefined) continue;
    const k = key.toLowerCase();
    if (value.trim() === "") {
      meta[k] = [];
      currentListKey = k;
    } else {
      meta[k] = value.trim();
      currentListKey = null;
    }
  }
  return { meta, body: lines.slice(end + 1).join("\n") };
}

function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : value.split(",");
  const cleaned = items.map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function str(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value.replace(/^["']|["']$/g, "") : undefined;
}

function readAgentFile(path: string, source: string): AgentDefinition | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  let prompt = body.trim();
  if (prompt.length === 0) return null;
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    prompt = `${prompt.slice(0, MAX_PROMPT_BYTES)}\n\n[... truncated]`;
  }
  const name = (str(meta.name) ?? basename(path).replace(/\.md$/i, "")).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
  return {
    name,
    description: str(meta.description) ?? "",
    tools: toList(meta.tools),
    model: str(meta.model),
    prompt,
    source,
  };
}

/**
 * Loads agent definitions from `~/.polyglot/agents/*.md` (global) and `<cwd>/.polyglot/agents/*.md`
 * (project). A project agent with the same `name` overrides the global one. Malformed files are
 * skipped. `POLYGLOT_NO_AGENTS` disables loading entirely.
 */
export function loadAgentDefinitions(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentDefinition[] {
  if (env.POLYGLOT_NO_AGENTS === "1" || env.POLYGLOT_NO_AGENTS === "true") return [];

  const byName = new Map<string, AgentDefinition>();
  for (const { dir, scope } of agentDirs(cwd)) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md"));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      const label = scope === "global" ? `~/.polyglot/agents/${file}` : `.polyglot/agents/${file}`;
      const def = readAgentFile(join(dir, file), label);
      if (def) byName.set(def.name, def);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
