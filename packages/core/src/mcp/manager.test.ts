import { afterEach, describe, expect, it } from "vitest";
import {
  type TestMcpServer,
  startHangingServer,
  startStreamableHttpMcpServer,
} from "../testing/mcp-server.js";
import { connectAllMcpServers } from "./manager.js";

let servers: TestMcpServer[] = [];
let closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closes.map((c) => c().catch(() => {})));
  await Promise.all(servers.map((s) => s.close().catch(() => {})));
  servers = [];
  closes = [];
});

describe("connectAllMcpServers", () => {
  it("connects the good servers and reports the bad ones, without one blocking the others", async () => {
    const good = await startStreamableHttpMcpServer();
    servers.push(good);

    const result = await connectAllMcpServers({
      good: { url: good.url },
      dead: { url: "http://127.0.0.1:1/mcp" },
    });
    closes.push(result.close);

    expect(result.tools.map((t) => t.name).sort()).toEqual(["mcp__good__add", "mcp__good__echo"]);
    expect(result.servers).toEqual([{ serverName: "good", transport: "http" }]);
    expect(result.errors.map((e) => e.serverName)).toEqual(["dead"]);
  });

  it("abandons a server that never responds after the connect timeout, keeping the rest", async () => {
    const good = await startStreamableHttpMcpServer();
    const hanging = await startHangingServer();
    servers.push(good, hanging);

    const result = await connectAllMcpServers(
      { good: { url: good.url }, slow: { url: hanging.url } },
      { connectTimeoutMs: 800 },
    );
    closes.push(result.close);

    expect(result.servers).toEqual([{ serverName: "good", transport: "http" }]);
    expect(result.errors).toEqual([
      { serverName: "slow", message: expect.stringMatching(/timed out after 0\.8s/) },
    ]);
  });
});
