import { describe, expect, it } from "vitest";
import { bashTool } from "./bash.js";

const ctx = { cwd: process.cwd(), sessionId: "s", signal: new AbortController().signal };
const run = (command: string) => bashTool.execute({ command }, ctx);

// These exercise real /bin/bash - skip on Windows where the tool uses PowerShell instead.
describe.skipIf(process.platform === "win32")("bashTool", () => {
  it("reports a plain command's success and output", async () => {
    const r = await run("echo hello");
    expect(r.isError).toBeFalsy();
    expect(r.toModelText().trim()).toBe("hello");
  });

  it("reports a non-zero exit as an error", async () => {
    const r = await run("exit 3");
    expect(r.isError).toBe(true);
  });

  it("fails a pipeline when an early stage fails (pipefail), not just when the last one does", async () => {
    const r = await run("definitely-not-a-command | wc -l");
    expect(r.isError).toBe(true);
    expect(r.toModelText()).toMatch(/command not found/);
  });

  it("still succeeds for a healthy pipeline", async () => {
    const r = await run("printf 'a\\nb\\nc\\n' | wc -l");
    expect(r.isError).toBeFalsy();
    expect(r.toModelText().trim()).toBe("3");
  });
});
