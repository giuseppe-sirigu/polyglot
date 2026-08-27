import {
  connectAllMcpServers,
  createProviderAdapter,
  createSession,
  listSessions,
  loadConfig,
  loadSession,
  persistSessionHeader,
} from "@usepolyglot/core";
import { render } from "ink";
import { createElement } from "react";
import { HELP_TEXT, parseCliArgs } from "./args.js";
import { runHeadless } from "./headless.js";
import { App } from "./ui/App.js";

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.version) {
    console.log(__VERSION__);
    return;
  }
  if (cliArgs.help) {
    console.log(HELP_TEXT);
    return;
  }

  const cwd = process.cwd();
  const resolved = loadConfig(cwd);
  // A launch-time flag can only tighten this, never loosen it.
  if (cliArgs.noPersist) resolved.persistTranscripts = false;

  if (cliArgs.print) {
    process.exitCode = await runHeadless(cliArgs, resolved);
    return;
  }

  const adapter = createProviderAdapter(resolved.engine);

  let session: Awaited<ReturnType<typeof createSession>>;
  let resumed = false;

  if (cliArgs.resume) {
    const targetId = cliArgs.resumeId ?? (await listSessions())[0]?.id;
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
    if (resolved.persistTranscripts) await persistSessionHeader(session);
  }

  const mcpServerNames = Object.keys(resolved.mcpServers);
  const mcp = mcpServerNames.length > 0 ? await connectAllMcpServers(resolved.mcpServers) : null;

  // Start from a blank terminal: clear the visible screen, the scrollback buffer, and home the
  // cursor. Only when attached to a real terminal - writing escape codes into a pipe/redirect
  // would just corrupt the output.
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  }

  const instance = render(createElement(App, { resolved, adapter, session, resumed, mcp }));
  await instance.waitUntilExit();
  await mcp?.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
