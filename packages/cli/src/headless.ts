import {
  AllowAllGate,
  type McpConnectResult,
  PolicyGate,
  type ResolvedConfig,
  type Session,
  addGiveUp,
  addParseError,
  addToolCall,
  addTurnUsage,
  assembleSystemPrompt,
  auditEventFromAgentEvent,
  bashTool,
  buildAgentTools,
  buildToolSystemPrompt,
  connectAllMcpServers,
  createAskUserQuestionTool,
  createAuditSink,
  createExitPlanModeTool,
  createProviderAdapter,
  createSession,
  createWebSearchTool,
  editFileTool,
  emptyReliabilityTotals,
  emptyUsageTotals,
  expandFileMentions,
  globTool,
  grepTool,
  listSessions,
  loadSession,
  loadSessionFromPath,
  persistMessage,
  persistSessionHeader,
  persistTurnUsage,
  pruneAuditLogs,
  prunePlans,
  pruneSessions,
  readFileTool,
  runAgentTurn,
  turnUsageFromEvent,
  webFetchTool,
  writeFileTool,
} from "@usepolyglot/core";
import { resolveAgentInvocation } from "./agentInvoke.js";
import type { CliArgs } from "./args.js";
import {
  buildFailoverChain,
  configuredModelEntries,
  resolveConfiguredModel,
} from "./modelRouting.js";
import { applyCapabilityProbe } from "./probe.js";

/** Resolves a `--resume` token: a `.jsonl` path loads directly, anything else is a session id
 * (or, when absent, the most recent session). Shared by main.ts and headless.ts. */
