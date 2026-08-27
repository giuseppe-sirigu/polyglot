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
  persistSessionUsage,
  pruneSessions,
} from "./store.js";
import { createSession } from "./types.js";

// sessionsDir() resolves via node:os's homedir(), which reads the real process.env.HOME
// directly — same as config/loader.ts's globalSettingsPath(). Without overriding it here,
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
  it("has no lastContextTokens before any turn reports usage", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    const loaded = await loadSession(session.id);
    expect(loaded?.lastContextTokens).toBeUndefined();
  });

  it("loadSession restores the most recent usage count", async () => {
    const session = createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" });
    await persistSessionHeader(session);
    await persistSessionUsage(session.id, 845);
    await persistSessionUsage(session.id, 872);
    const loaded = await loadSession(session.id);
    expect(loaded?.lastContextTokens).toBe(872);
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
