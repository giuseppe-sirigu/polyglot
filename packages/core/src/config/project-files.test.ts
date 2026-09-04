import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listProjectFiles } from "./project-files.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polyglot-files-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content = "x") {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("listProjectFiles", () => {
  it("lists project files relative to cwd, POSIX-separated", async () => {
    write("src/app.ts");
    write("README.md");
    const files = await listProjectFiles(dir);
    expect(files).toEqual(["README.md", "src/app.ts"]);
  });

  it("skips node_modules and .git", async () => {
    write("src/a.ts");
    write("node_modules/pkg/index.js");
    write(".git/HEAD");
    expect(await listProjectFiles(dir)).toEqual(["src/a.ts"]);
  });

  it("honours a root .gitignore", async () => {
    write("src/a.ts");
    write("out/bundle.js");
    write("debug.log");
    write(".gitignore", "out/\n*.log\n");
    expect(await listProjectFiles(dir)).toEqual([".gitignore", "src/a.ts"]);
  });

  it("skips secret files", async () => {
    write("src/a.ts");
    write(".env");
    write("id_rsa");
    expect(await listProjectFiles(dir)).toEqual(["src/a.ts"]);
  });

  it("respects the cap", async () => {
    for (let i = 0; i < 10; i++) write(`f${i}.txt`);
    expect(await listProjectFiles(dir, { limit: 3 })).toHaveLength(3);
  });
});
