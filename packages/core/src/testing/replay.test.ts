import { describe, expect, it } from "vitest";
import type { Message, Session } from "../session/types.js";
import { ToolRegistry } from "../tools/types.js";
import { DEFAULT_SCENARIO_TOOLS } from "./agent-scenario.js";
import { replaySession } from "./replay.js";

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const tool of DEFAULT_SCENARIO_TOOLS) r.register(tool);
  return r;
}

function session(messages: Array<Pick<Message, "role" | "content">>): Session {
  return {
    id: "test-session",
    cwd: "/tmp",
    provider: "test",
    model: "test",
    messages: messages.map((m, i) => ({ ...m, id: `m${i}`, createdAt: i })),
  };
}

const xml = (name: string, args: Record<string, unknown>) =>
  `<tool_call name="${name}">\n${JSON.stringify(args)}\n</tool_call>`;

describe("replaySession", () => {
  it("resolves a clean free-text session and matches the recorded results", () => {
    const s = session([
      { role: "user", content: "What port does service.json configure?" },
      { role: "assistant", content: xml("read_file", { path: "service.json" }) },
      { role: "user", content: '<tool_result name="read_file">\n{"port":8443}\n</tool_result>' },
      { role: "assistant", content: "The port is 8443." },
    ]);

    const report = replaySession(s, registry());

    expect(report.turns).toHaveLength(2);
    expect(report.turns[0]?.resolvedCalls).toEqual([
      { name: "read_file", input: { path: "service.json" }, repaired: false },
    ]);
    expect(report.turns[0]?.transport).toBe("free-text");
    expect(report.turns[1]?.resolvedCalls).toHaveLength(0);
    expect(report.divergences).toHaveLength(0);
    expect(report.summary.totalCalls).toBe(1);
  });

  it("flags a turn whose extracted tool-call count no longer matches the transcript", () => {
    const s = session([
      { role: "user", content: "go" },
      { role: "assistant", content: "just text, no tool call" },
      // transcript claims two results ran off that turn - the parser now finds zero calls
      {
        role: "user",
        content:
          '<tool_result name="read_file">\na\n</tool_result>\n\n<tool_result name="bash">\nb\n</tool_result>',
      },
    ]);

    const report = replaySession(s, registry());
    expect(report.summary.envelopeCountChanged).toBe(1);
    expect(report.divergences[0]).toContain("now extracts 0 tool-call(s), session recorded 2");
  });

  it("reports a parser regression: a call that ran in the transcript no longer resolves", () => {
    const s = session([
      { role: "user", content: "go" },
      { role: "assistant", content: '<tool_call name="read_file">\nnot json at all\n</tool_call>' },
      { role: "user", content: '<tool_result name="read_file">\nfile contents\n</tool_result>' },
    ]);

    const report = replaySession(s, registry());
    expect(report.summary.nowFailsWasOk).toBe(1);
    expect(report.divergences[0]).toContain("no longer resolves");
  });

  it("detects the structured transport from the message content", () => {
    const s = session([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: JSON.stringify({
          message: "reading it",
          tool_calls: [{ name: "read_file", arguments: { path: "a.txt" } }],
        }),
      },
    ]);

    const report = replaySession(s, registry());
    expect(report.turns[0]?.transport).toBe("structured");
    expect(report.turns[0]?.resolvedCalls[0]?.name).toBe("read_file");
  });

  it("honours an explicit transport override", () => {
    const s = session([
      { role: "user", content: "go" },
      { role: "assistant", content: xml("read_file", { path: "a.txt" }) },
    ]);
    const report = replaySession(s, registry(), { structured: true });
    // forced structured: the free-text envelope is not valid JSON, so it parses as an error
    expect(report.turns[0]?.transport).toBe("structured");
    expect(report.turns[0]?.parseErrors).toHaveLength(1);
  });

  it("records a repair when the current pipeline has to recover the call", () => {
    // edit_file body with a raw newline in old_string - resolvable only via extractBySchema
    const s = session([
      { role: "user", content: "fix it" },
      {
        role: "assistant",
        content:
          '<tool_call name="edit_file">\n{"path": "a.js", "old_string": "line one\nline two", "new_string": "changed"}\n</tool_call>',
      },
    ]);
    const report = replaySession(s, registry());
    const call = report.turns[0]?.resolvedCalls[0];
    expect(call?.name).toBe("edit_file");
    expect(call?.repaired).toBe(true);
  });
});
