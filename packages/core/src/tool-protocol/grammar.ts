import type { ToolDefinition } from "../tools/types.js";

type Schema = Record<string, unknown>;

/** Nested objects deeper than this render as `object`, so one odd schema can't flood the prompt. */
const MAX_DEPTH = 4;

/** The tool's parameters as a TypeScript-like interface body. Everything the model must respect to
 * pass validation is shown: allowed values, item types, nested objects and their required keys,
 * and patterns, formats and limits as comments. */
function renderSchemaAsPseudoType(schema: Schema, indent = "  ", depth = 0): string {
  const properties = (schema.properties as Record<string, Schema>) ?? {};
  const required = new Set((schema.required as string[]) ?? []);
  const lines = Object.entries(properties).map(([key, prop]) => {
    const optional = required.has(key) ? "" : "?";
    const type = renderPropertyType(prop, indent, depth);
    const notes = [
      typeof prop.description === "string" ? prop.description : "",
      ...constraintNotes(prop),
    ]
      .filter((n) => n !== "")
      .join("; ");
    return `${indent}${key}${optional}: ${type};${notes ? ` // ${notes}` : ""}`;
  });
  return lines.join("\n");
}

function renderPropertyType(prop: Schema, indent: string, depth: number): string {
  if (Array.isArray(prop.enum)) return prop.enum.map((v) => JSON.stringify(v)).join(" | ");
  if ("const" in prop) return JSON.stringify(prop.const);
  const variants = (prop.anyOf ?? prop.oneOf) as Schema[] | undefined;
  if (Array.isArray(variants))
    return variants.map((v) => renderPropertyType(v, indent, depth)).join(" | ");
  if (Array.isArray(prop.type))
    return prop.type
      .map((t) => renderPropertyType({ ...prop, type: t }, indent, depth))
      .join(" | ");
  switch (prop.type) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      if (!prop.items || typeof prop.items !== "object") return "unknown[]";
      const item = renderPropertyType(prop.items as Schema, indent, depth);
      return item.includes("|") ? `(${item})[]` : `${item}[]`;
    }
    case "object": {
      if (prop.properties && depth < MAX_DEPTH) {
        return `{\n${renderSchemaAsPseudoType(prop, `${indent}  `, depth + 1)}\n${indent}}`;
      }
      const extra = prop.additionalProperties;
      if (extra && typeof extra === "object" && depth < MAX_DEPTH)
        return `Record<string, ${renderPropertyType(extra as Schema, indent, depth + 1)}>`;
      return "object";
    }
    default:
      return "unknown";
  }
}

function constraintNotes(prop: Schema): string[] {
  const notes: string[] = [];
  if (typeof prop.pattern === "string") notes.push(`must match /${prop.pattern}/`);
  if (typeof prop.format === "string") notes.push(`format: ${prop.format}`);
  if (typeof prop.minimum === "number") notes.push(`minimum ${prop.minimum}`);
  if (typeof prop.exclusiveMinimum === "number")
    notes.push(`greater than ${prop.exclusiveMinimum}`);
  if (typeof prop.maximum === "number") notes.push(`maximum ${prop.maximum}`);
  if (typeof prop.exclusiveMaximum === "number") notes.push(`less than ${prop.exclusiveMaximum}`);
  if (typeof prop.minLength === "number") notes.push(`at least ${prop.minLength} characters`);
  if (typeof prop.maxLength === "number") notes.push(`at most ${prop.maxLength} characters`);
  if (typeof prop.minItems === "number") notes.push(`at least ${prop.minItems} items`);
  if (typeof prop.maxItems === "number") notes.push(`at most ${prop.maxItems} items`);
  if (prop.default !== undefined) notes.push(`default ${JSON.stringify(prop.default)}`);
  return notes;
}

function renderToolDoc(tool: ToolDefinition): string {
  const params = renderSchemaAsPseudoType(tool.inputSchema);
  return [
    `### ${tool.name}`,
    tool.description,
    "```ts",
    `interface ${toPascalCase(tool.name)}Args {`,
    params || "  // no arguments",
    "}",
    "```",
  ].join("\n");
}

