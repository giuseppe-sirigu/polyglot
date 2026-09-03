import { appendFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message, Session } from "./types.js";
import { type TurnUsage, addTurnUsage, emptyUsageTotals } from "./usage-accounting.js";

const DAY_MS = 86_400_000;

interface SessionHeader {
  kind: "header";
  id: string;
  cwd: string;
  provider: string;
  model: string;
  createdAt: number;
}

interface SessionMessageLine {
  kind: "message";
  message: Message;
}

/** Appended by /rename rather than rewriting the header in place, keeping the store's
 * append-only design - loadSession() takes the last one as the session's current name. */
interface SessionRenameLine {
  kind: "rename";
  name: string;
  renamedAt: number;
}

/** Pre-A1 usage line: input tokens only. Still read by loadSession() for old transcripts, no
 * longer written (superseded by SessionTurnUsageLine). */
interface SessionUsageLine {
  kind: "usage";
  inputTokens: number;
  at: number;
}

/** Appended after each turn that reported provider usage. loadSession() folds every one of
 * these into `session.usage` (cumulative tokens + cost, per model) and takes the last one's
 * `inputTokens` as the starting context size so `--resume` shows an accurate indicator right
 * away. `costUSD` is stored so a later pricing-table change doesn't rewrite history. */
interface SessionTurnUsageLine extends TurnUsage {
  kind: "turn_usage";
  at: number;
  /** Set when this turn was a `task` sub-agent's, not the main session's. Folded into
   * `usage.byModel` like any other turn (sub-agent cost is real), but excluded from the
   * `lastContextTokens` calculation - a sub-agent's prompt size isn't the session's. */
  subAgent?: boolean;
}

type SessionLine =
  | SessionHeader
  | SessionMessageLine
  | SessionRenameLine
  | SessionUsageLine
  | SessionTurnUsageLine;

export interface SessionSummary {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  name?: string;
  messageCount: number;
  updatedAt: number;
}

function sessionsDir(): string {
  return join(homedir(), ".polyglot", "sessions");
}

function sessionPath(sessionId: string): string {
  return join(sessionsDir(), `${sessionId}.jsonl`);
}

export async function persistSessionHeader(session: Session): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true });
  const header: SessionHeader = {
    kind: "header",
    id: session.id,
    cwd: session.cwd,
    provider: session.provider,
    model: session.model,
    createdAt: Date.now(),
  };
  await appendFile(sessionPath(session.id), `${JSON.stringify(header)}\n`, "utf8");
}

export async function persistMessage(sessionId: string, message: Message): Promise<void> {
  const line: SessionMessageLine = { kind: "message", message };
  await appendFile(sessionPath(sessionId), `${JSON.stringify(line)}\n`, "utf8");
}

export async function persistSessionRename(sessionId: string, name: string): Promise<void> {
  const line: SessionRenameLine = { kind: "rename", name, renamedAt: Date.now() };
  await appendFile(sessionPath(sessionId), `${JSON.stringify(line)}\n`, "utf8");
}

export async function persistTurnUsage(
  sessionId: string,
  turn: TurnUsage,
  opts?: { subAgent?: boolean },
): Promise<void> {
  const line: SessionTurnUsageLine = {
    kind: "turn_usage",
    ...turn,
    at: Date.now(),
    ...(opts?.subAgent ? { subAgent: true } : {}),
  };
  await appendFile(sessionPath(sessionId), `${JSON.stringify(line)}\n`, "utf8");
}

/** Parses the JSONL body of a session file into a `Session`. Returns null when there's no
 * header line. Shared by `loadSession` (by id) and `loadSessionFromPath` (by path, for
 * `--resume <file>`). */
export function parseSessionLines(raw: string): Session | null {
  const lines = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionLine);
  const header = lines.find((l): l is SessionHeader => l.kind === "header");
  if (!header) return null;

  const messages = lines
    .filter((l): l is SessionMessageLine => l.kind === "message")
    .map((l) => l.message);
  const renames = lines.filter((l): l is SessionRenameLine => l.kind === "rename");
  const name = renames.at(-1)?.name;

  const turnUsages = lines.filter((l): l is SessionTurnUsageLine => l.kind === "turn_usage");
  const usage =
    turnUsages.length > 0
      ? turnUsages.reduce((acc, l) => addTurnUsage(acc, l), emptyUsageTotals())
      : undefined;
  // Prefer a main-session turn_usage line (a trailing sub-agent turn's prompt size isn't the
  // session's context); fall back to a legacy `usage` line for pre-A1 transcripts.
  const legacyUsages = lines.filter((l): l is SessionUsageLine => l.kind === "usage");
  const lastContextTokens =
    turnUsages.filter((l) => !l.subAgent).at(-1)?.inputTokens ?? legacyUsages.at(-1)?.inputTokens;

  return {
    id: header.id,
    cwd: header.cwd,
    provider: header.provider,
    model: header.model,
    messages,
    ...(name ? { name } : {}),
    ...(lastContextTokens !== undefined ? { lastContextTokens } : {}),
    ...(usage ? { usage } : {}),
  };
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  try {
    return parseSessionLines(await readFile(sessionPath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

/** Loads a session from an arbitrary `.jsonl` path (a copied or shared session file) rather
 * than by id from `~/.polyglot/sessions/`. Used by `--resume <path>`. */
export async function loadSessionFromPath(path: string): Promise<Session | null> {
  try {
    return parseSessionLines(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Deletes persisted session files whose last-modified time is older than `maxAgeDays`.
 * Best-effort - unreadable dir or a failed unlink is swallowed. `exceptId` (the active session)
 * is never deleted. Returns the number of files removed. */
export async function pruneSessions(maxAgeDays: number, exceptId?: string): Promise<number> {
  if (!(maxAgeDays > 0)) return 0;
  const dir = sessionsDir();
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  let removed = 0;
  for (const file of files) {
    if (exceptId && file === `${exceptId}.jsonl`) continue;
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

export async function listSessions(): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = (await readdir(sessionsDir())).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, "");
    const session = await loadSession(sessionId);
    if (!session) continue;
    const stats = await stat(join(sessionsDir(), file)).catch(() => null);
    summaries.push({
      id: session.id,
      cwd: session.cwd,
      provider: session.provider,
      model: session.model,
      ...(session.name ? { name: session.name } : {}),
      messageCount: session.messages.length,
      updatedAt: stats?.mtimeMs ?? 0,
    });
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}
