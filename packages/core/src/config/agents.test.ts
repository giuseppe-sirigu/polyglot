import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentDefinitions } from "./agents.js";

// loadAgentDefinitions reads ~/.polyglot/agents via node:os homedir() (real process.env.HOME).
let home: string;
let cwd: string;
let realHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polyglot-agents-home-"));
  cwd = mkdtempSync(join(tmpdir(), "polyglot-agents-cwd-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const noEnv = {} as NodeJS.ProcessEnv;

function writeGlobal(name: string, body: string) {
  const dir = join(home, ".polyglot", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}
function writeProject(name: string, body: string) {
  const dir = join(cwd, ".polyglot", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe("loadAgentDefinitions", () => {
  it("returns [] when no agent dirs exist", () => {
    expect(loadAgentDefinitions(cwd, noEnv)).toEqual([]);
  });

  it("parses frontmatter: name, description, tools list, model", () => {
    writeProject(
      "reviewer.md",
      `---
name: reviewer
description: Reviews code for bugs
tools: read_file, grep, glob
model: llama3.2:3b
---
You are a meticulous code reviewer.`,
    );
    const [agent] = loadAgentDefinitions(cwd, noEnv);
    expect(agent).toMatchObject({
      name: "reviewer",
      description: "Reviews code for bugs",
      tools: ["read_file", "grep", "glob"],
      model: "llama3.2:3b",
      prompt: "You are a meticulous code reviewer.",
    });
    expect(agent?.source).toBe(".polyglot/agents/reviewer.md");
  });

  it("accepts a YAML-style `- item` tools block", () => {
    writeProject(
      "t.md",
      `---
name: t
tools:
  - read_file
  - bash
---
body`,
    );
    expect(loadAgentDefinitions(cwd, noEnv)[0]?.tools).toEqual(["read_file", "bash"]);
  });

  it("falls back to the filename stem when name is absent", () => {
    writeProject("Tester.md", "---\ndescription: runs tests\n---\nRun the tests.");
    const [agent] = loadAgentDefinitions(cwd, noEnv);
    expect(agent?.name).toBe("tester");
  });

  it("lets a project agent override a global one of the same name", () => {
    writeGlobal("reviewer.md", "---\nname: reviewer\ndescription: global\n---\nglobal prompt");
    writeProject("reviewer.md", "---\nname: reviewer\ndescription: project\n---\nproject prompt");
    const agents = loadAgentDefinitions(cwd, noEnv);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.description).toBe("project");
    expect(agents[0]?.prompt).toBe("project prompt");
  });

  it("skips malformed files (no body, bad name) without throwing", () => {
    writeProject("empty.md", "---\nname: empty\n---\n   \n");
    writeProject("bad name.md", "no frontmatter, filename has a space");
    writeProject("ok.md", "---\nname: ok\n---\nreal body");
    expect(loadAgentDefinitions(cwd, noEnv).map((a) => a.name)).toEqual(["ok"]);
  });

  it("returns [] when POLYGLOT_NO_AGENTS is set", () => {
    writeProject("reviewer.md", "---\nname: reviewer\n---\nbody");
    expect(loadAgentDefinitions(cwd, { POLYGLOT_NO_AGENTS: "1" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("sorts results by name", () => {
    writeProject("zeta.md", "---\nname: zeta\n---\nz");
    writeProject("alpha.md", "---\nname: alpha\n---\na");
    expect(loadAgentDefinitions(cwd, noEnv).map((a) => a.name)).toEqual(["alpha", "zeta"]);
  });
});
