import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectInstructions } from "./instructions.js";

// loadProjectInstructions reads ~/.polyglot via node:os homedir(), which reads the real
// process.env.HOME - same pattern as config/loader.ts. Override HOME for the test.
let home: string;
let cwd: string;
let realHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polyglot-instr-home-"));
  cwd = mkdtempSync(join(tmpdir(), "polyglot-instr-cwd-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
  mkdirSync(join(home, ".polyglot"), { recursive: true });
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const noEnv = {} as NodeJS.ProcessEnv;

describe("loadProjectInstructions", () => {
  it("returns empty when no files exist", () => {
    expect(loadProjectInstructions(cwd, noEnv)).toEqual({ text: "", sources: [] });
  });

  it("reads a project AGENTS.md", () => {
    writeFileSync(join(cwd, "AGENTS.md"), "Always write tests first.");
    const r = loadProjectInstructions(cwd, noEnv);
    expect(r.sources).toEqual(["AGENTS.md"]);
    expect(r.text).toContain("# From AGENTS.md");
    expect(r.text).toContain("Always write tests first.");
  });

  it("appends POLYGLOT.md after AGENTS.md", () => {
    writeFileSync(join(cwd, "AGENTS.md"), "agents rule");
    writeFileSync(join(cwd, "POLYGLOT.md"), "polyglot rule");
    const r = loadProjectInstructions(cwd, noEnv);
    expect(r.sources).toEqual(["AGENTS.md", "POLYGLOT.md"]);
    expect(r.text.indexOf("agents rule")).toBeLessThan(r.text.indexOf("polyglot rule"));
  });

  it("puts global instructions before project ones", () => {
    writeFileSync(join(home, ".polyglot", "AGENTS.md"), "global rule");
    writeFileSync(join(cwd, "POLYGLOT.md"), "project rule");
    const r = loadProjectInstructions(cwd, noEnv);
    expect(r.sources).toEqual(["~/.polyglot/AGENTS.md", "POLYGLOT.md"]);
    expect(r.text.indexOf("global rule")).toBeLessThan(r.text.indexOf("project rule"));
  });

  it("ignores an empty / whitespace-only file", () => {
    writeFileSync(join(cwd, "AGENTS.md"), "   \n  \n");
    expect(loadProjectInstructions(cwd, noEnv)).toEqual({ text: "", sources: [] });
  });

  it("truncates a file past the size cap", () => {
    writeFileSync(join(cwd, "POLYGLOT.md"), "x".repeat(20_000));
    const r = loadProjectInstructions(cwd, noEnv);
    expect(r.text).toMatch(/\[\.\.\. truncated at 16 KB\]/);
    expect(r.text.length).toBeLessThan(17_000);
  });

  it("skips loading entirely with POLYGLOT_NO_INSTRUCTIONS", () => {
    writeFileSync(join(cwd, "AGENTS.md"), "should be ignored");
    expect(
      loadProjectInstructions(cwd, { POLYGLOT_NO_INSTRUCTIONS: "1" } as NodeJS.ProcessEnv),
    ).toEqual({
      text: "",
      sources: [],
    });
  });
});
