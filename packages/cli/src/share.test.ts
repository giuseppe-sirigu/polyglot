import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, persistMessage, persistSessionHeader } from "@usepolyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliArgs } from "./args.js";
import { runShare } from "./share.js";

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
  share: true,
  shareFormat: "md",
  shareRedact: true,
  shareFull: false,
};

let home: string;
let realHome: string | undefined;
let out: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polyglot-share-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
  out = join(home, "export.md");
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
  await persistMessage(s.id, { id: "1", role: "user", content: "print the key", createdAt: 1 });
  await persistMessage(s.id, {
    id: "2",
    role: "assistant",
    content: "the key is sk-abcdefghijklmnopqrstuvwx",
    createdAt: 2,
  });
  return s.id;
}

describe("runShare", () => {
  it("writes a redacted markdown export for a session id", async () => {
    const id = await seedSession();
    const code = await runShare({ ...baseArgs, shareTarget: id, shareOut: out });
    expect(code).toBe(0);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("polyglot session");
    expect(md).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("--no-redact leaves secrets in", async () => {
    const id = await seedSession();
    await runShare({ ...baseArgs, shareTarget: id, shareOut: out, shareRedact: false });
    expect(readFileSync(out, "utf8")).toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("--format html writes an HTML document", async () => {
    const id = await seedSession();
    const htmlOut = join(home, "export.html");
    await runShare({ ...baseArgs, shareTarget: id, shareOut: htmlOut, shareFormat: "html" });
    expect(readFileSync(htmlOut, "utf8")).toContain("<!doctype html>");
  });

  it("accepts a .jsonl path as the target", async () => {
    const id = await seedSession();
    const src = join(home, ".polyglot", "sessions", `${id}.jsonl`);
    const copy = join(home, "shared.jsonl");
    await writeFile(copy, readFileSync(src, "utf8"));
    const code = await runShare({ ...baseArgs, shareTarget: copy, shareOut: out });
    expect(code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("polyglot session");
  });

  it("returns 1 when the session is not found", async () => {
    expect(await runShare({ ...baseArgs, shareTarget: "does-not-exist", shareOut: out })).toBe(1);
  });
});
