import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpHttpServer, McpServerConfig } from "../config/schema.js";
import { type JsonSchema, type ToolDefinition, textResult } from "../tools/types.js";

export interface McpServerConnection {
  serverName: string;
  /** Which transport the connection ended up using - shown in `/status`. */
  transport: "stdio" | "http" | "sse";
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

function isHttpServer(config: McpServerConfig): config is McpHttpServer {
  return "url" in config;
}

/** True when an error from a Streamable HTTP connect attempt suggests the server only speaks the
 * legacy HTTP+SSE transport (so a retry on SSE is worth it), rather than a real failure. */
export function looksLikeWrongTransport(err: unknown): boolean {
  if (err instanceof StreamableHTTPError) {
    return err.code === 404 || err.code === 405 || err.code === 400;
  }
  // A server that closes the connection or returns non-JSON on the initial POST surfaces as a
  // TypeError / SyntaxError from fetch rather than a StreamableHTTPError.
  return err instanceof TypeError || err instanceof SyntaxError;
}

/** Connects `client` with the transport implied by `config`. For a `url` server with no explicit
 * `transport`, tries Streamable HTTP and falls back to legacy SSE on a transport-mismatch error.
 * Returns which transport won. */
async function connect(
  client: Client,
  config: McpServerConfig,
  signal?: AbortSignal,
): Promise<McpServerConnection["transport"]> {
  if (!isHttpServer(config)) {
    await client.connect(
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...(process.env as Record<string, string>), ...config.env },
      }),
      { signal },
    );
    return "stdio";
  }

  const url = new URL(config.url);
  const opts = config.headers ? { requestInit: { headers: config.headers } } : undefined;

  if (config.transport === "sse") {
    await client.connect(new SSEClientTransport(url, opts), { signal });
    return "sse";
  }
  if (config.transport === "http") {
    await client.connect(new StreamableHTTPClientTransport(url, opts), { signal });
    return "http";
  }
  try {
    await client.connect(new StreamableHTTPClientTransport(url, opts), { signal });
    return "http";
  } catch (err) {
    if (!looksLikeWrongTransport(err)) throw err;
    await client.connect(new SSEClientTransport(url, opts), { signal });
    return "sse";
  }
}

/** Connects to one MCP server (stdio subprocess or remote HTTP) and wraps each of its tools as a
 * ToolDefinition - namespaced as mcp__<server>__<tool> - so they flow through the exact same
 * text-parsed tool-call grammar as the built-in tools, rather than native function-calling. */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<McpServerConnection> {
  const client = new Client({ name: "polyglot", version: "0.1.0" }, { capabilities: {} });

  let transport: McpServerConnection["transport"];
  let mcpTools: Awaited<ReturnType<Client["listTools"]>>["tools"];
  try {
    transport = await connect(client, config, opts.signal);
    ({ tools: mcpTools } = await client.listTools(undefined, { signal: opts.signal }));
  } catch (err) {
    // Tear down a half-open connection (kills a spawned subprocess / closes the HTTP session)
    // so an aborted or failed connect doesn't leak it.
    await client.close().catch(() => {});
    throw err;
  }

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
    transport,
    tools,
    close: () => client.close(),
  };
}
