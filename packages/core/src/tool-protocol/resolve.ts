import type { JsonSchema, ToolRegistry } from "../tools/types.js";
import { type RepairStrategy, repairJson } from "./json-repair.js";
import type { ParsedToolCall, RawToolCallEnvelope, ToolCallParseError } from "./types.js";
import { validateAgainstSchema } from "./validator.js";

const NAME_ALIASES = ["name", "tool", "function", "tool_name"];
/** Qwen's natively-trained call body: `<function=read_file>` then `<parameter=path>a</parameter>`
 * (or `<parameter name="path">`), seen live on Qwen3.8-27B - even with the `>` dropped. */
const QWEN_FUNCTION = /^\s*<function\s*=\s*([\w.-]+)/i;
/** The head of one `<parameter...>` segment, matched only at the segment's start. */
const QWEN_PARAMETER_HEAD = /^\s*(?:=\s*|name\s*=\s*["'])([\w-]+)["']?\s*>\n?/i;

/** Splits on `<parameter` and reads each segment up to its `</parameter>` - linear in the
 * body, unlike one lazy regex across it, which backtracks on a body full of unclosed tags. */
function qwenParameters(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const segments = body.split(/<parameter/i).slice(1);
  for (const segment of segments) {
    const head = QWEN_PARAMETER_HEAD.exec(segment);
    if (!head) continue;
    const rest = segment.slice(head[0].length);
    const end = rest.toLowerCase().indexOf("</parameter>");
    if (end === -1) continue;
    args[head[1] as string] = unquoteParameter(rest.slice(0, end).replace(/\n$/, ""));
  }
  return args;
}
const NESTED_NAMED_OPEN = /^\s*<tool[_-]?call\b[^>\n]*?\bname\s*=\s*["']([^"']+)["'][^>\n]*>/i;
const ARGS_ALIASES = ["arguments", "input", "parameters", "args"];

/** Names that mean "a tool call" rather than naming a tool - gpt-oss via Ollama emits native
 * calls named "tool_call" (echoing our own tag), with the real call inside the arguments. */
const WRAPPER_NAMES = new Set(["tool_call", "toolcall", "tool", "function", "call", "tool_use"]);

/** A tool a model was trained on, mapped onto ours. gpt-oss calls its built-in shell as
 * `container.exec` with `{"cmd": ["bash", "-lc", "<command>"]}`. */
const FOREIGN_SHELL_TOOLS = new Set(["container.exec", "shell"]);
const SHELL_BINARIES = new Set(["bash", "sh", "zsh"]);

function shellWords(words: string[]): string {
  return words
    .map((w) => (/^[\w./:=@%+-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`))
    .join(" ");
}

/** `["bash", "-lc", "ls -R"]` → `ls -R`; any other argv is joined with shell quoting. */
function commandFromArgv(cmd: unknown): string | null {
  if (typeof cmd === "string") return cmd;
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((w) => typeof w === "string")) {
    return null;
  }
  const argv = cmd as string[];
  const shell = (argv[0] ?? "").split("/").at(-1) ?? "";
  if (argv.length === 3 && SHELL_BINARIES.has(shell) && /^-l?c$/.test(argv[1] ?? "")) {
    return argv[2] as string;
  }
  return shellWords(argv);
}

/** Maps a call to a tool the model was trained on (not one of ours) onto our equivalent, or
 * returns null. Only used once the requested name has already failed to resolve. */
function translateForeignCall(
  name: string,
  input: unknown,
  registry: ToolRegistry,
): { name: string; input: unknown } | null {
  // A trained namespace in front of one of our names: `functions.read_file`, `browser.glob`,
  // `repo_browser.read_file` (all seen from gpt-oss).
  const dot = name.lastIndexOf(".");
  if (dot > 0 && registry.get(name.slice(dot + 1))) {
    return { name: name.slice(dot + 1), input };
  }
  if (FOREIGN_SHELL_TOOLS.has(name.toLowerCase()) && registry.get("bash") && isPlainObject(input)) {
    const command = commandFromArgv(input.cmd ?? input.command);
    if (command) return { name: "bash", input: { command } };
  }
  return null;
}

/** The single registered tool whose schema these arguments fit - every required key present,
 * no key the schema doesn't declare - or null when none or several fit. */
export function inferToolByArguments(input: unknown, registry: ToolRegistry): string | null {
  if (!isPlainObject(input) || Object.keys(input).length === 0) return null;
  const keys = Object.keys(input);
  const fits = registry.list().filter((tool) => {
    const props = isPlainObject(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
    const required = requiredKeys(tool.inputSchema);
    return (
      required.length > 0 && required.every((k) => k in input) && keys.every((k) => k in props)
    );
  });
  return fits.length === 1 ? (fits[0]?.name ?? null) : null;
}

/** Appended to "could not parse the body as JSON" errors - the failure is almost always a
 * string value (usually file content) with a raw `"` or newline in it, or the whole thing
 * wrapped in a non-JSON container. */
const JSON_BODY_HINT =
  ' The body must be one JSON object; inside string values escape every " as \\" and every ' +
  "newline as \\n, and never wrap file content in <syntax>, <block>, or markdown fences.";

export function resolveEnvelope(
  envelope: RawToolCallEnvelope,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  return resolveEnvelopeFromRepair(envelope, repairJson(envelope.body), registry);
}

/** Same dispatch as `resolveEnvelope`, taking an already-computed `repairJson` result instead
 * of the raw body - lets a caller under concurrent load (the gateway) run the repair on a
 * worker thread and only do this synchronous validation step on the main thread. */
export function resolveEnvelopeFromRepair(
  envelope: RawToolCallEnvelope,
  repaired: ReturnType<typeof repairJson>,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  // `<tool_call>` then `<tool_call name="read_file">` on the next line (seen live on
  // Qwen3.8-27B): the outer, nameless tag is a stutter; the named one inside is the call.
  const nested =
    envelope.variant === "xml" && !envelope.declaredName
      ? NESTED_NAMED_OPEN.exec(envelope.body)
      : null;
  if (nested) {
    return resolveEnvelope(
      {
        ...envelope,
        declaredName: nested[1] as string,
        body: envelope.body.slice(nested[0].length),
      },
      registry,
    );
  }
  const qwen =
    envelope.variant === "xml" && !envelope.declaredName ? QWEN_FUNCTION.exec(envelope.body) : null;
  if (qwen) {
    return finalize(envelope, qwen[1] as string, qwenParameters(envelope.body), registry, true);
  }
  if (envelope.variant === "xml") {
    return resolveXmlEnvelope(envelope, repaired, registry);
  }
  return resolveFencedEnvelope(envelope, repaired, registry);
}

/**
 * A reply that ends in a bare JSON object of arguments with no tool name anywhere (seen live on
 * gpt-oss: `{"path": "main.mjs", "old_string": "...", "new_string": "..."}` as the whole reply).
 * Treated as a call only when exactly one registered tool fits the keys - otherwise it is an
 * answer that happens to be JSON, and stays one.
 */
export function resolveTrailingArguments(
  text: string,
  registry: ToolRegistry,
): ParsedToolCall | null {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith("}") || trimmed.length > 20_000) return null;
  for (let i = trimmed.indexOf("{"); i !== -1; i = trimmed.indexOf("{", i + 1)) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed.slice(i));
    } catch {
      continue;
    }
    const name = inferToolByArguments(value, registry);
    if (!name) return null;
    const resolved = finalize({ raw: trimmed.slice(i) }, name, value, registry, true);
    return "message" in resolved ? null : resolved;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiredKeys(schema: JsonSchema): string[] {
  return Array.isArray(schema.required) ? (schema.required as string[]) : [];
}

function soleRequiredString(schema: JsonSchema): string | null {
  const req = requiredKeys(schema);
  const props = isPlainObject(schema.properties) ? schema.properties : {};
  const prop = req.length === 1 ? props[req[0] as string] : undefined;
  return isPlainObject(prop) && prop.type === "string" ? (req[0] as string) : null;
}

/** `"util.mjs"` → `util.mjs`; anything that isn't a JSON string stays as written. */
function unquoteParameter(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith('"')) return raw;
  try {
    const v: unknown = JSON.parse(t);
    return typeof v === "string" ? v : raw;
  } catch {
    return raw;
  }
}

function hasAllRequired(schema: JsonSchema, value: unknown): boolean {
  const req = requiredKeys(schema);
  return req.length > 0 && isPlainObject(value) && req.every((k) => k in value);
}

/**
 * Recovers a tool call whose string arguments contain raw (unescaped) newlines and `"` - the
 * way capable models routinely write file content into `edit_file` / `write_file`. Using the
 * tool's own parameter names as anchors, it finds each `"<param>":` marker in the raw body in
 * order and takes everything up to the next marker (or the body's end) as that value, peeling
 * one layer of surrounding quotes/backticks. Structure-agnostic on purpose: tolerates raw
 * newlines, unescaped quotes, a body split across several `{...}` objects, and trailing-brace
 * typos. Returns null unless it recovers every required parameter.
 */
function extractBySchema(body: string, schema: JsonSchema): Record<string, unknown> | null {
  const props = isPlainObject(schema.properties) ? schema.properties : undefined;
  if (!props) return null;

  const markers: { name: string; start: number; valueAt: number }[] = [];
  for (const name of Object.keys(props)) {
    const m = new RegExp(`"${escapeRegExp(name)}"\\s*:\\s*`).exec(body);
    if (m) markers.push({ name, start: m.index, valueAt: m.index + m[0].length });
  }
  if (markers.length === 0) return null;
  markers.sort((a, b) => a.start - b.start);

  const out: Record<string, unknown> = {};
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i] as (typeof markers)[number];
    const end =
      i + 1 < markers.length ? (markers[i + 1] as (typeof markers)[number]).start : body.length;
    // A closing tag the stream parser didn't recognise as one can trail the last value; it is
    // never part of an argument.
    let value = body.slice(cur.valueAt, end).replace(/\s*<\/[\w-]+[^>\n]*>\s*$/, "");

    const quoted = /^\s*(["'`])/.exec(value);
    if (quoted) {
      value = value.slice(quoted[0].length);
      // drop the closing quote and any `,` `}` `{` boundary noise before the next marker
      value = value.replace(/(["'`])[\s,{}]*$/, "");
    } else {
      // bare (non-string) value: number / boolean / null
      value = value.replace(/[\s,{}]*$/, "");
      try {
        out[cur.name] = JSON.parse(value);
        continue;
      } catch {
        // fall through and store as a string
      }
    }
    out[cur.name] = value;
  }

  return hasAllRequired(schema, out) ? out : null;
}

function resolveXmlEnvelope(
  envelope: RawToolCallEnvelope,
  repaired: ReturnType<typeof repairJson>,
  registry: ToolRegistry,
): ParsedToolCall | ToolCallParseError {
  let declaredName = envelope.declaredName;
  let input: unknown = {};
  // A wrapper name ("tool_call") doesn't name a tool: look for the real one in the body.
  let inferred = false;
  if (
    declaredName &&
    WRAPPER_NAMES.has(declaredName.toLowerCase()) &&
    !registry.get(declaredName)
  ) {
    declaredName = null;
    inferred = true;
  }

  if (repaired.ok && isPlainObject(repaired.value)) {
    // some models redundantly restate the name inside the JSON body - prefer the
    // attribute if present, otherwise fall back to a name found inside the body.
    const nameFromBody = !declaredName;
    if (!declaredName) {
      declaredName = firstStringField(repaired.value, NAME_ALIASES);
    }
    input = stripAliasKeys(repaired.value, [...NAME_ALIASES]);
    // {"name": "bash", "args": {...}} - the arguments sit one level down.
    if (nameFromBody && declaredName && isPlainObject(input)) {
      const nested = firstObjectField(input, ARGS_ALIASES);
      if (nested && Object.keys(input).length === 1) input = nested;
    }
  } else if (repaired.ok) {
    input = repaired.value;
  }

  // No name anywhere, but the arguments fit exactly one tool ({"command": "ls"} → bash).
  if (!declaredName && inferred) {
    declaredName = inferToolByArguments(input, registry);
  }

  if (!declaredName) {
    return {
      raw: envelope.raw,
      attemptedName: null,
      message: 'Tool call is missing a "name" attribute, e.g. <tool_call name="read_file">.',
    };
  }

  // If JSON repair didn't yield an object carrying every required parameter (raw newlines /
  // unescaped quotes in a string value, a body split across several {...} objects), pull the
  // arguments out by the tool's own parameter names instead.
  const { tool } = resolveToolName(declaredName, registry);
  if (tool && !hasAllRequired(tool.inputSchema, input)) {
    const bySchema = extractBySchema(envelope.body, tool.inputSchema);
    if (bySchema) {
      return finalize(envelope, declaredName, bySchema, registry, true);
    }
  }

  // `<glob>**/service.json</glob>` (seen live on Devstral): a bare string body for a tool whose
  // one required argument is a string is that argument - only a single token (a path or a
  // pattern), so a prose reply in the body stays an error.
  if (tool && !hasAllRequired(tool.inputSchema, input)) {
    const sole = soleRequiredString(tool.inputSchema);
    const body = envelope.body.trim();
    const closeTag = body.endsWith(">") ? body.lastIndexOf("</") : -1;
    const text = (closeTag >= 0 ? body.slice(0, closeTag) : body).trim();
    if (sole && text && !/[{}\s]/.test(text) && text.length <= 500) {
      return finalize(envelope, declaredName, { [sole]: text }, registry, true);
    }
  }

  if (!repaired.ok) {
    return {
      raw: envelope.raw,
      attemptedName: declaredName,
      message: `Arguments for "${declaredName}" could not be parsed as JSON: ${repaired.error}.${JSON_BODY_HINT}`,
    };
  }

  return finalize(
    envelope,
    declaredName,
    input,
    registry,
    repaired.repaired || inferred,
    repaired.strategy,
  );
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
      }.${JSON_BODY_HINT}`,
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

  return finalize(envelope, name, args, registry, repaired.repaired, repaired.strategy);
}

export function finalize(
  source: { raw: string },
  requestedName: string,
  input: unknown,
  registry: ToolRegistry,
  repaired = false,
  strategy?: RepairStrategy,
): ParsedToolCall | ToolCallParseError {
  const foreign = registry.get(requestedName)
    ? null
    : translateForeignCall(requestedName, input, registry);
  if (foreign) {
    return finalize(source, foreign.name, foreign.input, registry, true, strategy);
  }
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
    ...(repaired || correctedFrom ? { repaired: true } : {}),
    ...(strategy ? { strategy } : {}),
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
 * restructured entirely rather than just typo'd - the "additional property" errors alone (one
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
