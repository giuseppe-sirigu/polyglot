import { describe, expect, it } from "vitest";
import { ToolRegistry, textResult } from "../tools/types.js";
import { resolveEnvelope } from "./resolve.js";
import type { RawToolCallEnvelope } from "./types.js";

function xmlEnvelope(declaredName: string | null, body: string): RawToolCallEnvelope {
  return {
    variant: "xml",
    declaredName,
    body,
    raw: `<tool_call name="${declaredName}">${body}</tool_call>`,
  };
}

function fencedEnvelope(body: string): RawToolCallEnvelope {
  return { variant: "fenced", declaredName: null, body, raw: `\`\`\`tool_call\n${body}\n\`\`\`` };
}

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
  registry.register({
    name: "edit_file",
    description: "Edit a file.",
    permission: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
    async execute() {
      return textResult("edited");
    },
  });
  return registry;
}

describe("resolveEnvelope", () => {
  it("resolves a well-formed xml envelope", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", '{"path": "a.ts"}'), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.name).toBe("read_file");
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("repairs trailing commas and single quotes via jsonrepair", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", "{'path': 'a.ts',}"), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("falls back to loose key:value extraction for YAML-ish bodies", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", "path: a.ts"), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("fuzzy-corrects a near-miss tool name", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_fle", '{"path": "a.ts"}'), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.name).toBe("read_file");
      expect(result.correctedFromName).toBe("read_fle");
    }
  });

  it("corrects case-mismatched tool names", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("Read_File", '{"path": "a.ts"}'), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.name).toBe("read_file");
    }
  });

  it("returns a structured error for an unknown tool name", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("delete_universe", "{}"), registry);
    expect("message" in result).toBe(true);
    if ("message" in result) {
      expect(result.message).toMatch(/Unknown tool/);
    }
  });

  it("returns a structured error when required arguments are missing", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", "{}"), registry);
    expect("message" in result).toBe(true);
    if ("message" in result) {
      expect(result.message).toMatch(/failed validation/);
    }
  });

  it("adds a shape hint when every required key is missing (args restructured, not typo'd)", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", '{"contents": "whatever"}'), registry);
    expect("message" in result).toBe(true);
    if ("message" in result) {
      expect(result.message).toMatch(
        /must be a JSON object with exactly these top-level keys: path/,
      );
    }
  });

  it("omits the shape hint when a required key is merely typo'd alongside others", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(
      xmlEnvelope("read_file", '{"path": "a.ts", "extra": 1}'),
      registry,
    );
    expect("message" in result).toBe(true);
    if ("message" in result) {
      expect(result.message).not.toMatch(/must be a JSON object with exactly these top-level keys/);
    }
  });

  it("returns a structured error when the name attribute is missing entirely", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope(null, '{"path": "a.ts"}'), registry);
    expect("message" in result).toBe(true);
    if ("message" in result) {
      expect(result.message).toMatch(/missing a "name" attribute/);
    }
  });

  it("adds escaping guidance when an xml-envelope body can't be parsed as JSON", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", "not json at all { [ } ]"), registry);
    expect("message" in result).toBe(true);
    if ("message" in result) {
      expect(result.message).toMatch(/could not be parsed as JSON/);
      expect(result.message).toMatch(/escape every " as \\"/);
      expect(result.message).toMatch(/<syntax>, <block>/);
    }
  });

  it("strips a markdown code fence wrapping the whole xml-envelope body", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(
      xmlEnvelope("read_file", '```json\n{"path": "a.ts"}\n```'),
      registry,
    );
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("strips a code fence even when the model dropped the closing ```", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(xmlEnvelope("read_file", '```json\n{"path": "a.ts"}'), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("strips <syntax> / <block> tag wrappers around the body", () => {
    const registry = buildRegistry();
    for (const body of [
      '<syntax>{"path": "a.ts"}</syntax>',
      '<block>\n{"path": "a.ts"}\n</block>',
      '<syntax lang="json">```json\n{"path": "a.ts"}\n```</syntax>',
    ]) {
      const result = resolveEnvelope(xmlEnvelope("read_file", body), registry);
      expect("message" in result).toBe(false);
      if (!("message" in result)) {
        expect(result.input).toEqual({ path: "a.ts" });
      }
    }
  });

  it("resolves the fenced OpenAI-style {name, arguments} fallback shape", () => {
    const registry = buildRegistry();
    const body = JSON.stringify({ name: "read_file", arguments: { path: "a.ts" } });
    const result = resolveEnvelope(fencedEnvelope(body), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.name).toBe("read_file");
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("resolves the fenced {tool, parameters} alias shape too", () => {
    const registry = buildRegistry();
    const body = JSON.stringify({ tool: "read_file", parameters: { path: "a.ts" } });
    const result = resolveEnvelope(fencedEnvelope(body), registry);
    expect("message" in result).toBe(false);
    if (!("message" in result)) {
      expect(result.name).toBe("read_file");
      expect(result.input).toEqual({ path: "a.ts" });
    }
  });

  it("returns a structured error for a fenced body with no name field", () => {
    const registry = buildRegistry();
    const result = resolveEnvelope(fencedEnvelope('{"path": "a.ts"}'), registry);
    expect("message" in result).toBe(true);
  });

  describe("recovers edit_file args with raw newlines / unescaped quotes", () => {
    const FILE_OLD = 'switch (cmd) {\n  case "list":\n    console.log("hi");\n    break;\n}';
    const FILE_NEW = `${FILE_OLD}\n  case "count":\n    console.log(items.length);\n    break;`;

    it("single object, raw newlines and unescaped double-quotes in both values", () => {
      const body = `{"path":"todo.mjs","old_string":"${FILE_OLD}","new_string":"${FILE_NEW}"}`;
      const result = resolveEnvelope(xmlEnvelope("edit_file", body), buildRegistry());
      expect("message" in result).toBe(false);
      if (!("message" in result)) {
        expect(result.input).toEqual({
          path: "todo.mjs",
          old_string: FILE_OLD,
          new_string: FILE_NEW,
        });
      }
    });

    it("arguments split across two back-to-back objects", () => {
      const body =
        `{"path":"todo.mjs","old_string":"${FILE_OLD}"}\n` + `{"new_string":"${FILE_NEW}"}`;
      const result = resolveEnvelope(xmlEnvelope("edit_file", body), buildRegistry());
      expect("message" in result).toBe(false);
      if (!("message" in result)) {
        expect(result.input).toEqual({
          path: "todo.mjs",
          old_string: FILE_OLD,
          new_string: FILE_NEW,
        });
      }
    });

    it("tolerates a trailing-brace typo", () => {
      const body = `{"path":"todo.mjs","old_string":"${FILE_OLD}","new_string":"${FILE_NEW}"}}`;
      const result = resolveEnvelope(xmlEnvelope("edit_file", body), buildRegistry());
      expect("message" in result).toBe(false);
      if (!("message" in result)) {
        expect((result.input as { new_string: string }).new_string).toBe(FILE_NEW);
      }
    });

    it("does not touch a clean, well-escaped edit_file call", () => {
      const body = JSON.stringify({ path: "a.ts", old_string: "x", new_string: "y" });
      const result = resolveEnvelope(xmlEnvelope("edit_file", body), buildRegistry());
      expect("message" in result).toBe(false);
      if (!("message" in result)) {
        expect(result.input).toEqual({ path: "a.ts", old_string: "x", new_string: "y" });
      }
    });

    it("still errors when a required parameter is genuinely absent", () => {
      const body = '{"path":"todo.mjs","new_string":"whatever"}';
      const result = resolveEnvelope(xmlEnvelope("edit_file", body), buildRegistry());
      expect("message" in result).toBe(true);
    });
  });
});
