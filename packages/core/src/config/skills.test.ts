import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSkills } from "./skills.js";

// loadSkills reads ~/.polyglot/skills via node:os homedir() (real process.env.HOME).
let home: string;
let cwd: string;
let realHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polyglot-skills-home-"));
  cwd = mkdtempSync(join(tmpdir(), "polyglot-skills-cwd-"));
  realHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const noEnv = {} as NodeJS.ProcessEnv;

function writeSkill(root: string, name: string, contents: string) {
  const dir = join(root, ".polyglot", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), contents);
  return dir;
}

describe("loadSkills", () => {
  it("returns [] when no skill dirs exist", () => {
    expect(loadSkills(cwd, noEnv)).toEqual([]);
  });

  it("loads a project skill: frontmatter description + body, dir points at the bundle", () => {
    const dir = writeSkill(
      cwd,
      "haiku",
      `---
description: Reply only in haiku
---
Every reply must be a haiku: three lines, 5-7-5 syllables.`,
    );
    const [skill] = loadSkills(cwd, noEnv);
    expect(skill).toMatchObject({
      name: "haiku",
      description: "Reply only in haiku",
      body: "Every reply must be a haiku: three lines, 5-7-5 syllables.",
      dir,
      source: ".polyglot/skills/haiku/SKILL.md",
    });
  });

  it("falls back to the directory name when frontmatter name is absent", () => {
    writeSkill(cwd, "Reviewer", "no frontmatter here, just a body");
    expect(loadSkills(cwd, noEnv)[0]?.name).toBe("reviewer");
  });

  it("honours a frontmatter name over the directory name", () => {
    writeSkill(cwd, "dir-name", "---\nname: real-name\n---\nbody");
    expect(loadSkills(cwd, noEnv)[0]?.name).toBe("real-name");
  });

  it("lets a project skill override a global one of the same name", () => {
    writeSkill(home, "haiku", "---\ndescription: global\n---\nglobal body");
    writeSkill(cwd, "haiku", "---\ndescription: project\n---\nproject body");
    const skills = loadSkills(cwd, noEnv);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("project");
    expect(skills[0]?.body).toBe("project body");
  });

  it("skips a directory with no SKILL.md or an empty body", () => {
    mkdirSync(join(cwd, ".polyglot", "skills", "empty-dir"), { recursive: true });
    writeSkill(cwd, "blank", "---\ndescription: x\n---\n   \n");
    writeSkill(cwd, "ok", "---\ndescription: y\n---\nreal body");
    expect(loadSkills(cwd, noEnv).map((s) => s.name)).toEqual(["ok"]);
  });

  it("returns [] when POLYGLOT_NO_SKILLS is set", () => {
    writeSkill(cwd, "haiku", "---\ndescription: x\n---\nbody");
    expect(loadSkills(cwd, { POLYGLOT_NO_SKILLS: "1" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("sorts results by name", () => {
    writeSkill(cwd, "zeta", "---\n---\nz");
    writeSkill(cwd, "alpha", "---\n---\na");
    expect(loadSkills(cwd, noEnv).map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });
});
