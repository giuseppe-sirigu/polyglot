import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHookDispatcher } from "./dispatcher.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "polyglot-hooks-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function dispatcher(hooks: Partial<Parameters<typeof createHookDispatcher>[0]>) {
  const warnings: string[] = [];
  const d = createHookDispatcher(
    { preToolUse: [], postToolUse: [], userPromptSubmit: [], ...hooks },
    { cwd, onWarn: (m) => warnings.push(m) },
  );
  return { d, warnings };
}

describe("createHookDispatcher", () => {
  it("no hooks configured -> immediate empty outcome, nothing spawned", async () => {
    const { d } = dispatcher({});
    expect(d.hasAny("preToolUse")).toBe(false);
    expect(await d.preToolUse("bash", {})).toEqual({});
  });

  it("exit 0 with no output proceeds", async () => {
    const { d } = dispatcher({ preToolUse: [{ command: "true" }] });
    expect(await d.preToolUse("bash", { command: "ls" })).toEqual({});
  });

  it("exit 2 blocks, with stderr as the reason", async () => {
    const { d } = dispatcher({
      preToolUse: [{ command: 'echo "no rm allowed" >&2; exit 2' }],
    });
    expect(await d.preToolUse("bash", {})).toEqual({ block: "no rm allowed" });
  });

  it("stdout JSON { decision: block } blocks on exit 0", async () => {
    const { d } = dispatcher({
      postToolUse: [{ command: `echo '{"decision":"block","reason":"policy says no"}'` }],
    });
    expect(await d.postToolUse("bash", {}, "output", false)).toEqual({ block: "policy says no" });
  });

  it("userPromptSubmit additionalContext is passed through and concatenated", async () => {
    const { d } = dispatcher({
      userPromptSubmit: [
        { command: `echo '{"additionalContext":"repo is frozen"}'` },
        { command: `echo '{"additionalContext":"use pnpm"}'` },
      ],
    });
    expect(await d.userPromptSubmit("do a thing")).toEqual({
      additionalContext: "repo is frozen\n\nuse pnpm",
    });
  });

  it("the `tools` glob filters which calls a hook fires for", async () => {
    const { d } = dispatcher({
      preToolUse: [{ command: "exit 2", tools: ["bash", "web_*"] }],
    });
    expect(await d.preToolUse("bash", {})).toMatchObject({ block: expect.any(String) });
    expect(await d.preToolUse("web_fetch", {})).toMatchObject({ block: expect.any(String) });
    expect(await d.preToolUse("read_file", {})).toEqual({});
  });

  it("a non-2 failure is non-blocking and warns", async () => {
    const { d, warnings } = dispatcher({
      preToolUse: [{ command: 'echo "boom" >&2; exit 1' }],
    });
    expect(await d.preToolUse("bash", {})).toEqual({});
    expect(warnings[0]).toMatch(/preToolUse hook exited 1/);
  });

  it("a hook receives the payload on stdin", async () => {
    const { d } = dispatcher({
      // block iff the piped-in JSON mentions the bash tool
      preToolUse: [{ command: `grep -q '"toolName":"bash"' && exit 2 || exit 0` }],
    });
    expect(await d.preToolUse("bash", { command: "x" })).toMatchObject({
      block: expect.any(String),
    });
    expect(await d.preToolUse("grep", {})).toEqual({});
  });

  it("the first blocking hook in a chain short-circuits", async () => {
    const { d } = dispatcher({
      preToolUse: [{ command: "exit 2" }, { command: "exit 0" }],
    });
    expect(await d.preToolUse("bash", {})).toMatchObject({ block: expect.any(String) });
  });
});
