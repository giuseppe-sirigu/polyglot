import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  type Session,
  ToolRegistry,
  bashTool,
  createWebSearchTool,
  editFileTool,
  globTool,
  grepTool,
  listSessions,
  loadConfig,
  loadSession,
  loadSessionFromPath,
  readFileTool,
  serializeSessionHtml,
  serializeSessionMarkdown,
  webFetchTool,
} from "@usepolyglot/core";
import type { CliArgs } from "./args.js";

function looksLikePath(token: string): boolean {
  return token.includes("/") || token.endsWith(".jsonl");
}

/** A tool registry just for decoding a transcript - the base file/shell tools, plus web_search
 * and MCP tools when a config loads. Decoding tolerates calls to tools not in here. */
function decodeRegistry(cwd: string): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [readFileTool, editFileTool, grepTool, globTool, bashTool, webFetchTool]) {
    registry.register(tool);
  }
  try {
    registry.register(createWebSearchTool(loadConfig(cwd).webSearch));
  } catch {
    // no config / bad config - base tools are enough for decoding
  }
  return registry;
}

export async function runShare(args: CliArgs): Promise<number> {
  const cwd = process.cwd();

  let session: Session | null;
  if (args.shareTarget && looksLikePath(args.shareTarget)) {
    session = await loadSessionFromPath(
      isAbsolute(args.shareTarget) ? args.shareTarget : resolve(cwd, args.shareTarget),
    );
  } else {
    const id = args.shareTarget ?? (await listSessions())[0]?.id;
    session = id ? await loadSession(id) : null;
  }

  if (!session) {
    process.stderr.write(
      args.shareTarget
        ? `[polyglot] no session found for "${args.shareTarget}".\n`
        : "[polyglot] no sessions to share.\n",
    );
    return 1;
  }

  const tools = decodeRegistry(cwd);
  const opts = { redact: args.shareRedact, includeToolIO: args.shareFull };
  const body =
    args.shareFormat === "html"
      ? serializeSessionHtml(session, tools, opts)
      : serializeSessionMarkdown(session, tools, opts);

  const ext = args.shareFormat === "html" ? "html" : "md";
  const date = new Date().toISOString().slice(0, 10);
  const outPath = resolve(cwd, args.shareOut ?? `polyglot-session-${date}.${ext}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf8");

  const redactNote = args.shareRedact ? " (secrets scrubbed)" : " (NOT redacted)";
  process.stderr.write(`[polyglot] wrote ${outPath}${redactNote}\n`);
  return 0;
}