function toPascalCase(name: string): string {
  return name
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function buildToolSystemPrompt(
  tools: ToolDefinition[],
  cwd: string,
  mode?: "manual" | "auto" | "plan",
  options?: { structured?: boolean },
): string {
  if (tools.length === 0) return "";

  const toolDocs = tools.map(renderToolDoc).join("\n\n");
  const platformNote = tools.some((t) => t.name === "bash") ? `\n\n${describePlatform()}` : "";
  const planModeNote =
    mode === "plan"
      ? "\n\nYou are currently in PLAN MODE: only read-only and research tools (e.g. read_file, " +
        "grep, glob, web_fetch, web_search, ask_user_question) will succeed. write_file, " +
        "edit_file, bash, and task are hard-denied right now - do not attempt them, they will " +
        "just fail and waste a turn. Do " +
        "your read-only research, then call exit_plan_mode with your plan; write/execute tools " +
        "become available only after the user approves it. Do NOT ask the user to confirm your " +
        'plan in prose (e.g. "Please confirm if you would like me to proceed", "Let me know if ' +
        'this looks good") - that is not how approval works here and the user cannot approve ' +
        "anything that way. The ONLY way to present a plan for approval is to call " +
        "exit_plan_mode with the plan text as its argument; the user is then shown a dedicated " +
        "approve/reject prompt directly, and you get the answer back as that call's result. If " +
        "you notice you've just written a plan summary as your message instead of calling the " +
        "tool, stop and call exit_plan_mode with that same content right away instead of asking " +
        "the user anything."
      : "";

  if (options?.structured) {
    return `## Tools

Your current working directory is: ${cwd}

You must respond with a single JSON object matching this shape:
{"message": "...", "tool_calls": [{"name": "...", "arguments": {...}}]}

- "message": your natural-language reply to show the user this turn. Use "" if this turn is only tool calls.
- "tool_calls": zero or more tool invocations to run this turn. Each entry's "arguments" must match that tool's own schema below. Use [] if you have nothing to call.
- Do not describe a tool call in "message" instead of making it - if you decide to use a tool, put it in "tool_calls". Writing out an edit, command, or file as a code block in "message" does nothing; the change only happens when you emit the actual tool call.
- Only the tools listed below exist - "name" must be exactly one of them.
- After tool_calls run, their results are given back to you as a new message; you'll be asked to produce another JSON object of this same shape. Keep going until there's nothing left to do, then return an empty tool_calls array with your final message.${platformNote}${planModeNote}

Available tools:

${toolDocs}`;
  }

  const [exampleTool] = tools;
  if (!exampleTool) return "";
  const exampleArgs = buildExampleArgs(exampleTool);

  return `## Tools

Your current working directory is: ${cwd}

You have access to the following tools. To use one, emit a block in exactly this format,
with nothing else on the opening and closing lines:

<tool_call name="TOOL_NAME">
{"arg1": "value1", "arg2": "value2"}
</tool_call>

Rules:
- The content between the tags must be a single JSON object matching the tool's arguments - no comments, no trailing commas, no prose.
- Every value must be a JSON literal, never code - no function calls (e.g. \`JSON.stringify(...)\`), no variable references, no expressions. If an argument's value is itself structured data (e.g. a file's JSON content for write_file's "content"), write it out fully as a plain JSON string, don't compute it.
- The object's keys must exactly match the tool's declared parameter names, nothing more and nothing less. Never substitute a parameter with unrelated structure - e.g. when writing structured content to a file, encode it as a JSON string inside the "content" parameter, not as separate sibling keys alongside "path".
- Only one tool call per <tool_call> block. If you need multiple tool calls, emit multiple separate blocks.
- Never put a tool call inside a code fence (no \`\`\` around it).
- Do not describe a tool call in prose instead of emitting it - if you decide to use a tool, emit the block.
- Wait for the tool's result (given back to you as a message) before continuing, rather than guessing the outcome.
- If a tool call fails to parse, you will be told what was wrong so you can retry.
- Never invent file paths, file contents, or tool results from memory or guesswork. When quoting or reviewing code, quote only what a tool result actually returned - read a file before discussing its contents, and if you're unsure whether something exists, use a tool to check rather than assuming.
- After a tool call, its result is given back to you wrapped as <tool_result name="...">...</tool_result> - that wrapper is informational, never emit it yourself.${platformNote}${planModeNote}

Available tools:

${toolDocs}

Example - calling "${exampleTool.name}":
<tool_call name="${exampleTool.name}">
${JSON.stringify(exampleArgs)}
</tool_call>`;
}

function describePlatform(): string {
  const label =
    process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const shellNote =
    process.platform === "win32"
      ? "bash commands run through PowerShell, not cmd.exe - prefer PowerShell-compatible syntax (ls, cat, cp, rm, Remove-Item, etc.) and PowerShell path separators when in doubt."
      : "bash commands run through bash.";
  return `You are running on ${label}. ${shellNote}`;
}

function buildExampleArgs(tool: ToolDefinition): Record<string, unknown> {
  return exampleObject(tool.inputSchema, 0);
}

function exampleObject(schema: Schema, depth: number): Record<string, unknown> {
  const properties = (schema.properties as Record<string, Schema>) ?? {};
  const example: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) example[key] = exampleValue(prop, depth);
  return example;
}

/** A value that passes the property's schema where that's easy to know, so the example never
 * shows the model something validation would refuse. */
function exampleValue(prop: Schema, depth: number): unknown {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return prop.enum[0];
  if ("const" in prop) return prop.const;
  const variants = (prop.anyOf ?? prop.oneOf) as Schema[] | undefined;
  if (Array.isArray(variants) && variants[0]) return exampleValue(variants[0], depth);
  const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") : prop.type;
  switch (type) {
    case "string":
      return "example";
    case "integer":
    case "number":
      return typeof prop.minimum === "number" ? prop.minimum : 1;
    case "boolean":
      return true;
    case "array":
      return prop.items && typeof prop.items === "object" && depth < MAX_DEPTH
        ? [exampleValue(prop.items as Schema, depth + 1)]
        : [];
    case "object":
      return depth < MAX_DEPTH ? exampleObject(prop, depth + 1) : {};
    default:
      return "example";
  }
}