export async function resolveResumeTarget(token: string | undefined): Promise<Session | null> {
  if (token && (token.includes("/") || token.endsWith(".jsonl"))) {
    return loadSessionFromPath(token);
  }
  const id = token ?? (await listSessions())[0]?.id;
  return id ? loadSession(id) : null;
}

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

  const { adapter, note: probeNote } = await applyCapabilityProbe(
    createProviderAdapter(resolved.engine),
    resolved,
    { force: args.probe },
  );
  if (probeNote) process.stderr.write(`[polyglot] ${probeNote}\n`);
  const persist = resolved.persistTranscripts;

  let session: Session;
  if (args.resume) {
    const existing = await resolveResumeTarget(args.resumeId);
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
      pruneAuditLogs(resolved.retentionDays, {
        path: resolved.audit.path,
        exceptId: session.id,
      }),
    ]);
  }

  const auditSink = createAuditSink({
    enabled: resolved.audit.enabled,
    sessionId: session.id,
    path: resolved.audit.path,
    hashArgs: resolved.audit.hashArgs,
  });

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

  // Declared here (not with the other turn-locals below) so the sub-agent usage callback wired
  // into buildAgentTools can fold into the same running totals.
  let sessionUsage = session.usage ?? emptyUsageTotals();
  let sessionReliability = session.reliability ?? emptyReliabilityTotals();

  const subAgent = resolved.subAgentModel
    ? resolveConfiguredModel(resolved.subAgentModel, {
        modelEntries: configuredModelEntries(resolved),
        current: {
          adapter,
          provider: resolved.engine.provider,
          model: session.model,
          label: session.model,
        },
        defaults: { structuredOutput: resolved.engine.structuredOutput },
      })
    : null;
  if (resolved.subAgentModel && !subAgent) {
    process.stderr.write(
      `[polyglot] subAgentModel "${resolved.subAgentModel}" isn't a configured model - sub-agents will use the active model.\n`,
    );
  }

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
    subAgents: resolved.subAgents ?? adapter.capabilities.nativeToolCalling === "reliable",
    projectInstructions: resolved.projectInstructions.text,
    agents: resolved.agents,
    ...(subAgent
      ? {
          subAgentAdapter: subAgent.adapter,
          subAgentModel: subAgent.model,
          onSubAgentUsage: (u) => {
            const turn = turnUsageFromEvent(u, {
              provider: subAgent.provider,
              model: subAgent.model,
              overrides: resolved.pricing,
            });
            sessionUsage = addTurnUsage(sessionUsage, turn);
            if (persist) void persistTurnUsage(session.id, turn, { subAgent: true });
          },
        }
      : {}),
  });
  tools.register(
    createAskUserQuestionTool(async () => {
      throw new Error("ask_user_question is unavailable in non-interactive (-p) mode.");
    }),
  );
  if (gate instanceof PolicyGate) {
    tools.register(createExitPlanModeTool(gate, async () => false, "manual", persist));
  }

  const buildSystemPrompt = ({ structured }: { structured: boolean }) =>
    assembleSystemPrompt({
      tools: tools.list(),
      cwd: session.cwd,
      mode,
      structured,
      projectInstructions: resolved.projectInstructions.text,
    });

  const routingCtx = {
    modelEntries: configuredModelEntries(resolved),
    current: {
      adapter,
      provider: resolved.engine.provider,
      model: session.model,
      label: session.model,
    },
    defaults: { structuredOutput: resolved.engine.structuredOutput },
  };

  // Plan-mode runs can route to a dedicated planning model.
  const planRoute =
    mode === "plan" && resolved.routing.planModel
      ? resolveConfiguredModel(resolved.routing.planModel, routingCtx)
      : null;
  const routedPlan = planRoute && planRoute !== routingCtx.current ? planRoute : null;
  if (routedPlan) {
    session.model = routedPlan.model;
    session.provider = routedPlan.provider;
    process.stderr.write(`[polyglot] planning with ${routedPlan.label}\n`);
  }

  const { chain: failoverChain, warnings: failoverWarnings } = buildFailoverChain(
    resolved.routing.failover,
    routingCtx,
  );
  for (const w of failoverWarnings) process.stderr.write(`[polyglot] ${w}\n`);

  // A prompt beginning `@<agent> <task>` runs that agent definition as the turn: its pinned
  // system prompt, tool allowlist, and model.
  const agentInvoke = resolveAgentInvocation(prompt, resolved.agents);
  let turnTools = tools;
  let turnSystemPrompt = buildSystemPrompt({
    structured: (routedPlan ? routedPlan.adapter : adapter).capabilities.structuredOutput,
  });
  let turnAdapter = routedPlan ? routedPlan.adapter : adapter;

  if (agentInvoke) {
    const { agent } = agentInvoke;
    const routed = agent.model ? resolveConfiguredModel(agent.model, routingCtx) : null;
    if (agent.model && !routed) {
      process.stderr.write(
        `[polyglot] agent model "${agent.model}" isn't configured - using ${session.model}\n`,
      );
    }
    turnAdapter = routed?.adapter ?? turnAdapter;
    if (routed) {
      session.model = routed.model;
      session.provider = routed.provider;
    }
    const allow =
      agent.tools ??
      turnTools
        .names()
        .filter((n) => n !== "task" && n !== "exit_plan_mode" && n !== "ask_user_question");
    turnTools = turnTools.subset(allow);
    turnSystemPrompt = `You are the "${agent.name}" agent.\n${agent.prompt}\n\n${buildToolSystemPrompt(
      turnTools.list(),
      cwd,
      undefined,
      { structured: turnAdapter.capabilities.structuredOutput },
    )}`;
    process.stderr.write(`[polyglot] running agent: ${agent.name}\n`);
  }

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  let assistantText = "";
  let stopReason: "done" | "max_steps" | "unreliable_model" = "done";
  let isError = false;
  const fellBackTo: string[] = [];

  // `@file` mentions are inlined the same way the interactive frontend does it.
  const source = agentInvoke ? agentInvoke.rest : prompt;
  const {
    text: turnInput,
    attached,
    skipped,
  } = source.includes("@")
    ? await expandFileMentions(source, cwd)
    : { text: source, attached: [], skipped: [] };
  for (const a of attached) {
    process.stderr.write(`[polyglot] attached ${a.path} (${a.lines} lines)\n`);
  }
  for (const s of skipped) {
    process.stderr.write(`[polyglot] skipped ${s} (secret file - not attached)\n`);
  }

  try {
    await runAgentTurn({
      session,
      adapter: turnAdapter,
      userInput: turnInput,
      systemPrompt: turnSystemPrompt,
      buildSystemPrompt,
      tools: turnTools,
      gate,
      signal: controller.signal,
      failover: agentInvoke ? [] : failoverChain,
      onMessage: persist ? (message) => persistMessage(session.id, message) : undefined,
      onEvent: (event) => {
        const auditEvent = auditEventFromAgentEvent(event, {
          sessionId: session.id,
          model: session.model,
          hashArgs: resolved.audit.hashArgs,
          at: new Date().toISOString(),
        });
        if (auditEvent) auditSink.record(auditEvent);
        switch (event.type) {
          case "text_delta":
            assistantText += event.delta;
            if (!json) process.stdout.write(event.delta);
            break;
          case "tool_call": {
            const summary = summarizeInput(event.input);
            process.stderr.write(`● ${event.name}(${summary})\n`);
            sessionReliability = addToolCall(sessionReliability, {
              model: session.model,
              repaired: !!event.repaired,
              nameCorrected: !!event.correctedFromName,
            });
            break;
          }
          case "tool_result":
            if (event.isError) process.stderr.write(`  ⎿ error: ${event.resultText}\n`);
            break;
          case "tool_parse_error":
            process.stderr.write(`  ⎿ tool parse error: ${event.message}\n`);
            sessionReliability = addParseError(sessionReliability, session.model);
            break;
          case "usage":
            if (event.inputTokens > 0) {
              const turn = turnUsageFromEvent(event, {
                provider: session.provider as "anthropic" | "openai-compatible",
                model: session.model,
                overrides: resolved.pricing,
              });
              sessionUsage = addTurnUsage(sessionUsage, turn);
              if (persist) void persistTurnUsage(session.id, turn);
            }
            break;
          case "agent_stop":
            if (event.reason === "max_steps") stopReason = "max_steps";
            if (event.reason === "unreliable_model") {
              stopReason = "unreliable_model";
              isError = true;
              sessionReliability = addGiveUp(sessionReliability, session.model);
              process.stderr.write(
                "[polyglot] model isn't reliably producing valid tool calls; stopping. Try a larger model.\n",
              );
            }
            break;
          case "model_fell_back":
            fellBackTo.push(event.to);
            process.stderr.write(
              `[polyglot] ${event.from} failed (${event.reason}) - continuing on ${event.to}\n`,
            );
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
    await Promise.all([mcp?.close(), auditSink.close()]);
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        result: assistantText,
        session_id: session.id,
        is_error: isError,
        stop_reason: stopReason,
        persisted: persist,
        cost_usd: sessionUsage.costUSD,
        tokens: { input: sessionUsage.inputTokens, output: sessionUsage.outputTokens },
        reliability: {
          tool_calls: sessionReliability.toolCalls,
          repaired: sessionReliability.repaired,
          parse_errors: sessionReliability.parseErrors,
          gave_up: sessionReliability.gaveUp,
        },
        fell_back_to: fellBackTo,
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
