import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { utimes } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSessions,
  loadSession,
  persistMessage,
  persistSessionHeader,
  persistSessionRename,
  persistTurnUsage,
  pruneSessions,
} from "./store.js";
import { createSession } from "./types.js";
import type { TurnUsage } from "./usage-accounting.js";

const turn = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  model: "m",
  inputTokens: 100,
  outputTokens: 20,
  costUSD: 0,
  ...over,
});

// sessionsDir() resolves via node:os's homedir(), which reads the real process.env.HOME
// directly - same as config/loader.ts's globalSettingsPath(). Without overriding it here,
// these tests would read and write the developer's actual ~/.polyglot/sessions/.
let homeDir: string;
let realHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "polyglot-sessions-home-"));
  realHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(homeDir, { recursive: true, force: true });
});

describe("session rename", () => {
  it("has no name before any rename", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    const loaded = await loadSession(session.id);
    expect(loaded?.name).toBeUndefined();
  });

  it("loadSession picks up a rename", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    await persistSessionRename(session.id, "my-feature");
    const loaded = await loadSession(session.id);
    expect(loaded?.name).toBe("my-feature");
  });

  it("the latest rename wins when there are several", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    await persistSessionRename(session.id, "first-name");
    await persistSessionRename(session.id, "second-name");
    const loaded = await loadSession(session.id);
    expect(loaded?.name).toBe("second-name");
  });

  it("listSessions surfaces the name alongside the message count", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    await persistMessage(session.id, {
      id: "1",
      role: "user",
      content: "hi",
      createdAt: Date.now(),
    });
    await persistSessionRename(session.id, "renamed");

    const summaries = await listSessions();
    const summary = summaries.find((s) => s.id === session.id);
    expect(summary?.name).toBe("renamed");
    expect(summary?.messageCount).toBe(1);
  });
});

describe("session usage", () => {
  it("has no usage or lastContextTokens before any turn reports usage", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    const loaded = await loadSession(session.id);
    expect(loaded?.lastContextTokens).toBeUndefined();
    expect(loaded?.usage).toBeUndefined();
  });

  it("folds every turn_usage line into cumulative totals and per-model breakdown", async () => {
    const session = createSession({ cwd: "/tmp", provider: "anthropic", model: "claude-opus-5" });
    await persistSessionHeader(session);
    await persistTurnUsage(
      session.id,
      turn({ model: "claude-opus-5", inputTokens: 800, outputTokens: 100, costUSD: 0.006_5 }),
    );
    await persistTurnUsage(
      session.id,
      turn({ model: "claude-opus-5", inputTokens: 900, outputTokens: 120, costUSD: 0.007_5 }),
    );
    await persistTurnUsage(
      session.id,
      turn({ model: "claude-haiku-4-5", inputTokens: 200, outputTokens: 40, costUSD: 0.000_4 }),
    );

    const loaded = await loadSession(session.id);
    expect(loaded?.lastContextTokens).toBe(200);
    expect(loaded?.usage?.inputTokens).toBe(1900);
    expect(loaded?.usage?.outputTokens).toBe(260);
    expect(loaded?.usage?.costUSD).toBeCloseTo(0.014_4, 6);
    expect(loaded?.usage?.byModel["claude-opus-5"]).toMatchObject({
      inputTokens: 1700,
      outputTokens: 220,
    });
    expect(loaded?.usage?.byModel["claude-haiku-4-5"]?.inputTokens).toBe(200);
  });

  it("folds a sub-agent turn_usage into byModel but not into lastContextTokens", async () => {
    const session = createSession({ cwd: "/tmp", provider: "anthropic", model: "claude-opus-5" });
    await persistSessionHeader(session);
    await persistTurnUsage(
      session.id,
      turn({ model: "claude-opus-5", inputTokens: 5000, outputTokens: 200, costUSD: 0.03 }),
    );
    // A trailing sub-agent turn on a cheaper model - its prompt size isn't the session's context.
    await persistTurnUsage(
      session.id,
      turn({ model: "claude-haiku-4-5", inputTokens: 300, outputTokens: 50, costUSD: 0.000_5 }),
      { subAgent: true },
    );

    const loaded = await loadSession(session.id);
    expect(loaded?.lastContextTokens).toBe(5000);
    expect(loaded?.usage?.inputTokens).toBe(5300);
    expect(loaded?.usage?.byModel["claude-haiku-4-5"]?.inputTokens).toBe(300);
  });

  it("still reads lastContextTokens from a legacy `usage` line (pre-A1 transcript)", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    const { appendFile } = await import("node:fs/promises");
    const path = join(homeDir, ".polyglot", "sessions", `${session.id}.jsonl`);
    await appendFile(
      path,
      `${JSON.stringify({ kind: "usage", inputTokens: 872, at: Date.now() })}\n`,
    );
    const loaded = await loadSession(session.id);
    expect(loaded?.lastContextTokens).toBe(872);
    expect(loaded?.usage).toBeUndefined();
  });
});

describe("pruneSessions", () => {
  const sessionsDir = () => join(homedir(), ".polyglot", "sessions");

  async function makeSession(ageDays: number): Promise<string> {
    const s = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(s);
    if (ageDays > 0) {
      const when = new Date(Date.now() - ageDays * 86_400_000);
      await utimes(join(sessionsDir(), `${s.id}.jsonl`), when, when);
    }
    return s.id;
  }

  it("deletes files older than the cutoff, keeps fresh ones, spares exceptId", async () => {
    const oldId = await makeSession(40);
    const oldKeptAsCurrent = await makeSession(40);
    const freshId = await makeSession(0);

    const removed = await pruneSessions(30, oldKeptAsCurrent);

    expect(removed).toBe(1);
    expect(existsSync(join(sessionsDir(), `${oldId}.jsonl`))).toBe(false);
    expect(existsSync(join(sessionsDir(), `${oldKeptAsCurrent}.jsonl`))).toBe(true);
    expect(existsSync(join(sessionsDir(), `${freshId}.jsonl`))).toBe(true);
  });

  it("is a no-op for a non-positive age or a missing directory", async () => {
    expect(await pruneSessions(0)).toBe(0);
    rmSync(sessionsDir(), { recursive: true, force: true });
    expect(await pruneSessions(30)).toBe(0);
  });
});
