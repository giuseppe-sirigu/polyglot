import { ToolRegistry, textResult } from "@usepolyglot/core";
import type { Message } from "@usepolyglot/core";
import { describe, expect, it } from "vitest";
import { reconstructTranscript } from "./transcript.js";

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file",
    description: "Read a file.",
    permission: "read",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input) {
      return textResult(`contents of ${(input as { path: string }).path}`);
    },
  });
  return registry;
}

function message(role: Message["role"], content: string): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
}

describe("reconstructTranscript", () => {
  it("renders a plain user/assistant round trip", () => {
    const items = reconstructTranscript(
      [message("user", "hello"), message("assistant", "hi there")],
      buildRegistry(),
    );
    expect(items).toEqual([
      { kind: "user", text: "hello" },
      { kind: "assistant", text: "hi there" },
    ]);
  });

  it("splits an assistant message's prose and tool call into separate items", () => {
    const content =
      'I\'ll check that file.\n<tool_call name="read_file">{"path": "a.txt"}</tool_call>';
    const items = reconstructTranscript([message("assistant", content)], buildRegistry());
    expect(items).toEqual([
      { kind: "assistant", text: "I'll check that file.\n" },
      {
        kind: "tool_call",
        name: "read_file",
        input: { path: "a.txt" },
        correctedFromName: undefined,
        toolCallId: expect.any(String),
      },
    ]);
  });

  it("parses a tool_result-wrapper user message into tool_result items instead of a user bubble", () => {
    const content = '<tool_result name="read_file">\ncontents of a.txt\n</tool_result>';
    const items = reconstructTranscript([message("user", content)], buildRegistry());
    expect(items).toEqual([
      { kind: "tool_result", name: "read_file", resultText: "contents of a.txt", isError: false },
    ]);
  });

  it("marks an error tool_result block accordingly", () => {
    const content = '<tool_result name="read_file" status="error">\nfile not found\n</tool_result>';
    const items = reconstructTranscript([message("user", content)], buildRegistry());
    expect(items).toEqual([
      { kind: "tool_result", name: "read_file", resultText: "file not found", isError: true },
    ]);
  });

  it("surfaces an unresolvable tool call as a tool_parse_error", () => {
    const content = '<tool_call name="not_a_real_tool">{}</tool_call>';
    const items = reconstructTranscript([message("assistant", content)], buildRegistry());
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("tool_parse_error");
  });

  it("skips whitespace-only prose segments around a tool call", () => {
    const content = '<tool_call name="read_file">{"path": "a.txt"}</tool_call>\n';
    const items = reconstructTranscript([message("assistant", content)], buildRegistry());
    expect(items).toEqual([
      {
        kind: "tool_call",
        name: "read_file",
        input: { path: "a.txt" },
        correctedFromName: undefined,
        toolCallId: expect.any(String),
      },
    ]);
  });

  it("keeps a long plain-text reply as one assistant item, not split into fragments", () => {
    // ToolCallStreamParser is built for incremental streaming and holds back a trailing slice
    // in case a marker was split across chunks - feeding it a whole message in one push() can
    // still yield several "text" events for ordinary prose with no tool call in it at all, once
    // it's longer than that reserve. Regression test for exactly that.
    const content = "Why don't scientists trust atoms?\n\nBecause they make up everything!";
    const items = reconstructTranscript([message("assistant", content)], buildRegistry());
    expect(items).toEqual([{ kind: "assistant", text: content }]);
  });

  it("decodes a structured-output envelope's message and tool calls", () => {
    const content = JSON.stringify({
      message: "Sure, here's the file.",
      tool_calls: [{ name: "read_file", arguments: { path: "a.txt" } }],
    });
    const items = reconstructTranscript([message("assistant", content)], buildRegistry());
    expect(items).toEqual([
      { kind: "assistant", text: "Sure, here's the file." },
      {
        kind: "tool_call",
        name: "read_file",
        input: { path: "a.txt" },
        correctedFromName: undefined,
        toolCallId: expect.any(String),
      },
    ]);
  });

  it("omits the assistant item for a structured-output envelope with an empty message", () => {
    const content = JSON.stringify({ message: "", tool_calls: [] });
    const items = reconstructTranscript([message("assistant", content)], buildRegistry());
    expect(items).toEqual([]);
  });
});
