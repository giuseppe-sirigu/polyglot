import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, persistMessage, persistSessionHeader } from "@usepolyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliArgs } from "./args.js";
import { runReplay } from "./replay.js";

const baseArgs: CliArgs = {
  help: false,
  version: false,
  init: false,
  print: false,
  outputFormat: "text",
  allowAll: false,
  noPersist: false,
  resume: false,
  probe: false,
  share: false,
  shareFormat: "md",
  shareRedact: true,
  shareFull: false,
  replay: true,
  replayExecute: false,
  replayOutputFormat: "text",
};

let home: string;
let realHome: string | undefined;
let stdout: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polyglot-replay-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
  stdout = "";
  // keep --save and config lookups inside the temp dir, never the real repo
  vi.spyOn(process, "cwd").mockReturnValue(home);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function seedSession(): Promise<string> {
  const s = createSession({ cwd: "/repo", provider: "openai-compatible", model: "qwen3-coder" });
  await persistSessionHeader(s);
  await persistMessage(s.id, {
    id: "1",
    role: "user",
    content: "What port does service.json use?",
    createdAt: 1,
  });
  await persistMessage(s.id, {
    id: "2",
    role: "assistant",
    content: '<tool_call name="read_file">\n{"path": "service.json"}\n</tool_call>',
    createdAt: 2,
  });
  await persistMessage(s.id, {
    id: "3",
    role: "user",
    content: '<tool_result name="read_file">\n{"port": 8443}\n</tool_result>',
    createdAt: 3,
  });
  await persistMessage(s.id, {
    id: "4",
    role: "assistant",
    content: "The port is 8443.",
    createdAt: 4,
  });
  return s.id;
}

describe("runReplay", () => {
  it("prints a per-turn parse-level report with no divergence for a clean session", async () => {
    const id = await seedSession();
    const code = await runReplay({ ...baseArgs, replayTarget: id });
    expect(code).toBe(0);
    expect(stdout).toContain("turn 0 [free-text]: read_file");
    expect(stdout).toContain("no divergence");
  });

  it("--output-format json emits the ReplayReport", async () => {
    const id = await seedSession();
    await runReplay({ ...baseArgs, replayTarget: id, replayOutputFormat: "json" });
    const report = JSON.parse(stdout);
    expect(report.sessionId).toBe(id);
    expect(report.summary.totalCalls).toBe(1);
    expect(report.turns[0].resolvedCalls[0].name).toBe("read_file");
  });

  it("--save writes a regression fixture", async () => {
    const id = await seedSession();
    const code = await runReplay({ ...baseArgs, replayTarget: id, replaySave: "clean-read" });
    expect(code).toBe(0);
    const fixture = JSON.parse(readFileSync(join(home, "clean-read.json"), "utf8"));
    expect(fixture.name).toBe("clean-read");
    expect(fixture.completions).toHaveLength(2);
    expect(fixture.expect.resolvedToolCalls).toEqual([
      { name: "read_file", input: { path: "service.json" } },
    ]);
  });

  it("returns 1 when the session is not found", async () => {
    expect(await runReplay({ ...baseArgs, replayTarget: "nope" })).toBe(1);
  });
});
