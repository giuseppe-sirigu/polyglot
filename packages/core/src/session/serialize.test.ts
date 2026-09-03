import { describe, expect, it } from "vitest";
import { readFileTool } from "../tools/read.js";
import { ToolRegistry } from "../tools/types.js";
import { decodeSessionTurns, serializeSessionHtml, serializeSessionMarkdown } from "./serialize.js";
import type { Message, Session } from "./types.js";

function reg(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(readFileTool);
  return r;
}

let seq = 0;
const msg = (role: "user" | "assistant", content: string): Message => ({
  id: `m${seq++}`,
  role,
  content,
  createdAt: seq,
});

function session(messages: Message[], over: Partial<Session> = {}): Session {
  return {
    id: "sess-123",
    cwd: "/repo",
    provider: "openai-compatible",
    model: "qwen3-coder",
    messages,
    ...over,
  };
}

describe("decodeSessionTurns", () => {
  it("decodes a tagged tool call and pairs the following result to it", () => {
    const turns = decodeSessionTurns(
      [
        msg("user", "read app.ts"),
        msg("assistant", 'Reading.\n<tool_call name="read_file">\n{"path":"app.ts"}\n</tool_call>'),
        msg("user", '<tool_result name="read_file">\ncontents\n</tool_result>'),
        msg("assistant", "Done."),
      ],
      reg(),
    );
    const call = turns.find((t) => t.kind === "tool_call");
    const result = turns.find((t) => t.kind === "tool_result");
    expect(call).toMatchObject({ kind: "tool_call", name: "read_file", input: { path: "app.ts" } });
    expect(result).toMatchObject({ kind: "tool_result", name: "read_file", text: "contents" });
    expect(result && "toolCallId" in result && result.toolCallId).toBe(
      call && "toolCallId" in call && call.toolCallId,
    );
  });

  it("decodes a structured-envelope assistant message", () => {
    const turns = decodeSessionTurns(
      [
        msg("user", "hi"),
        msg(
          "assistant",
          JSON.stringify({
            message: "on it",
            tool_calls: [{ name: "read_file", arguments: { path: "x" } }],
          }),
        ),
      ],
      reg(),
    );
    expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "tool_call"]);
  });

  it("keeps a call to an unknown tool instead of dropping it", () => {
    const turns = decodeSessionTurns(
      [msg("assistant", '<tool_call name="web_search">\n{"query":"cats"}\n</tool_call>')],
      reg(), // no web_search registered
    );
    expect(turns).toEqual([expect.objectContaining({ kind: "tool_call", name: "web_search" })]);
  });

  it("marks an error tool result", () => {
    const turns = decodeSessionTurns(
      [msg("user", '<tool_result name="bash" status="error">\nboom\n</tool_result>')],
      reg(),
    );
    expect(turns[0]).toMatchObject({ kind: "tool_result", isError: true, text: "boom" });
  });
});

describe("serializeSessionMarkdown", () => {
  const s = session([
    msg("user", "print my key"),
    msg("assistant", '<tool_call name="read_file">\n{"path":".env"}\n</tool_call>'),
    msg(
      "user",
      '<tool_result name="read_file">\nOPENAI_KEY=sk-abcdefghijklmnopqrstuvwx\n</tool_result>',
    ),
    msg("assistant", "your key is sk-abcdefghijklmnopqrstuvwx"),
  ]);

  it("redacts by default: the secret value and the secret-path result are gone", () => {
    const md = serializeSessionMarkdown(s, reg());
    expect(md).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(md).toContain("redacted");
  });

  it("with --no-redact the secret is present", () => {
    const md = serializeSessionMarkdown(s, reg(), { redact: false });
    expect(md).toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("default renders tool calls as one-line summaries with no result body", () => {
    const md = serializeSessionMarkdown(s, reg(), { redact: false });
    expect(md).toMatch(/→ `read_file\(/);
    expect(md).not.toContain("```");
  });

  it("includeToolIO renders full args and results", () => {
    const md = serializeSessionMarkdown(s, reg(), { redact: false, includeToolIO: true });
    expect(md).toContain("### tool: read_file");
    expect(md).toContain("```");
  });
});

describe("serializeSessionHtml", () => {
  it("is one self-contained document with no external URL and escaped text", () => {
    const html = serializeSessionHtml(
      session([msg("user", "<script>alert(1)</script> & more")]),
      reg(),
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });
});
