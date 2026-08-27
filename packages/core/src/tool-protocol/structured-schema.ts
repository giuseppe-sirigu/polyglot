import type { JsonSchema, ToolDefinition } from "../tools/types.js";
import { repairJson } from "./json-repair.js";

export const ENVELOPE_SCHEMA_NAME = "polyglot_tool_envelope";

export interface StructuredToolCall {
  name: string;
  arguments: unknown;
}

export interface StructuredEnvelope {
  message: string;
  tool_calls: StructuredToolCall[];
}

/**
 * Builds the JSON Schema for one full structured-mode turn: a natural-language "message" plus
 * zero or more tool calls, each tool's "arguments" schema taken directly from its own
 * ToolDefinition.inputSchema (no schema duplication). Passed as `responseSchema` so the
 * provider can grammar-constrain the entire completion to this shape.
 */
export function buildEnvelopeSchema(tools: ToolDefinition[]): JsonSchema {
  const variants = tools.map((tool) => ({
    type: "object",
    properties: {
      name: { const: tool.name },
      arguments: tool.inputSchema,
    },
    required: ["name", "arguments"],
    additionalProperties: false,
  }));

  return {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          'Natural-language reply to show the user this turn. Use "" if this turn is only tool calls.',
      },
      tool_calls: {
        type: "array",
        // An empty `oneOf` is valid-but-undefined-behavior for a grammar generator (which
        // compiles the schema into a token grammar ahead of time) even though a plain
        // JSON-Schema validator handles it fine — force an empty array unambiguously instead.
        items: variants.length > 0 ? { oneOf: variants } : { not: {} },
        ...(variants.length === 0 ? { maxItems: 0 } : {}),
      },
    },
    required: ["message", "tool_calls"],
    additionalProperties: false,
  };
}

/**
 * Parses one structured-mode completion into a StructuredEnvelope. Tries repairJson() as a
 * single bounded repair attempt (the same tolerance the free-text path already applies to tool
 * call bodies) — beyond that, a failure here means the backend isn't actually honoring the
 * response schema, which callers should surface as a distinct, explicit error rather than
 * silently retrying.
 */
export function parseStructuredEnvelope(
  text: string,
): { ok: true; value: StructuredEnvelope } | { ok: false; error: string } {
  const repaired = repairJson(text);
  if (!repaired.ok) return { ok: false, error: repaired.error };

  const value = repaired.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: 'expected a JSON object with "message" and "tool_calls"' };
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.message !== "string") {
    return { ok: false, error: '"message" must be a string' };
  }
  if (!Array.isArray(obj.tool_calls)) {
    return { ok: false, error: '"tool_calls" must be an array' };
  }

  const tool_calls: StructuredToolCall[] = [];
  for (const [i, raw] of obj.tool_calls.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `tool_calls[${i}] must be an object` };
    }
    const call = raw as Record<string, unknown>;
    if (typeof call.name !== "string") {
      return { ok: false, error: `tool_calls[${i}] is missing a string "name"` };
    }
    tool_calls.push({ name: call.name, arguments: call.arguments });
  }

  return { ok: true, value: { message: obj.message, tool_calls } };
}
