import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** A throwaway in-process MCP server for tests. Exposes two tools: `echo` and `add`. */
export interface TestMcpServer {
  url: string;
  close(): Promise<void>;
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  server.registerTool(
    "echo",
    { description: "echoes its input", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.registerTool(
    "add",
    { description: "adds two numbers", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
  );
  return server;
}

function listen(http: Server): Promise<number> {
  return new Promise((resolve) => {
    http.listen(0, "127.0.0.1", () => resolve((http.address() as AddressInfo).port));
  });
}

/** A server that speaks the current Streamable HTTP transport at `/mcp`. */
export async function startStreamableHttpMcpServer(): Promise<TestMcpServer> {
  const mcp = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await mcp.connect(transport);

  const http = createServer((req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    void transport.handleRequest(req, res);
  });
  const port = await listen(http);
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await transport.close();
      await mcp.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

/** A server that speaks *only* the legacy HTTP+SSE transport - `GET /sse` opens the stream,
 * `POST /messages?sessionId=…` delivers a client message. A POST straight to the base URL (what
 * the Streamable HTTP client tries first) is rejected 405, so the client falls back. */
export async function startSseMcpServer(): Promise<TestMcpServer> {
  const mcp = buildServer();
  const transports = new Map<string, SSEServerTransport>();

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      await mcp.connect(transport);
      return;
    }
    if (req.method === "POST" && url.pathname === "/messages") {
      const transport = transports.get(url.searchParams.get("sessionId") ?? "");
      if (!transport) {
        res.writeHead(404).end();
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }
    res.writeHead(405).end();
  });
  const port = await listen(http);
  return {
    url: `http://127.0.0.1:${port}/sse`,
    close: async () => {
      for (const t of transports.values()) await t.close();
      await mcp.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

/** A server whose HTTP handler never responds - used to exercise the connect timeout. */
export async function startHangingServer(): Promise<TestMcpServer> {
  const http = createServer(() => {
    /* never write a response */
  });
  const port = await listen(http);
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
