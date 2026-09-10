import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { grepTool } from "./grep.js";

let dir: string;
const ctx = () => ({ cwd: dir, sessionId: "s", signal: new AbortController().signal });
const run = (pattern: string, path?: string) =>
  grepTool.execute(path === undefined ? { pattern } : { pattern, path }, ctx());

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polyglot-grep-"));
  writeFileSync(join(dir, "service.json"), '{\n  "name": "api",\n  "port": 8443\n}\n');
  writeFileSync(join(dir, "notes.txt"), "the port is elsewhere\n");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("grepTool", () => {
  it("searches recursively under a directory (default: cwd)", async () => {
    const r = await run('"port"');
    expect(r.isError).toBeFalsy();
    expect(r.toModelText()).toContain("service.json:3:");
  });

  it("searches a single file when path points at one", async () => {
    const r = await run("port", "service.json");
    expect(r.isError).toBeFalsy();
    expect(r.toModelText()).toContain("service.json:3:");
    expect(r.toModelText()).not.toContain("notes.txt");
  });

  it("reports a genuine no-match in a single file as 'in <file>', not a silent empty walk", async () => {
    const r = await run("nonexistent-token", "service.json");
    expect(r.toModelText()).toBe("No matches for /nonexistent-token/ in service.json");
  });

  it("errors clearly when the path does not exist", async () => {
    const r = await run("port", "does/not/exist.json");
    expect(r.isError).toBe(true);
    expect(r.toModelText()).toContain("Path not found");
  });

  it("refuses to search a secret-looking file directly", async () => {
    writeFileSync(join(dir, ".env"), "API_KEY=sk-secret\n");
    const r = await run("KEY", ".env");
    expect(r.isError).toBe(true);
    expect(r.toModelText()).toMatch(/secret file/);
  });

  it("rejects an invalid regular expression", async () => {
    const r = await run("(unclosed");
    expect(r.isError).toBe(true);
    expect(r.toModelText()).toContain("Invalid regular expression");
  });
});
