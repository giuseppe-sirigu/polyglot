import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "../config/schema.js";
import { type JsonSchema, type ToolDefinition, textResult } from "../tools/types.js";

export interface McpServerConnection {
  serverName: string;
  tools: ToolDefinition[];
  close(): Promise<void>;
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return String(content);
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "type" in block) {
      const b = block as { type: string; text?: string };
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
        continue;
      }
      parts.push(`[${b.type} content omitted]`);
    }
  }
  return parts.join("\n");
}

/** Connects to one MCP server over stdio and wraps each of its tools as a
 * ToolDefinition - namespaced as mcp__<server>__<tool> - so they flow through
 * the exact same text-parsed tool-call grammar as the built-in tools, rather
 * than being exposed via native function-calling. */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
): Promise<McpServerConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...(process.env as Record<string, string>), ...config.env },
  });

  const client = new Client({ name: "polyglot", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();

  const tools: ToolDefinition[] = mcpTools.map((mcpTool) => ({
    name: `mcp__${serverName}__${mcpTool.name}`,
    description: mcpTool.description ?? `Tool "${mcpTool.name}" from MCP server "${serverName}".`,
    inputSchema: mcpTool.inputSchema as JsonSchema,
    permission: "execute",
    async execute(input, ctx) {
      const result = await client.callTool(
        { name: mcpTool.name, arguments: input as Record<string, unknown> },
        undefined,
        { signal: ctx.signal },
      );
      const text = contentToText(result.content);
      return textResult(text, !result.isError);
    },
  }));

  return {
    serverName,
    tools,
    close: () => client.close(),
  };
}
