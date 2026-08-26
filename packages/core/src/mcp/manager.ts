import type { McpServerConfig } from "../config/schema.js";
import type { ToolDefinition } from "../tools/types.js";
import { type McpServerConnection, connectMcpServer } from "./client.js";

export interface McpConnectResult {
  tools: ToolDefinition[];
  errors: { serverName: string; message: string }[];
  close(): Promise<void>;
}

/** Connects to every configured MCP server, tolerating individual failures so
 * one misconfigured server doesn't prevent the rest (and the built-in tools)
 * from being usable. */
export async function connectAllMcpServers(
  servers: Record<string, McpServerConfig>,
): Promise<McpConnectResult> {
  const connections: McpServerConnection[] = [];
  const errors: { serverName: string; message: string }[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    try {
      connections.push(await connectMcpServer(serverName, config));
    } catch (err) {
      errors.push({ serverName, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    tools: connections.flatMap((c) => c.tools),
    errors,
    close: async () => {
      await Promise.all(connections.map((c) => c.close()));
    },
  };
}
