import type { McpServerConfig } from "../config/schema.js";
import type { ToolDefinition } from "../tools/types.js";
import { type McpServerConnection, connectMcpServer } from "./client.js";

export interface McpConnectResult {
  tools: ToolDefinition[];
  servers: { serverName: string; transport: "stdio" | "http" | "sse" }[];
  errors: { serverName: string; message: string }[];
  close(): Promise<void>;
}

/** Default wall-clock budget for connecting to a single MCP server (connect + listTools). A slow
 * or unreachable remote URL must not hold up startup. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Runs one server's connect with a wall-clock budget: on timeout the connect is aborted (so a
 * spawned subprocess / open HTTP session is torn down) and a clear error is thrown. */
async function connectWithTimeout(
  serverName: string,
  config: McpServerConfig,
  timeoutMs: number,
): Promise<McpServerConnection> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await connectMcpServer(serverName, config, { signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`connect timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Connects to every configured MCP server in parallel, each with a connect timeout, tolerating
 * individual failures so one misconfigured or unreachable server doesn't prevent the rest (and
 * the built-in tools) from being usable. */
export async function connectAllMcpServers(
  servers: Record<string, McpServerConfig>,
  opts: { connectTimeoutMs?: number } = {},
): Promise<McpConnectResult> {
  const timeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const entries = Object.entries(servers);
  const settled = await Promise.allSettled(
    entries.map(([serverName, config]) => connectWithTimeout(serverName, config, timeoutMs)),
  );

  const connections: McpServerConnection[] = [];
  const errors: { serverName: string; message: string }[] = [];
  settled.forEach((result, i) => {
    const serverName = entries[i]?.[0] ?? "(unknown)";
    if (result.status === "fulfilled") {
      connections.push(result.value);
    } else {
      const reason = result.reason;
      errors.push({
        serverName,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });

  return {
    tools: connections.flatMap((c) => c.tools),
    servers: connections.map((c) => ({ serverName: c.serverName, transport: c.transport })),
    errors,
    close: async () => {
      await Promise.all(connections.map((c) => c.close()));
    },
  };
}
