import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editFileTool } from "./edit.js";
import type { ToolExecutionContext } from "./types.js";

let dir: string;
const ctx = (): ToolExecutionContext => ({
  cwd: dir,
  sessionId: "test",
  signal: new AbortController().signal,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polyglot-edit-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

const TODO = `switch (cmd) {
  case "list":
    todos.forEach((t, i) => console.log(\`\${i}. [\${t.done ? "x" : " "}] \${t.text}\`));
    break;
  default:
    console.log("usage: todo <add|list>");
}
`;

describe("editFileTool", () => {
  it("does an exact single-occurrence replacement", async () => {
    const p = seed("a.txt", "alpha\nbeta\ngamma\n");
    const r = await editFileTool.execute(
      { path: p, old_string: "beta", new_string: "BETA" },
      ctx(),
    );
    expect(r.isError).toBeFalsy();
    expect(readFileSync(p, "utf8")).toBe("alpha\nBETA\ngamma\n");
  });

  it("refuses an ambiguous match", async () => {
    const p = seed("a.txt", "x\nx\n");
    const r = await editFileTool.execute({ path: p, old_string: "x", new_string: "y" }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/matches 2 places/);
  });

  it("reports no match with guidance, not a regex hint", async () => {
    const p = seed("a.txt", "hello world\n");
    const r = await editFileTool.execute(
      { path: p, old_string: "goodbye", new_string: "hi" },
      ctx(),
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/literal text, not a regex/);
  });

  it("recovers from a model that doubled its escapes", async () => {
    const p = seed("todo.mjs", TODO);
    // The model, told to escape, emitted `\${i}` / `\"x\"` / `\n` as literal backslash sequences
    // and flattened the indentation.
    const old_string =
      'case \\"list\\":\ntodos.forEach((t, i) => console.log(`\\${i}. [\\${t.done ? \\"x\\" : \\" \\"}] \\${t.text}`));\nbreak;';
    const new_string =
      'case \\"count\\":\nconsole.log(`Number of todos: \\${todos.length}`);\nbreak;\ncase \\"list\\":\ntodos.forEach((t, i) => console.log(`\\${i}. [\\${t.done ? \\"x\\" : \\" \\"}] \\${t.text}`));\nbreak;';
    const r = await editFileTool.execute({ path: p, old_string, new_string }, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/normalizing whitespace\/escaping/);
    const out = readFileSync(p, "utf8");
    expect(out).toContain("Number of todos:");
    // real template syntax preserved, no stray backslashes introduced
    expect(out).not.toContain('\\"x\\"');
    expect(out).not.toContain("\\${");
    expect(out).toContain('${t.done ? "x" : " "}');
  });

  it("tolerates pure indentation drift and re-anchors the replacement", async () => {
    const p = seed("todo.mjs", TODO);
    const r = await editFileTool.execute(
      {
        path: p,
        old_string:
          'case "list":\ntodos.forEach((t, i) => console.log(`${i}. [${t.done ? "x" : " "}] ${t.text}`));\nbreak;',
        new_string:
          'case "count":\nconsole.log(`n: ${todos.length}`);\nbreak;\ncase "list":\ntodos.forEach((t, i) => console.log(`${i}. [${t.done ? "x" : " "}] ${t.text}`));\nbreak;',
      },
      ctx(),
    );
    expect(r.isError).toBeFalsy();
    const out = readFileSync(p, "utf8");
    // the injected `case "count":` lines carry the file's indentation, not column 0
    expect(out).toMatch(/\n {2}case "count":/);
    expect(out).not.toMatch(/\ncase "count":/);
  });

  it("takes the exact match when old_string is unique, ignoring a similar trimmed line", async () => {
    const p = seed("a.txt", "alpha\n  beta\nbeta\n");
    const r = await editFileTool.execute(
      { path: p, old_string: "  beta", new_string: "  BETA" },
      ctx(),
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).not.toMatch(/normalizing/);
    expect(readFileSync(p, "utf8")).toBe("alpha\n  BETA\nbeta\n");
  });

  it("does not touch a file that legitimately contains a backslash-n", async () => {
    const p = seed("re.txt", "const re = /foo\\nbar/;\n");
    const r = await editFileTool.execute(
      { path: p, old_string: "/foo\\nbar/", new_string: "/foo\\s+bar/" },
      ctx(),
    );
    expect(r.isError).toBeFalsy();
    expect(readFileSync(p, "utf8")).toBe("const re = /foo\\s+bar/;\n");
  });
});
