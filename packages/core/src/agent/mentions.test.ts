import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandFileMentions } from "./mentions.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polyglot-mentions-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("expandFileMentions", () => {
  it("inlines a mentioned file inside a <file> block", async () => {
    write("src/app.ts", "line one\nline two\n");
    const r = await expandFileMentions("explain @src/app.ts please", dir);
    expect(r.text).toContain('<file path="src/app.ts">');
    expect(r.text).toContain("line one\nline two");
    expect(r.text).toContain("</file>");
    expect(r.attached).toEqual([{ path: "src/app.ts", lines: 3 }]);
    expect(r.text.startsWith("explain")).toBe(true);
    expect(r.text.trimEnd().endsWith("please")).toBe(true);
  });

  it("leaves plain text and unresolvable @tokens untouched", async () => {
    const r = await expandFileMentions("ping @nobody and @not/a/file.ts", dir);
    expect(r.text).toBe("ping @nobody and @not/a/file.ts");
    expect(r.attached).toEqual([]);
  });

  it("does not trigger on an @ mid-word", async () => {
    write("bar.com", "secret");
    const r = await expandFileMentions("email foo@bar.com", dir);
    expect(r.text).toBe("email foo@bar.com");
  });

  it("skips a secret file, reports it, does not inline", async () => {
    write(".env.local", "AWS_SECRET=AKIA000000000000\n");
    const r = await expandFileMentions("check @.env.local", dir);
    expect(r.text).toBe("check @.env.local");
    expect(r.skipped).toEqual([".env.local"]);
    expect(r.text).not.toContain("AKIA");
  });

  it("truncates a file over the cap", async () => {
    write("big.txt", "a".repeat(80_000));
    const r = await expandFileMentions("@big.txt", dir);
    expect(r.text).toContain("[... truncated]");
    expect(r.text.length).toBeLessThan(70_000);
  });

  it("expands several mentions in one message", async () => {
    write("a.txt", "AAA");
    write("b.txt", "BBB");
    const r = await expandFileMentions("@a.txt then @b.txt", dir);
    expect(r.attached.map((a) => a.path)).toEqual(["a.txt", "b.txt"]);
    expect(r.text).toContain("AAA");
    expect(r.text).toContain("BBB");
  });

  it("does not escape cwd via ..", async () => {
    write("inside.txt", "ok");
    const r = await expandFileMentions("@../outside.txt", dir);
    expect(r.text).toBe("@../outside.txt");
    expect(r.attached).toEqual([]);
  });
});
