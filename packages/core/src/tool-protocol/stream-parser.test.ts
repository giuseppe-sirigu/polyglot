import { describe, expect, it } from "vitest";
import { ToolCallStreamParser } from "./stream-parser.js";
import type { ParserEvent } from "./types.js";

function runInOneShot(text: string): ParserEvent[] {
  const parser = new ToolCallStreamParser();
  return [...parser.push(text), ...parser.flush()];
}

/** Merges adjacent text events, since streaming naturally fragments text differently
 * depending on chunk boundaries — that fragmentation is cosmetic, not a correctness signal. */
function mergeAdjacentText(events: ParserEvent[]): ParserEvent[] {
  const merged: ParserEvent[] = [];
  for (const event of events) {
    const prev = merged[merged.length - 1];
    if (event.type === "text" && prev?.type === "text") {
      prev.text += event.text;
    } else {
      merged.push(event.type === "text" ? { type: "text", text: event.text } : event);
    }
  }
  return merged;
}

/** Feeds the text through the parser split into every possible chunk boundary, asserting the
 * logical result (text content merged, envelopes detected) is identical no matter how the
 * network happened to chunk it — exact text-event segmentation is allowed to differ. */
function runChunkedEveryWay(text: string): ParserEvent[] {
  const first = mergeAdjacentText(runInOneShot(text));
  for (let splitAt = 1; splitAt < text.length; splitAt++) {
    const parser = new ToolCallStreamParser();
    const events = mergeAdjacentText([
      ...parser.push(text.slice(0, splitAt)),
      ...parser.push(text.slice(splitAt)),
      ...parser.flush(),
    ]);
    expect(events, `mismatch when split at index ${splitAt}`).toEqual(first);
  }
  return first;
}

function textOf(events: ParserEvent[]): string {
  return events
    .filter((e) => e.type === "text")
    .map((e) => (e as { text: string }).text)
    .join("");
}

describe("ToolCallStreamParser", () => {
  it("passes plain text through untouched", () => {
    const events = runChunkedEveryWay("Hello, just chatting, no tools here.");
    expect(events).toEqual([{ type: "text", text: "Hello, just chatting, no tools here." }]);
  });

  it("parses a single xml-style tool call", () => {
    const text = '<tool_call name="read_file">\n{"path": "src/app.ts"}\n</tool_call>';
    const events = runChunkedEveryWay(text);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe("envelope");
    if (e?.type === "envelope") {
      expect(e.envelope.variant).toBe("xml");
      expect(e.envelope.declaredName).toBe("read_file");
      expect(e.envelope.body.trim()).toBe('{"path": "src/app.ts"}');
    }
  });

  it("interleaves prose before and after a tool call, preserving surrounding whitespace", () => {
    const text =
      'Let me check that file.\n<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_call>\nDone, thanks.';
    const events = runChunkedEveryWay(text);
    expect(events.map((e) => e.type)).toEqual(["text", "envelope", "text"]);
    expect(textOf(events)).toBe("Let me check that file.\n\nDone, thanks.");
  });

  it("handles multiple sequential tool calls, each on its own line", () => {
    const text = '<tool_call name="a">{"x":1}</tool_call>\n<tool_call name="b">{"y":2}</tool_call>';
    const events = runChunkedEveryWay(text);
    const envelopes = events.filter((e) => e.type === "envelope");
    expect(envelopes).toHaveLength(2);
  });

  it("does not trigger on <tool_call> mentioned mid-line in prose", () => {
    const text = "You can use a <tool_call> tag to invoke tools, for example.";
    const events = runChunkedEveryWay(text);
    expect(events).toEqual([{ type: "text", text }]);
  });

  it("tolerates hyphen and no-separator spelling variants", () => {
    for (const variant of ["<tool_call", "<tool-call", "<toolcall"]) {
      const text = `${variant} name="x">{}</tool_call>`;
      const events = runInOneShot(text);
      const envelope = events.find((e) => e.type === "envelope");
      expect(envelope, `variant ${variant} should be detected`).toBeDefined();
    }
  });

  it("accepts a closing </tool> tag as well as </tool_call>", () => {
    const text = '<tool_call name="read_file">\n{"path": "src/app.ts"}\n</tool>\nDone.';
    const events = runChunkedEveryWay(text);
    expect(events.map((e) => e.type)).toEqual(["envelope", "text"]);
    const e = events[0];
    if (e?.type === "envelope") {
      expect(e.envelope.body.trim()).toBe('{"path": "src/app.ts"}');
    }
    expect(textOf(events)).toBe("\nDone.");
  });

  it("closes each call independently when a model mixes </tool> and </tool_call> closers", () => {
    const text = '<tool_call name="a">{"x":1}</tool>\n<tool_call name="b">{"y":2}</tool_call>';
    const events = runChunkedEveryWay(text);
    const envelopes = events.filter((e) => e.type === "envelope");
    expect(envelopes).toHaveLength(2);
  });

  it("swallows a stray, never-opened fence marker right after </tool_call>", () => {
    const text = '<tool_call name="read_file">\n{"path": "a.ts"}\n</tool_CALL>\n```\n\n### Next up';
    const events = runChunkedEveryWay(text);
    expect(events.map((e) => e.type)).toEqual(["envelope", "text"]);
    expect(textOf(events)).toBe("\n### Next up");
  });

  it("doesn't desync a later real fenced code block after swallowing a stray marker", () => {
    const text =
      '<tool_call name="a">{"x":1}</tool_call>\n```\n\nSome prose.\n\n```bash\necho hi\n```\nDone.';
    const events = runChunkedEveryWay(text);
    const envelopes = events.filter((e) => e.type === "envelope");
    expect(envelopes).toHaveLength(1);
    expect(textOf(events)).toBe("\nSome prose.\n\n```bash\necho hi\n```\nDone.");
  });

  it("leaves a real fenced block alone when it has a language tag right after a tool call", () => {
    const text = '<tool_call name="a">{"x":1}</tool_call>\n```bash\necho hi\n```\n';
    const events = runChunkedEveryWay(text);
    expect(textOf(events)).toBe("\n```bash\necho hi\n```\n");
  });

  it("parses the fenced ```tool_call fallback variant", () => {
    const text = '```tool_call\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n```';
    const events = runChunkedEveryWay(text);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe("envelope");
    if (e?.type === "envelope") {
      expect(e.envelope.variant).toBe("fenced");
      expect(e.envelope.declaredName).toBeNull();
    }
  });

  it("does not mistake an ordinary ```json code fence for a tool call", () => {
    const text = 'Here is some JSON:\n```json\n{"a": 1}\n```\nThat was an example.';
    const events = runChunkedEveryWay(text);
    expect(events).toEqual([{ type: "text", text }]);
  });

  it("force-closes an unterminated tool call at end of stream as an envelope", () => {
    const text = '<tool_call name="read_file">\n{"path": "a.ts"}';
    const events = runInOneShot(text);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("envelope");
  });

  it("streams a tool call split across many tiny chunks byte-by-byte", () => {
    const text = '<tool_call name="edit_file">\n{"path":"a.ts","old":"x","new":"y"}\n</tool_call>';
    const parser = new ToolCallStreamParser();
    const events: ParserEvent[] = [];
    for (const char of text) {
      events.push(...parser.push(char));
    }
    events.push(...parser.flush());
    const envelope = events.find((e) => e.type === "envelope");
    expect(envelope).toBeDefined();
    if (envelope?.type === "envelope") {
      expect(envelope.envelope.declaredName).toBe("edit_file");
    }
  });
});
