import { describe, expect, it } from "vitest";
import { groupTranscript } from "./toolPairing.js";
import type { DisplayItem } from "./types.js";

const call = (id: string, tcid: string, name: string): DisplayItem => ({
  kind: "tool_call",
  id,
  toolCallId: tcid,
  name,
  input: {},
});
const result = (id: string, tcid: string, name: string): DisplayItem => ({
  kind: "tool_result",
  id,
  toolCallId: tcid,
  name,
  resultText: `${name} result`,
  isError: false,
});

describe("groupTranscript", () => {
  it("nests each result under its own call even when they arrived call,call,result,result", () => {
    const items = [
      call("1", "a", "edit_file"),
      call("2", "b", "read_file"),
      result("3", "a", "edit_file"),
      result("4", "b", "read_file"),
    ];
    const groups = groupTranscript(items);
    expect(groups).toEqual([
      { kind: "toolPair", call: items[0], result: items[2] },
      { kind: "toolPair", call: items[1], result: items[3] },
    ]);
  });

  it("keeps a call with no result yet as a pair with an undefined result", () => {
    const items = [call("1", "a", "bash")];
    expect(groupTranscript(items)).toEqual([
      { kind: "toolPair", call: items[0], result: undefined },
    ]);
  });

  it("passes non-tool items through in place", () => {
    const user: DisplayItem = { kind: "user", id: "u", text: "hi" };
    const parseErr: DisplayItem = {
      kind: "tool_parse_error",
      id: "p",
      toolCallId: "x",
      message: "bad",
    };
    const items = [user, call("1", "a", "read_file"), result("2", "a", "read_file"), parseErr];
    expect(groupTranscript(items)).toEqual([
      { kind: "item", item: user },
      { kind: "toolPair", call: items[1], result: items[2] },
      { kind: "item", item: parseErr },
    ]);
  });

  it("falls back to flat order when items have no toolCallId (old resumed sessions)", () => {
    const c: DisplayItem = { kind: "tool_call", id: "1", name: "read_file", input: {} };
    const r: DisplayItem = {
      kind: "tool_result",
      id: "2",
      name: "read_file",
      resultText: "x",
      isError: false,
    };
    expect(groupTranscript([c, r])).toEqual([
      { kind: "item", item: c },
      { kind: "item", item: r },
    ]);
  });
});
