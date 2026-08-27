import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../tools/types.js";
import { textResult } from "../tools/types.js";
import { buildEnvelopeSchema, parseStructuredEnvelope } from "./structured-schema.js";

function tool(name: string, inputSchema: Record<string, unknown>): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    permission: "read",
    inputSchema,
    async execute() {
      return textResult("");
    },
  };
}

const readFile = tool("read_file", {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
  additionalProperties: false,
});

const bash = tool("bash", {
  type: "object",
  properties: { command: { type: "string" } },
  required: ["command"],
  additionalProperties: false,
});

describe("buildEnvelopeSchema", () => {
  it("builds one oneOf variant per tool, keyed by name", () => {
    const schema = buildEnvelopeSchema([readFile, bash]) as {
      properties: { tool_calls: { items: { oneOf: unknown[] } } };
    };
    expect(schema.properties.tool_calls.items.oneOf).toHaveLength(2);
  });

  it("requires message and tool_calls, and forbids extra top-level keys", () => {
    const schema = buildEnvelopeSchema([readFile]) as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(["message", "tool_calls"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("forces an empty tool_calls array when there are no tools", () => {
    const schema = buildEnvelopeSchema([]) as {
      properties: { tool_calls: { maxItems: number } };
    };
    expect(schema.properties.tool_calls.maxItems).toBe(0);
  });

  it("produces a schema ajv can compile, and each variant's arguments schema is the tool's own inputSchema", () => {
    const schema = buildEnvelopeSchema([readFile, bash]);
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(schema);

    expect(
      validate({ message: "", tool_calls: [{ name: "read_file", arguments: { path: "a.ts" } }] }),
    ).toBe(true);
    expect(
      validate({ message: "", tool_calls: [{ name: "bash", arguments: { command: "ls" } }] }),
    ).toBe(true);
    // Cross-tool argument shape must be rejected by the oneOf discrimination on "name".
    expect(
      validate({ message: "", tool_calls: [{ name: "read_file", arguments: { command: "ls" } }] }),
    ).toBe(false);
    expect(validate({ message: "hi", tool_calls: [] })).toBe(true);
    expect(validate({ message: "hi" })).toBe(false); // missing tool_calls
  });
});

describe("parseStructuredEnvelope", () => {
  it("parses a valid envelope", () => {
    const result = parseStructuredEnvelope(
      '{"message": "hi", "tool_calls": [{"name": "read_file", "arguments": {"path": "a.ts"}}]}',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.message).toBe("hi");
      expect(result.value.tool_calls).toEqual([{ name: "read_file", arguments: { path: "a.ts" } }]);
    }
  });

  it("repairs near-miss JSON (trailing comma) via jsonrepair", () => {
    const result = parseStructuredEnvelope('{"message": "hi", "tool_calls": [],}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ message: "hi", tool_calls: [] });
  });

  it("fails on garbage text", () => {
    const result = parseStructuredEnvelope("not json at all, just prose");
    expect(result.ok).toBe(false);
  });

  it("fails when tool_calls is missing", () => {
    const result = parseStructuredEnvelope('{"message": "hi"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tool_calls/);
  });

  it("fails when a tool_calls entry has no name", () => {
    const result = parseStructuredEnvelope('{"message": "hi", "tool_calls": [{"arguments": {}}]}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name/);
  });
});
