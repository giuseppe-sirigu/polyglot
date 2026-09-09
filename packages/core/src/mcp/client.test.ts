import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  type TestMcpServer,
  startSseMcpServer,
  startStreamableHttpMcpServer,
} from "../testing/mcp-server.js";
import { type McpServerConnection, connectMcpServer, looksLikeWrongTransport } from "./client.js";

const signal = new AbortController().signal;
const call = (conn: McpServerConnection, tool: string, input: unknown) =>
  conn.tools
    .find((t) => t.name === `mcp__t__${tool}`)
    ?.execute(input, { cwd: "/tmp", sessionId: "s", signal });

let servers: TestMcpServer[] = [];
let conns: McpServerConnection[] = [];
afterEach(async () => {
  await Promise.all(conns.map((c) => c.close().catch(() => {})));
  await Promise.all(servers.map((s) => s.close().catch(() => {})));
  servers = [];
  conns = [];
});

describe("looksLikeWrongTransport", () => {
  it("is true for a 404/405/400 StreamableHTTPError", () => {
    expect(looksLikeWrongTransport(new StreamableHTTPError(405, "nope"))).toBe(true);
    expect(looksLikeWrongTransport(new StreamableHTTPError(404, "nope"))).toBe(true);
    expect(looksLikeWrongTransport(new StreamableHTTPError(400, "nope"))).toBe(true);
  });
  it("is true for a TypeError / SyntaxError (bad initial POST)", () => {
    expect(looksLikeWrongTransport(new TypeError("fetch failed"))).toBe(true);
    expect(looksLikeWrongTransport(new SyntaxError("Unexpected token"))).toBe(true);
  });
  it("is false for a real failure", () => {
    expect(looksLikeWrongTransport(new StreamableHTTPError(500, "boom"))).toBe(false);
    expect(looksLikeWrongTransport(new Error("connection refused"))).toBe(false);
  });
});

describe("connectMcpServer over HTTP", () => {
  it("connects via Streamable HTTP, lists tools, and calls them", async () => {
    const server = await startStreamableHttpMcpServer();
    servers.push(server);
    const conn = await connectMcpServer("t", { url: server.url });
    conns.push(conn);

    expect(conn.transport).toBe("http");
    expect(conn.tools.map((t) => t.name).sort()).toEqual(["mcp__t__add", "mcp__t__echo"]);
    expect((await call(conn, "echo", { text: "hi" }))?.toModelText()).toBe("hi");
    expect((await call(conn, "add", { a: 2, b: 3 }))?.toModelText()).toBe("5");
  });

  it("uses SSE when transport is pinned to sse", async () => {
    const server = await startSseMcpServer();
    servers.push(server);
    const conn = await connectMcpServer("t", { url: server.url, transport: "sse" });
    conns.push(conn);

    expect(conn.transport).toBe("sse");
    expect((await call(conn, "echo", { text: "yo" }))?.toModelText()).toBe("yo");
  });

  it("auto-negotiates: falls back to SSE when the server rejects Streamable HTTP", async () => {
    const server = await startSseMcpServer();
    servers.push(server);
    const conn = await connectMcpServer("t", { url: server.url }); // no transport hint
    conns.push(conn);

    expect(conn.transport).toBe("sse");
    expect((await call(conn, "add", { a: 10, b: 1 }))?.toModelText()).toBe("11");
  });

  it("rejects (and cleans up) when the url is unreachable", async () => {
    await expect(connectMcpServer("t", { url: "http://127.0.0.1:1/mcp" })).rejects.toThrow();
  });
});
