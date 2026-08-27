import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSessions,
  loadSession,
  persistMessage,
  persistSessionHeader,
  persistSessionRename,
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
