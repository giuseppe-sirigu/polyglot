import {
  connectAllMcpServers,
  createProviderAdapter,
  createSession,
  listSessions,
  loadConfig,
  loadSession,
  persistSessionHeader,
} from "@polyglot/core";
import { render } from "ink";
import { createElement } from "react";
import { App } from "./ui/App.js";

async function main() {
  const cwd = process.cwd();
  const resolved = loadConfig(cwd);
  const adapter = createProviderAdapter(resolved.engine);

  const args = process.argv.slice(2);
  const resumeIdx = args.indexOf("--resume");
  let session: Awaited<ReturnType<typeof createSession>>;
  let resumed = false;

  if (resumeIdx !== -1) {
    const requestedId = args[resumeIdx + 1];
    const targetId =
      requestedId && !requestedId.startsWith("--") ? requestedId : (await listSessions())[0]?.id;
    const existing = targetId ? await loadSession(targetId) : null;
    if (!existing) {
      console.error("[polyglot] no session found to resume.");
      process.exitCode = 1;
      return;
    }
    session = existing;
    resumed = true;
  } else {
    session = createSession({
      cwd,
      provider: resolved.engine.provider,
      model: resolved.engine.model,
    });
    await persistSessionHeader(session);
  }

  const mcpServerNames = Object.keys(resolved.mcpServers);
  const mcp = mcpServerNames.length > 0 ? await connectAllMcpServers(resolved.mcpServers) : null;

  const instance = render(createElement(App, { resolved, adapter, session, resumed, mcp }));
  await instance.waitUntilExit();
  await mcp?.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
