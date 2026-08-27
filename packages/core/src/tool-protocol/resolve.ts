import type { JsonSchema, ToolRegistry } from "../tools/types.js";
import { repairJson } from "./json-repair.js";
import type { ParsedToolCall, RawToolCallEnvelope, ToolCallParseError } from "./types.js";
import { validateAgainstSchema } from "./validator.js";

const NAME_ALIASES = ["name", "tool", "function", "tool_name"];
const ARGS_ALIASES = ["arguments", "input", "parameters", "args"];

export function resolveEnvelope(
  envelope: RawToolCallEnvelope,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  const repaired = repairJson(envelope.body);

  if (envelope.variant === "xml") {
    return resolveXmlEnvelope(envelope, repaired, registry);
  }
  return resolveFencedEnvelope(envelope, repaired, registry);
}

function resolveXmlEnvelope(
  envelope: RawToolCallEnvelope,
  repaired: ReturnType<typeof repairJson>,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  let declaredName = envelope.declaredName;
  let input: unknown = {};

  if (repaired.ok && isPlainObject(repaired.value)) {
    // some models redundantly restate the name inside the JSON body — prefer the
    // attribute if present, otherwise fall back to a name found inside the body.
    if (!declaredName) {
      declaredName = firstStringField(repaired.value, NAME_ALIASES);
    }
    input = stripAliasKeys(repaired.value, [...NAME_ALIASES]);
  } else if (repaired.ok) {
    input = repaired.value;
  }

  if (!declaredName) {
    return {
      raw: envelope.raw,
      attemptedName: null,
      message: 'Tool call is missing a "name" attribute, e.g. <tool_call name="read_file">.',
    };
  }

  if (!repaired.ok) {
    return {
      raw: envelope.raw,
      attemptedName: declaredName,
      message: `Arguments for "${declaredName}" could not be parsed as JSON: ${repaired.error}`,
    };
  }

  return finalize(envelope, declaredName, input, registry);
}

function resolveFencedEnvelope(
  envelope: RawToolCallEnvelope,
  repaired: ReturnType<typeof repairJson>,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  if (!repaired.ok || !isPlainObject(repaired.value)) {
    return {
      raw: envelope.raw,
      attemptedName: null,
      message: `Fenced tool call body could not be parsed as a JSON object: ${
        repaired.ok ? "not an object" : repaired.error
      }`,
    };
  }

  const name = firstStringField(repaired.value, NAME_ALIASES);
  if (!name) {
    return {
      raw: envelope.raw,
      attemptedName: null,
      message: 'Fenced tool call JSON is missing a "name" field.',
    };
  }

  const args =
    firstObjectField(repaired.value, ARGS_ALIASES) ??
    stripAliasKeys(repaired.value, [...NAME_ALIASES, ...ARGS_ALIASES]);

  return finalize(envelope, name, args, registry);
}

export function finalize(
  source: { raw: string },
  requestedName: string,
  input: unknown,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  const { tool, correctedFrom } = resolveToolName(requestedName, registry);
  if (!tool) {
    return {
      raw: source.raw,
      attemptedName: requestedName,
      message: `Unknown tool "${requestedName}". Available tools: ${registry.names().join(", ")}.`,
    };
  }

  const validation = validateAgainstSchema(tool.inputSchema, input);
  if (!validation.ok) {
    return {
      raw: source.raw,
      attemptedName: tool.name,
      message: `Arguments for "${tool.name}" failed validation: ${validation.errors.join("; ")}${missingEveryRequiredKeyHint(tool.inputSchema, input)}`,
    };
  }

  return {
    id: crypto.randomUUID(),
    name: tool.name,
    input,
    raw: source.raw,
    ...(correctedFrom ? { correctedFromName: correctedFrom } : {}),
  };
}

export function resolveToolName(
  requested: string,
  registry: ToolRegistry,
): { tool: ReturnType<ToolRegistry["get"]>; correctedFrom?: string } {
  const exact = registry.get(requested);
  if (exact) return { tool: exact };

  const lower = requested.toLowerCase();
  const caseInsensitive = registry.list().find((t) => t.name.toLowerCase() === lower);
  if (caseInsensitive) return { tool: caseInsensitive, correctedFrom: requested };

  let best: { name: string; distance: number } | null = null;
  for (const name of registry.names()) {
    const distance = levenshtein(lower, name.toLowerCase());
    if (distance <= 2 && (!best || distance < best.distance)) {
      best = { name, distance };
    }
  }
  if (best) {
    return { tool: registry.get(best.name), correctedFrom: requested };
  }

  return { tool: undefined };
}

/** When a call is missing every one of the tool's required keys, the arguments were probably
 * restructured entirely rather than just typo'd — the "additional property" errors alone (one
 * per stray key) don't point at that, so add an explicit nudge toward the expected shape. Most
 * commonly seen when a model spreads a file's own fields as sibling arguments instead of
 * encoding them as a JSON string under a single "content"-style parameter. */
function missingEveryRequiredKeyHint(schema: JsonSchema, input: unknown): string {
  const required = (schema.required as string[]) ?? [];
  if (required.length === 0 || !isPlainObject(input)) return "";
  if (required.some((key) => key in input)) return "";
  return ` This tool's arguments must be a JSON object with exactly these top-level keys: ${required.join(", ")}. If a value is structured data, encode it as a JSON string, not as separate sibling keys.`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function firstObjectField(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = obj[key];
    if (isPlainObject(value)) return value;
  }
  return null;
}

function stripAliasKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result = { ...obj };
  for (const key of keys) delete result[key];
  return result;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const get = (i: number, j: number): number => d[i]?.[j] ?? 0;
  const set = (i: number, j: number, value: number): void => {
    d[i]?.splice(j, 1, value);
  };

  for (let i = 0; i < rows; i++) set(i, 0, i);
  for (let j = 0; j < cols; j++) set(0, j, j);
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      set(i, j, Math.min(get(i - 1, j) + 1, get(i, j - 1) + 1, get(i - 1, j - 1) + cost));
    }
  }
  return get(rows - 1, cols - 1);
}
