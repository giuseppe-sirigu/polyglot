import {
  type ResolvedConfig,
  connectAllMcpServers,
  createProviderAdapter,
  createSession,
  loadConfig,
  persistSessionHeader,
} from "@usepolyglot/core";
import { render } from "ink";
import { createElement } from "react";
import { HELP_TEXT, parseCliArgs } from "./args.js";
import { resolveResumeTarget, runHeadless } from "./headless.js";
import { runInit } from "./init.js";
import { applyCapabilityProbe } from "./probe.js";
import { runShare } from "./share.js";
import { App } from "./ui/App.js";

/** Loads config, and on the "you haven't configured a provider yet" error runs the setup
 * wizard once (only when there's a terminal to prompt on) and retries. Any other error, or a
 * non-interactive session, propagates to the top-level handler. */
async function loadConfigOrSetUp(cwd: string): Promise<ResolvedConfig> {
  try {
    return loadConfig(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notConfigured = message.includes("not set") || message.includes("must be set");
    if (notConfigured && process.stdin.isTTY && process.stdout.isTTY) {
      console.log("No polyglot config found — let's set one up.");
      await runInit();
      return loadConfig(cwd);
    }
    throw err;
  }
}

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
  if (cliArgs.init) {
    await runInit();
    return;
  }
  if (cliArgs.share) {
    process.exitCode = await runShare(cliArgs);
    return;
  }

  const cwd = process.cwd();
  const resolved = await loadConfigOrSetUp(cwd);
  // A launch-time flag can only tighten this, never loosen it.
  if (cliArgs.noPersist) resolved.persistTranscripts = false;

  if (cliArgs.print) {
    process.exitCode = await runHeadless(cliArgs, resolved);
    return;
  }

  const { adapter, note: probeNote } = await applyCapabilityProbe(
    createProviderAdapter(resolved.engine),
    resolved,
    { force: cliArgs.probe },
  );

  let session: Awaited<ReturnType<typeof createSession>>;
  let resumed = false;

  if (cliArgs.resume) {
    const existing = await resolveResumeTarget(cliArgs.resumeId);
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

  const instance = render(
    createElement(App, { resolved, adapter, session, resumed, mcp, probeNote }),
  );
  await instance.waitUntilExit();
  await mcp?.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
