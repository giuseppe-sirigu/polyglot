import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message, Session } from "./types.js";

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
 * append-only design — loadSession() takes the last one as the session's current name. */
interface SessionRenameLine {
  kind: "rename";
  name: string;
  renamedAt: number;
}

type SessionLine = SessionHeader | SessionMessageLine | SessionRenameLine;

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

export async function loadSession(sessionId: string): Promise<Session | null> {
  let raw: string;
  try {
    raw = await readFile(sessionPath(sessionId), "utf8");
  } catch {
    return null;
  }

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

  return {
    id: header.id,
    cwd: header.cwd,
    provider: header.provider,
    model: header.model,
    messages,
    ...(name ? { name } : {}),
  };
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
