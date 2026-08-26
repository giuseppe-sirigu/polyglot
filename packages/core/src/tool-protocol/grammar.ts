import type { ToolDefinition } from "../tools/types.js";

function renderSchemaAsPseudoType(schema: Record<string, unknown>, indent = "  "): string {
  const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
  const required = new Set((schema.required as string[]) ?? []);
  const lines = Object.entries(properties).map(([key, prop]) => {
    const optional = required.has(key) ? "" : "?";
    const type = renderPropertyType(prop);
    const description = typeof prop.description === "string" ? ` // ${prop.description}` : "";
    return `${indent}${key}${optional}: ${type};${description}`;
  });
  return lines.join("\n");
}

function renderPropertyType(prop: Record<string, unknown>): string {
  switch (prop.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "unknown[]";
    case "object":
      return "object";
    default:
      return "unknown";
  }
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

export function buildToolSystemPrompt(tools: ToolDefinition[], cwd: string): string {
  if (tools.length === 0) return "";

  const toolDocs = tools.map(renderToolDoc).join("\n\n");
  const [exampleTool] = tools;
  if (!exampleTool) return "";
  const exampleArgs = buildExampleArgs(exampleTool);
  const platformNote = tools.some((t) => t.name === "bash") ? `\n\n${describePlatform()}` : "";

  return `## Tools

Your current working directory is: ${cwd}

You have access to the following tools. To use one, emit a block in exactly this format,
with nothing else on the opening and closing lines:

<tool_call name="TOOL_NAME">
{"arg1": "value1", "arg2": "value2"}
</tool_call>

Rules:
- The content between the tags must be a single JSON object matching the tool's arguments — no comments, no trailing commas, no prose.
- Only one tool call per <tool_call> block. If you need multiple tool calls, emit multiple separate blocks.
- Never put a tool call inside a code fence (no \`\`\` around it).
- Do not describe a tool call in prose instead of emitting it — if you decide to use a tool, emit the block.
- Wait for the tool's result (given back to you as a message) before continuing, rather than guessing the outcome.
- If a tool call fails to parse, you will be told what was wrong so you can retry.
- After a tool call, its result is given back to you wrapped as <tool_result name="...">...</tool_result> — that wrapper is informational, never emit it yourself.${platformNote}

Available tools:

${toolDocs}

Example — calling "${exampleTool.name}":
<tool_call name="${exampleTool.name}">
${JSON.stringify(exampleArgs)}
</tool_call>`;
}

function describePlatform(): string {
  const label =
    process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const shellNote =
    process.platform === "win32"
      ? "bash commands run through PowerShell, not cmd.exe — prefer PowerShell-compatible syntax (ls, cat, cp, rm, Remove-Item, etc.) and PowerShell path separators when in doubt."
      : "bash commands run through bash.";
  return `You are running on ${label}. ${shellNote}`;
}

function buildExampleArgs(tool: ToolDefinition): Record<string, unknown> {
  const properties = (tool.inputSchema.properties as Record<string, Record<string, unknown>>) ?? {};
  const example: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    example[key] = prop.type === "string" ? "example" : prop.type === "number" ? 1 : true;
  }
  return example;
}
