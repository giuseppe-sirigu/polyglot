import {
  AllowAllGate,
  type McpConnectResult,
  PolicyGate,
  type ResolvedConfig,
  type Session,
  assembleSystemPrompt,
  bashTool,
  buildAgentTools,
  connectAllMcpServers,
  createAskUserQuestionTool,
  createExitPlanModeTool,
  createProviderAdapter,
  createSession,
  createWebSearchTool,
  editFileTool,
  globTool,
  grepTool,
  listSessions,
  loadSession,
  persistMessage,
  persistSessionHeader,
  persistSessionUsage,
  prunePlans,
  pruneSessions,
  readFileTool,
  runAgentTurn,
  webFetchTool,
  writeFileTool,
} from "@usepolyglot/core";
import type { CliArgs } from "./args.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function summarizeInput(input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const primary = obj.command ?? obj.path ?? obj.pattern ?? obj.url ?? obj.query;
    if (typeof primary === "string") {
      return primary.length > 80 ? `${primary.slice(0, 80)}…` : primary;
    }
  }
  return "";
}

/** Runs a single prompt to completion with no TTY, prints the result, and returns an exit code. */
export async function runHeadless(args: CliArgs, resolved: ResolvedConfig): Promise<number> {
  const cwd = process.cwd();
  const json = args.outputFormat === "json";

  const prompt = (args.prompt ?? (process.stdin.isTTY ? "" : await readStdin())).trim();
  if (!prompt) {
    process.stderr.write(
      "[polyglot] no prompt provided. Pass one as an argument or pipe it via stdin.\n",
    );
    return 1;
  }

  const adapter = createProviderAdapter(resolved.engine);
  const persist = resolved.persistTranscripts;

  let session: Session;
  if (args.resume) {
    const targetId = args.resumeId ?? (await listSessions())[0]?.id;
    const existing = targetId ? await loadSession(targetId) : null;
    if (!existing) {
      process.stderr.write("[polyglot] no session found to resume.\n");
      return 1;
    }
    session = existing;
  } else {
    session = createSession({
      cwd,
      provider: resolved.engine.provider,
      model: resolved.engine.model,
    });
    if (persist) await persistSessionHeader(session);
  }

  if (persist && resolved.retentionDays) {
    await Promise.all([
      pruneSessions(resolved.retentionDays, session.id),
      prunePlans(resolved.retentionDays),
    ]);
  }

  const mcpServerNames = Object.keys(resolved.mcpServers);
  let mcp: McpConnectResult | null = null;
  if (mcpServerNames.length > 0) {
    mcp = await connectAllMcpServers(resolved.mcpServers);
    for (const error of mcp.errors) {
      process.stderr.write(
        `[polyglot] MCP server "${error.serverName}" failed to connect: ${error.message}\n`,
      );
    }
  }

  const mode = args.allowAll ? "auto" : (args.permissionMode ?? resolved.permissions.mode);
  const gate = args.allowAll
    ? new AllowAllGate()
    : new PolicyGate({
        mode,
        allow: resolved.permissions.allow,
        deny: resolved.permissions.deny,
        // No onAskUser: without a TTY there is nothing to prompt on, so anything not covered by
        // an allow rule or an unattended mode is denied with a clear reason fed back to the model.
      });

  const tools = buildAgentTools({
    baseTools: [
      readFileTool,
      writeFileTool,
      editFileTool,
      bashTool,
      grepTool,
      globTool,
      webFetchTool,
      createWebSearchTool(resolved.webSearch),
      ...(mcp?.tools ?? []),
    ],
    adapter,
    gate,
    model: session.model,
    cwd: session.cwd,
  });
  tools.register(
    createAskUserQuestionTool(async () => {
      throw new Error("ask_user_question is unavailable in non-interactive (-p) mode.");
    }),
  );
  if (gate instanceof PolicyGate) {
    tools.register(createExitPlanModeTool(gate, async () => false, "manual", persist));
  }

  const systemPrompt = assembleSystemPrompt({
    tools: tools.list(),
    cwd: session.cwd,
    mode,
    structured: adapter.capabilities.structuredOutput,
  });

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  let assistantText = "";
  let stopReason: "done" | "max_steps" | "unreliable_model" = "done";
  let isError = false;

  try {
    await runAgentTurn({
      session,
      adapter,
      userInput: prompt,
      systemPrompt,
      tools,
      gate,
      signal: controller.signal,
      onMessage: persist ? (message) => persistMessage(session.id, message) : undefined,
      onEvent: (event) => {
        switch (event.type) {
          case "text_delta":
            assistantText += event.delta;
            if (!json) process.stdout.write(event.delta);
            break;
          case "tool_call": {
            const summary = summarizeInput(event.input);
            process.stderr.write(`● ${event.name}(${summary})\n`);
            break;
          }
          case "tool_result":
            if (event.isError) process.stderr.write(`  ⎿ error: ${event.resultText}\n`);
            break;
          case "tool_parse_error":
            process.stderr.write(`  ⎿ tool parse error: ${event.message}\n`);
            break;
          case "usage":
            if (event.inputTokens > 0 && persist) {
              void persistSessionUsage(session.id, event.inputTokens);
            }
            break;
          case "agent_stop":
            if (event.reason === "max_steps") stopReason = "max_steps";
            if (event.reason === "unreliable_model") {
              stopReason = "unreliable_model";
              isError = true;
            }
            break;
        }
      },
    });
  } catch (err) {
    isError = true;
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      assistantText = assistantText || message;
    } else {
      process.stderr.write(`\n[polyglot] ${message}\n`);
    }
  } finally {
    process.off("SIGINT", onSigint);
    await mcp?.close();
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        result: assistantText,
        session_id: session.id,
        is_error: isError,
        stop_reason: stopReason,
        persisted: persist,
      })}\n`,
    );
  } else {
    if (assistantText && !assistantText.endsWith("\n")) process.stdout.write("\n");
    process.stderr.write(
      persist ? `session: ${session.id}\n` : `session: ${session.id} (ephemeral - not saved)\n`,
    );
  }

  return isError ? 1 : 0;
}
