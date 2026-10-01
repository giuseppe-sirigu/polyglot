import { describe, expect, it } from "vitest";
import { ToolCallStreamParser } from "./stream-parser.js";
import type { ParserEvent } from "./types.js";

function runInOneShot(text: string): ParserEvent[] {
  const parser = new ToolCallStreamParser();
  return [...parser.push(text), ...parser.flush()];
}

/** Merges adjacent text events, since streaming naturally fragments text differently
 * depending on chunk boundaries - that fragmentation is cosmetic, not a correctness signal. */
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
 * network happened to chunk it - exact text-event segmentation is allowed to differ. */
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

  it("accepts a closing </tool_result> tag (a model blending its own native closer with our convention)", () => {
    const text = '<tool_call name="grep">\n{"pattern": "unused"}\n</tool_result>\nLet me verify.';
    const events = runChunkedEveryWay(text);
    expect(events.map((e) => e.type)).toEqual(["envelope", "text"]);
    const e = events[0];
    if (e?.type === "envelope") {
      expect(e.envelope.body.trim()).toBe('{"pattern": "unused"}');
    }
    expect(textOf(events)).toBe("\nLet me verify.");
  });

  it("closes each call independently when a model mixes </tool_result> and </tool_call> closers", () => {
    const text =
      '<tool_call name="a">{"x":1}</tool_result>\n<tool_call name="b">{"y":2}</tool_call>';
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

describe("ToolCallStreamParser - natively-trained call formats (toolNames given)", () => {
  const toolNames = ["read_file", "edit_file", "bash"];

  function parseWith(text: string): ParserEvent[] {
    const parser = new ToolCallStreamParser({ toolNames });
    return mergeAdjacentText([...parser.push(text), ...parser.flush()]);
  }

  /** Same chunk-boundary invariance as runChunkedEveryWay, with tool names configured. */
  function parseChunkedEveryWay(text: string): ParserEvent[] {
    const first = parseWith(text);
    for (let splitAt = 1; splitAt < text.length; splitAt++) {
      const parser = new ToolCallStreamParser({ toolNames });
      const events = mergeAdjacentText([
        ...parser.push(text.slice(0, splitAt)),
        ...parser.push(text.slice(splitAt)),
        ...parser.flush(),
      ]);
      expect(events, `mismatch when split at index ${splitAt}`).toEqual(first);
    }
    return first;
  }

  function envelopes(events: ParserEvent[]) {
    return events.flatMap((e) => (e.type === "envelope" ? [e.envelope] : []));
  }

  it("recognises Devstral's name{json} glued onto its prose (captured live via Ollama)", () => {
    const text =
      'I\'ll first examine the `util.mjs` file to find the `unused()` function, then remove it.read_file{"path": "util.mjs"}';
    const events = parseChunkedEveryWay(text);
    expect(envelopes(events)).toEqual([
      {
        variant: "xml",
        declaredName: "read_file",
        body: '{"path": "util.mjs"}',
        raw: 'read_file{"path": "util.mjs"}',
      },
    ]);
    expect(events[0]).toEqual({
      type: "text",
      text: "I'll first examine the `util.mjs` file to find the `unused()` function, then remove it.",
    });
  });

  it("recognises Mistral's [TOOL_CALLS]name[ARGS]{json} markers", () => {
    const events = parseChunkedEveryWay('[TOOL_CALLS]read_file[ARGS]{"path": "a.mjs"}');
    expect(envelopes(events)).toHaveLength(1);
    expect(envelopes(events)[0]?.declaredName).toBe("read_file");
    expect(envelopes(events)[0]?.body).toBe('{"path": "a.mjs"}');
  });

  it("keeps braces inside string values inside the bare object", () => {
    const body = '{"command": "node -e \\"console.log({a: 1})\\""}';
    const events = parseChunkedEveryWay(`bash${body} done`);
    expect(envelopes(events)[0]?.body).toBe(body);
    expect(events.at(-1)).toEqual({ type: "text", text: " done" });
  });

  it("recognises the tool name used as the tag (captured live on qwen2.5-coder:7b)", () => {
    const text =
      '<edit_file>\n{"path": "math.mjs", "old_string": "add", "new_string": "sum"}\n</edit_file>\nDone.';
    const events = parseChunkedEveryWay(text);
    expect(envelopes(events)).toEqual([
      {
        variant: "xml",
        declaredName: "edit_file",
        body: '\n{"path": "math.mjs", "old_string": "add", "new_string": "sum"}\n',
        raw: '<edit_file>\n{"path": "math.mjs", "old_string": "add", "new_string": "sum"}\n</edit_file>',
      },
    ]);
  });

  it("treats a ```json fence naming a known tool as a call", () => {
    const text = 'Running it:\n```json\n{"name": "bash", "arguments": {"command": "ls"}}\n```\n';
    expect(envelopes(parseChunkedEveryWay(text))).toEqual([
      {
        variant: "fenced",
        declaredName: null,
        body: '{"name": "bash", "arguments": {"command": "ls"}}',
        raw: '```json\n{"name": "bash", "arguments": {"command": "ls"}}\n```\n',
      },
    ]);
  });

  it("leaves a ```json fence that doesn't name a known tool as text", () => {
    const text = 'Here is the config:\n```json\n{"name": "api", "port": 8443}\n```\n';
    const events = parseChunkedEveryWay(text);
    expect(envelopes(events)).toHaveLength(0);
    expect(events).toEqual([{ type: "text", text }]);
  });

  it("does not treat a mention of a tool name in prose as a call", () => {
    const text = "I used read_file to look at it and bash to run it.";
    expect(parseChunkedEveryWay(text)).toEqual([{ type: "text", text }]);
  });

  it("changes nothing when no tool names are given", () => {
    const text = 'read_file{"path": "a"}\n<edit_file>\n{}\n</edit_file>';
    expect(runChunkedEveryWay(text)).toEqual([{ type: "text", text }]);
  });
});

describe("ToolCallStreamParser - closing tag with attributes", () => {
  it('closes on </tool_call name="..."> (captured live on qwen2.5-coder)', () => {
    const text =
      '<tool_call name="read_file">\n{"path": "sum.mjs"}\n</tool_call name="read_file">\nok';
    const events = runChunkedEveryWay(text);
    const env = events.find((e) => e.type === "envelope");
    expect(env?.type === "envelope" && env.envelope.body).toBe('\n{"path": "sum.mjs"}\n');
    expect(events.at(-1)).toEqual({ type: "text", text: "\nok" });
  });
});

describe("ToolCallStreamParser - Devstral's improvised tags (captured live, diagnosis round 2)", () => {
  const toolNames = ["read_file", "edit_file", "bash", "glob", "grep"];

  function parseChunkedEveryWay(text: string): ParserEvent[] {
    const once = (chunks: string[]) => {
      const parser = new ToolCallStreamParser({ toolNames });
      return mergeAdjacentText([...chunks.flatMap((c) => parser.push(c)), ...parser.flush()]);
    };
    const first = once([text]);
    for (let splitAt = 1; splitAt < text.length; splitAt++) {
      expect(once([text.slice(0, splitAt), text.slice(splitAt)]), `split at ${splitAt}`).toEqual(
        first,
      );
    }
    return first;
  }
  const envelopes = (events: ParserEvent[]) =>
    events.flatMap((e) => (e.type === "envelope" ? [e.envelope] : []));

  it("reads a self-closing tag's attributes as the arguments - and no longer swallows the next call", () => {
    const text =
      '<glob pattern="**/service.json"/>\n<tool_call name="grep">\n{"pattern": "port"}\n</tool_call>';
    const envs = envelopes(parseChunkedEveryWay(text));
    expect(envs.map((e) => [e.declaredName, e.body])).toEqual([
      ["glob", '{"pattern":"**/service.json"}'],
      ["grep", '\n{"pattern": "port"}\n'],
    ]);
  });

  it("unescapes quotes in attribute values", () => {
    const envs = envelopes(parseChunkedEveryWay('<bash command="find . -name \\"*.json\\""/>'));
    expect(JSON.parse(envs[0]?.body ?? "")).toEqual({ command: 'find . -name "*.json"' });
  });

  it('recognises <glob_call name="glob">...</glob_call>', () => {
    const envs = envelopes(
      parseChunkedEveryWay('<glob_call name="glob">\n{"pattern": "**/*util*.mjs"}\n</glob_call>'),
    );
    expect(envs.map((e) => [e.declaredName, e.body.trim()])).toEqual([
      ["glob", '{"pattern": "**/*util*.mjs"}'],
    ]);
  });

  it("recognises a name with a dropped < (glob>) followed by JSON on the next line", () => {
    const text =
      'Let me start by examining the current state of these files.glob>\n{"pattern": "**/*.mjs"}';
    const envs = envelopes(parseChunkedEveryWay(text));
    expect(envs.map((e) => [e.declaredName, e.body])).toEqual([
      ["glob", '{"pattern": "**/*.mjs"}'],
    ]);
  });

  it("recognises a tool-name tag mid-sentence when JSON follows, cut-off close and all", () => {
    const text =
      'Now I\'ll rename it in math.mjs<edit_file name="edit_file">\n{"path": "math.mjs", "old_string": "add", "new_string": "sum"}\n</edit_file';
    const envs = envelopes(parseChunkedEveryWay(text));
    expect(envs).toHaveLength(1);
    expect(envs[0]?.declaredName).toBe("edit_file");
    expect(JSON.parse(envs[0]?.body ?? "")).toEqual({
      path: "math.mjs",
      old_string: "add",
      new_string: "sum",
    });
  });

  it("leaves a tool-name tag mentioned mid-sentence as text when nothing call-like follows", () => {
    const text = "I would use <glob> here and then stop.";
    expect(parseChunkedEveryWay(text)).toEqual([{ type: "text", text }]);
  });
});

describe("ToolCallStreamParser - attribute arguments with an explicit close (captured live on Devstral)", () => {
  it("uses the attributes when <glob pattern=...></glob> has an empty body", () => {
    const toolNames = ["glob", "bash"];
    const text = '<glob pattern="**/service.json"></glob>';
    const first = (() => {
      const p = new ToolCallStreamParser({ toolNames });
      return [...p.push(text), ...p.flush()];
    })();
    for (let splitAt = 1; splitAt < text.length; splitAt++) {
      const p = new ToolCallStreamParser({ toolNames });
      const events = [
        ...p.push(text.slice(0, splitAt)),
        ...p.push(text.slice(splitAt)),
        ...p.flush(),
      ];
      expect(
        events.filter((e) => e.type === "envelope"),
        `split at ${splitAt}`,
      ).toEqual(first.filter((e) => e.type === "envelope"));
    }
    const env = first.find((e) => e.type === "envelope");
    expect(env?.type === "envelope" && [env.envelope.declaredName, env.envelope.body]).toEqual([
      "glob",
      '{"pattern":"**/service.json"}',
    ]);
  });

  it("keeps a non-empty body over the attributes", () => {
    const p = new ToolCallStreamParser({ toolNames: ["glob"] });
    const events = [...p.push('<glob name="glob">\n{"pattern": "a"}\n</glob>'), ...p.flush()];
    const env = events.find((e) => e.type === "envelope");
    expect(env?.type === "envelope" && env.envelope.body.trim()).toBe('{"pattern": "a"}');
  });
});

describe("ToolCallStreamParser - invented tag suffixes and glued names (captured live on Devstral, 5-trial run)", () => {
  const toolNames = ["read_file", "edit_file", "glob"];
  const parse = (text: string) => {
    const once = (chunks: string[]) => {
      const p = new ToolCallStreamParser({ toolNames });
      return mergeAdjacentText([...chunks.flatMap((c) => p.push(c)), ...p.flush()]);
    };
    const first = once([text]);
    for (let i = 1; i < text.length; i++) {
      expect(once([text.slice(0, i), text.slice(i)]), `split at ${i}`).toEqual(first);
    }
    return first.flatMap((e) => (e.type === "envelope" ? [e.envelope] : []));
  };

  it("recognises <glob_pattern>{json}</glob_pattern>", () => {
    const envs = parse(
      'I need to find util.mjs first.\n\n<glob_pattern>\n{"pattern": "**/util.mjs"}\n</glob_pattern>',
    );
    expect(envs.map((e) => [e.declaredName, e.body.trim()])).toEqual([
      ["glob", '{"pattern": "**/util.mjs"}'],
    ]);
  });

  it("leaves a suffixed tag with no JSON after it as text", () => {
    expect(parse("<glob_examples>\nsee below\n</glob_examples>")).toEqual([]);
  });

  it("recognises edit_file> glued onto the previous word", () => {
    const envs = parse(
      '2. Update the import and usage in main.mjsedit_file>\n{"path": "math.mjs", "old_string": "add", "new_string": "sum"}',
    );
    expect(envs.map((e) => e.declaredName)).toEqual(["edit_file"]);
  });

  it("does not match a tool name inside a word without the > marker", () => {
    expect(parse('the config.jsonglob{"x": 1} line')).toEqual([]);
  });
});

describe("ToolCallStreamParser - more name/JSON separators (captured live on Devstral, 5-trial re-run)", () => {
  const toolNames = ["read_file", "glob"];
  const parse = (text: string) => {
    const once = (chunks: string[]) => {
      const p = new ToolCallStreamParser({ toolNames });
      return mergeAdjacentText([...chunks.flatMap((c) => p.push(c)), ...p.flush()]);
    };
    const first = once([text]);
    for (let i = 1; i < text.length; i++) {
      expect(once([text.slice(0, i), text.slice(i)]), `split at ${i}`).toEqual(first);
    }
    return first.flatMap((e) => (e.type === "envelope" ? [e.envelope] : []));
  };

  it("recognises read_file>( {json} )", () => {
    const envs = parse('Now let me read the file:read_file>(\n{"path": "sum.mjs"}\n)');
    expect(envs.map((e) => [e.declaredName, e.body])).toEqual([
      ["read_file", '{"path": "sum.mjs"}'],
    ]);
  });

  it("recognises glob={json}", () => {
    const envs = parse('Now let me check if greet.mjs exists:glob={"pattern": "**/greet.mjs"}');
    expect(envs.map((e) => [e.declaredName, e.body])).toEqual([
      ["glob", '{"pattern": "**/greet.mjs"}'],
    ]);
  });
});

describe("ToolCallStreamParser - a call that runs into an invented next turn (captured live on qwen2.5-coder:32b)", () => {
  it("ends the call at a bare </ line instead of swallowing the invented tool result", () => {
    const text =
      '<tool_call name="write_file">\n{"path":"util.mjs","content":"export function used(x) {\\n  return x * 2;\\n}\\n"}\n</\n\nuser>\n<tool_result name="write_file">\nWrote util.mjs (68 bytes).\n\n</tool_result>';
    const events = runChunkedEveryWay(text);
    const envs = events.flatMap((e) => (e.type === "envelope" ? [e.envelope] : []));
    expect(envs).toHaveLength(1);
    expect(JSON.parse(envs[0]?.body ?? "")).toEqual({
      path: "util.mjs",
      content: "export function used(x) {\n  return x * 2;\n}\n",
    });
  });

  it("ends the call where the model starts writing a tool result itself", () => {
    const text =
      '<tool_call name="bash">\n{"command": "node main.mjs"}\n<tool_result name="bash">\nok\n</tool_result>';
    const envs = runChunkedEveryWay(text).flatMap((e) =>
      e.type === "envelope" ? [e.envelope] : [],
    );
    expect(envs.map((e) => e.body.trim())).toEqual(['{"command": "node main.mjs"}']);
  });

  it("keeps a </tool_result> close that ends a normal call", () => {
    const text = '<tool_call name="bash">\n{"command": "ls"}\n</tool_result>\nDone.';
    const envs = runChunkedEveryWay(text).flatMap((e) =>
      e.type === "envelope" ? [e.envelope] : [],
    );
    expect(envs.map((e) => e.body.trim())).toEqual(['{"command": "ls"}']);
  });
});

describe("ToolCallStreamParser - calls glued onto prose (captured live on Devstral, fixed-build re-run)", () => {
  const toolNames = ["read_file", "write_file", "edit_file", "bash", "grep", "glob"];

  function envelopes(text: string, names?: string[]) {
    const first = mergeAdjacentText(
      (() => {
        const p = new ToolCallStreamParser(names ? { toolNames: names } : {});
        return [...p.push(text), ...p.flush()];
      })(),
    );
    for (let splitAt = 1; splitAt < text.length; splitAt++) {
      const p = new ToolCallStreamParser(names ? { toolNames: names } : {});
      const events = mergeAdjacentText([
        ...p.push(text.slice(0, splitAt)),
        ...p.push(text.slice(splitAt)),
        ...p.flush(),
      ]);
      expect(events, `mismatch when split at index ${splitAt}`).toEqual(first);
    }
    return first.flatMap((e) => (e.type === "envelope" ? [e.envelope] : []));
  }

  it("runs a <tool_call> glued onto the end of a sentence when JSON follows", () => {
    const text =
      'Now I\'ll remove it from util.mjs:<tool_call name="edit_file">\n{"path": "util.mjs", "old_string": "a", "new_string": "b"}\n</tool_call>';
    for (const names of [undefined, toolNames]) {
      const envs = envelopes(text, names);
      expect(envs.map((e) => e.declaredName)).toEqual(["edit_file"]);
      expect(JSON.parse(envs[0]?.body ?? "")).toEqual({
        path: "util.mjs",
        old_string: "a",
        new_string: "b",
      });
    }
  });

  it("leaves a <tool_call> tag mentioned mid-sentence as text", () => {
    expect(envelopes("Wrap each call in a <tool_call> tag, then stop.")).toEqual([]);
  });

  it('reads glob_call name="glob"> with its < dropped as a call', () => {
    const envs = envelopes(
      'Let me find the files:glob_call name="glob">\n{"pattern": "**/*.mjs"}\n</tool_call>',
      toolNames,
    );
    expect(envs.map((e) => e.declaredName)).toEqual(["glob"]);
    expect(JSON.parse(envs[0]?.body ?? "")).toEqual({ pattern: "**/*.mjs" });
  });

  it("reads name.call({...}) as a call", () => {
    const envs = envelopes(
      'I\'ll look at the project first.glob.call({\n  "pattern": "**/*"\n})',
      toolNames,
    );
    expect(envs.map((e) => e.declaredName)).toEqual(["glob"]);
    expect(JSON.parse(envs[0]?.body ?? "")).toEqual({ pattern: "**/*" });
  });
});
