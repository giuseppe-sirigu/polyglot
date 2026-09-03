import { describe, expect, it } from "vitest";
import { repairJson } from "./json-repair.js";

const FILE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

switch (cmd) {
  case "list":
    todos.forEach((t, i) => console.log(\`\${i}. [\${t.done ? "x" : " "}] \${t.text}\`));
    break;
  case "count":
    console.log(\`Total: \${todos.length}\`);
    break;
}
`;

function ok(r: ReturnType<typeof repairJson>): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value as Record<string, unknown>;
}

describe("repairJson - basics", () => {
  it("parses clean JSON untouched", () => {
    expect(ok(repairJson('{"path": "a.ts", "content": "x"}'))).toEqual({
      path: "a.ts",
      content: "x",
    });
  });

  it("repairs trailing commas / single quotes via jsonrepair", () => {
    expect(ok(repairJson("{'path': 'a.ts',}"))).toEqual({ path: "a.ts" });
  });

  it("strips a fenced or tagged wrapper around the whole body", () => {
    expect(ok(repairJson('```json\n{"path": "a.ts"}\n```'))).toEqual({ path: "a.ts" });
    expect(ok(repairJson('<syntax>{"path": "a.ts"}</syntax>'))).toEqual({ path: "a.ts" });
    expect(ok(repairJson('```json{"path":"a"}```'))).toEqual({ path: "a" });
  });

  it("strips a fence nested inside a wrapper tag", () => {
    expect(ok(repairJson('<block>\n```json\n{"path": "a.ts"}\n```\n</block>'))).toEqual({
      path: "a.ts",
    });
  });

  it("returns quickly on a whitespace-heavy body with no wrapper (no super-linear backtracking)", () => {
    const evil = `${" ".repeat(100_000)}\n`.repeat(3);
    const start = performance.now();
    expect(repairJson(evil).ok).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("merges a body split into several back-to-back objects into one", () => {
    const body =
      '{"path": "a.ts", "old_string": "const x = 1;\\nconst y = 2;"}\n' +
      '{"new_string": "const x = 1;\\nconst y = 2;\\nconst z = 3;"}';
    expect(ok(repairJson(body))).toEqual({
      path: "a.ts",
      old_string: "const x = 1;\nconst y = 2;",
      new_string: "const x = 1;\nconst y = 2;\nconst z = 3;",
    });
  });

  it("leaves a genuine JSON array alone", () => {
    const r = repairJson('[{"a": 1}, {"b": 2}]');
    expect(r.ok && r.value).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("still errors on a body that is just prose", () => {
    expect(repairJson("here is what I would do").ok).toBe(false);
  });
});

describe("repairJson - trailing blob field (write_file with an unescaped file body)", () => {
  it("recovers content with real newlines and unescaped interior quotes", () => {
    const body = `{"path": "todo.mjs", "content": "${FILE}"}`;
    const v = ok(repairJson(body));
    expect(v.path).toBe("todo.mjs");
    expect(String(v.content)).toContain('case "count"');
    expect(String(v.content).trim()).toBe(FILE.trim());
  });

  it("recovers content the model wrapped in backticks instead of a JSON string", () => {
    const body = `{"path":"todo.mjs","content":\`${FILE}\`}`;
    const v = ok(repairJson(body));
    expect(String(v.content).trim()).toBe(FILE.trim());
  });

  it("recovers content flattened to one line with literal \\n escapes but broken quoting", () => {
    const flattened = FILE.replace(/\n/g, "\\n");
    const v = ok(repairJson(`{"path": "todo.mjs", "content": "${flattened}"}`));
    expect(String(v.content).trim()).toBe(FILE.trim());
  });

  it("leaves a well-formed multi-field body alone", () => {
    const body = JSON.stringify({ path: "a.ts", content: FILE });
    const v = ok(repairJson(body));
    expect(v.content).toBe(FILE);
  });

  it("bails (does not fabricate) when the blob is not the last field", () => {
    const body = `{"content": "${FILE}", "path": "a.ts"}`;
    expect(repairJson(body).ok).toBe(false);
  });

  it("only runs when jsonrepair has already failed on the whole body", () => {
    // jsonrepair handles simple truncation itself; the blob extractor is downstream of it.
    const v = ok(repairJson(`{"path": "a.ts", "content": "line1\\nline2`));
    expect(v.path).toBe("a.ts");
  });

  it('is not fooled by a "key": pattern sitting inside the unescaped blob', () => {
    // the file body contains `? "x" : " "` - a `"x":`-shaped run
    const body = `{"path": "todo.mjs", "content": "${FILE}"}`;
    const v = ok(repairJson(body));
    expect(v.path).toBe("todo.mjs");
    expect(String(v.content)).toContain('t.done ? "x" : " "');
  });
});
