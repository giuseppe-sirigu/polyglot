import {
  type ApprovalResponse,
  type McpConnectResult,
  type ModelEntry,
  type ModelOption,
  type PermissionMode,
  type PermissionRequest,
  PolicyGate,
  type ProviderAdapter,
  type ResolvedConfig,
  type Session,
  type SessionSummary,
  type UserQuestionRequest,
  addTurnUsage,
  assembleSystemPrompt,
  auditEventFromAgentEvent,
  bashTool,
  buildAgentTools,
  checkForUpdate,
  compactSession,
  createAskUserQuestionTool,
  createAuditSink,
  createExitPlanModeTool,
  createProviderAdapter,
  createSession,
  createWebSearchTool,
  editFileTool,
  emptyUsageTotals,
  findModelOption,
  getAutoUpdatePreference,
  globTool,
  grepTool,
  listModelOptions,
  listSessions,
  loadSession,
  persistMessage,
  persistSessionHeader,
  persistSessionRename,
  persistTurnUsage,
  pruneAuditLogs,
  prunePlans,
  pruneSessions,
  readFileTool,
  resolveEngineConfigForModel,
  runAgentTurn,
  runSelfUpdate,
  sessionContextTokens,
  setAutoUpdatePreference,
  shouldCompact,
  turnUsageFromEvent,
  webFetchTool,
  writeFileTool,
} from "@usepolyglot/core";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt.js";
import { AutoUpdateConsentPrompt } from "./AutoUpdateConsentPrompt.js";
import { HEADER_LINE_COUNT, Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { LiveToolLog } from "./LiveToolLog.js";
import { ModelSelectPrompt } from "./ModelSelectPrompt.js";
import { PlanApprovalPrompt } from "./PlanApprovalPrompt.js";
import { ResumeSessionPrompt } from "./ResumeSessionPrompt.js";
import { Spinner } from "./Spinner.js";
import { StatusBar } from "./StatusBar.js";
import { ThinkingLabel } from "./ThinkingLabel.js";
import { TranscriptGroupView, groupKey } from "./TranscriptGroupView.js";
import { TranscriptLine } from "./TranscriptLine.js";
import { formatCostLine, formatCostReport } from "./costReport.js";
import { renderMarkdown } from "./markdown.js";
import { formatStatusReport } from "./statusReport.js";
import { theme } from "./theme.js";
import { type TranscriptGroup, groupTranscript } from "./toolPairing.js";
import { reconstructTranscript } from "./transcript.js";
import type { DisplayItem, DistributiveOmit, LiveTurnItem, NewDisplayItem } from "./types.js";

type StaticEntry = { kind: "header" } | TranscriptGroup;

interface ActiveModel {
  provider: "anthropic" | "openai-compatible";
  model: string;
  label: string;
}

const MODE_ORDER: PermissionMode[] = ["manual", "auto", "plan"];

export interface AppProps {
  resolved: ResolvedConfig;
  adapter: ProviderAdapter;
  session: Session;
  resumed: boolean;
  mcp: McpConnectResult | null;
  /** One-line result of the startup capability probe (--probe), shown once on mount. */
  probeNote?: string;
}

export function App({
  resolved,
  adapter: initialAdapter,
  session: initialSession,
  resumed,
  mcp,
  probeNote,
}: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const streamFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<PermissionMode>(resolved.permissions.mode);
  // A "Switched to ..." breadcrumb for a permission-mode or model change - see noteSwitch().
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const switchNoticeRef = useRef<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [approvalRequest, setApprovalRequest] = useState<PermissionRequest | null>(null);
  const approvalResolveRef = useRef<((response: ApprovalResponse) => void) | null>(null);
  const [planRequest, setPlanRequest] = useState<string | null>(null);
  const planResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const [questionRequest, setQuestionRequest] = useState<UserQuestionRequest | null>(null);
  const questionResolveRef = useRef<((answers: string[]) => void) | null>(null);
  const [showUpdateConsent, setShowUpdateConsent] = useState(false);
  const updateConsentResolveRef = useRef<((enabled: boolean) => void) | null>(null);
  const [resumeRequest, setResumeRequest] = useState<SessionSummary[] | null>(null);
  const [modelRequest, setModelRequest] = useState<ModelOption[] | null>(null);
  // Messages submitted while a turn is already running queue here instead of being blocked -
  // InputBar stays typable throughout. Backed by a ref (not just the state) so the queue drain
  // in runTurn() always reads the current contents rather than whatever was captured in an
  // older closure.
  const [messageQueue, setMessageQueue] = useState<{ id: string; text: string }[]>([]);
  const messageQueueRef = useRef<{ id: string; text: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Guards drainQueue() against reentrancy: an Esc interrupt kicks off a drain while the aborted
  // turn's promise is still unwinding and will also try to drain once it does - whichever runs
  // first processes the whole queue, the other becomes a no-op.
  const drainingRef = useRef(false);
  const nextId = useRef(0);
  const startedRef = useRef(false);
  const [liveTurnItems, setLiveTurnItems] = useState<LiveTurnItem[]>([]);
  const liveTurnItemsRef = useRef<LiveTurnItem[]>([]);

  // `/model` swaps these; `/reset` swaps `session`. Both start from the initial props but need
  // to be replaceable at runtime, unlike everything else App was constructed with.
  const [session, setSession] = useState<Session>(initialSession);
  const [activeAdapter, setActiveAdapter] = useState<ProviderAdapter>(initialAdapter);
  const [activeModel, setActiveModel] = useState<ActiveModel>({
    provider: resolved.engine.provider,
    model: resolved.engine.model,
    label: resolved.engine.model,
  });

  // `resolved.models` only lists the alternates configured for /model to switch *to* - the
  // model actually running at startup (resolved.engine) is never necessarily one of them. Add
  // it here (unless it's already a configured entry) so /model can always switch back to where
  // the session started, even after switching away - otherwise it silently drops out of the
  // list the moment `activeModel` no longer points at it.
  const modelEntries = useMemo<ModelEntry[]>(() => {
    const startup: ModelEntry = {
      provider: resolved.engine.provider,
      model: resolved.engine.model,
      label: resolved.engine.model,
      baseURL: resolved.engine.baseURL,
      apiKey: resolved.engine.apiKey,
      structuredOutput: resolved.engine.structuredOutput,
    };
    const alreadyListed = resolved.models.some(
      (m) => m.provider === startup.provider && m.model === startup.model,
    );
    return alreadyListed ? resolved.models : [startup, ...resolved.models];
  }, [resolved.engine, resolved.models]);

  function pushItem(item: NewDisplayItem) {
    const id = String(nextId.current++);
    setItems((prev) => [...prev, { ...item, id } as DisplayItem]);
  }

  /** Records a "Switched to ..." line for a Shift+Tab mode cycle or a `/model` change. It's held
   * in the live region rather than pushed straight to the Static transcript (which can't
   * un-print), so flipping modes/models several times in a row just overwrites it - only the
   * latest shows. commitSwitchNotice() moves whatever it settled on into the permanent
   * transcript once some other action happens. */
  function noteSwitch(text: string) {
    switchNoticeRef.current = text;
    setSwitchNotice(text);
  }

  function commitSwitchNotice() {
    if (switchNoticeRef.current === null) return;
    pushItem({ kind: "system", tone: "info", text: switchNoticeRef.current });
    switchNoticeRef.current = null;
    setSwitchNotice(null);
  }

  // Tool calls/results for the round currently in progress: held here (not in `items`, so not
  // yet printed to the permanent Static transcript). Flushed into `items` in order once the
  // round they belong to finishes.
  function pushLiveItem(item: DistributiveOmit<LiveTurnItem, "id">) {
    const id = String(nextId.current++);
    const withId = { ...item, id } as LiveTurnItem;
    liveTurnItemsRef.current = [...liveTurnItemsRef.current, withId];
    setLiveTurnItems(liveTurnItemsRef.current);
  }

  function flushLiveItems() {
    if (liveTurnItemsRef.current.length === 0) return;
    setItems((prev) => [...prev, ...liveTurnItemsRef.current]);
    liveTurnItemsRef.current = [];
    setLiveTurnItems([]);
  }

  function enqueueMessage(text: string) {
    const entry = { id: String(nextId.current++), text };
    messageQueueRef.current = [...messageQueueRef.current, entry];
    setMessageQueue(messageQueueRef.current);
  }

  /** Pops and returns the oldest queued message's text, or undefined if the queue is empty. */
  function dequeueMessage(): string | undefined {
    const [next, ...rest] = messageQueueRef.current;
    messageQueueRef.current = rest;
    setMessageQueue(rest);
    return next?.text;
  }

  function clearMessageQueue() {
    messageQueueRef.current = [];
    setMessageQueue([]);
  }

  // Ink repaints its entire dynamic (non-Static) region on every state change anywhere in the
  // tree, however small - so committing a React state update on every single streamed token
  // (which can arrive many times a second) forces far more full-region terminal redraws than
  // a human can usefully perceive, and shows up as flicker. Batch deltas and flush at most
  // ~16 times/sec instead.
  function scheduleStreamFlush() {
    if (streamFlushTimer.current) return;
    streamFlushTimer.current = setTimeout(() => {
      streamFlushTimer.current = null;
      setStreamingText(streamingRef.current);
    }, 60);
  }

  function cancelStreamFlush() {
    if (streamFlushTimer.current) {
      clearTimeout(streamFlushTimer.current);
      streamFlushTimer.current = null;
    }
  }

  const staticEntries = useMemo<StaticEntry[]>(
    () => [{ kind: "header" }, ...groupTranscript(items)],
    [items],
  );

  const gateRef = useRef<PolicyGate | null>(null);
  if (!gateRef.current) {
    gateRef.current = new PolicyGate({
      mode: resolved.permissions.mode,
      allow: resolved.permissions.allow,
      deny: resolved.permissions.deny,
      onAskUser: (request) =>
        new Promise<ApprovalResponse>((resolve) => {
          approvalResolveRef.current = resolve;
          setApprovalRequest(request);
        }),
    });
  }
  const gate = gateRef.current;

  // Rebuilt whenever the active model changes - this is what keeps the "task" sub-agent tool
  // (which captures `adapter` by closure at construction, in core's buildAgentTools) from
  // silently continuing to spawn sub-agents against a model /model has already switched away
  // from. Rebuilding is cheap (just registering tool objects into a fresh Map), and switching is
  // a deliberate, infrequent action that can only happen while the input bar is enabled (no turn
  // in flight), so this can never race a turn that's using the previous registry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gate is a stable ref-backed singleton and mcp never changes after mount - including them would just force needless rebuilds
  const tools = useMemo(() => {
    const baseTools = [
      readFileTool,
      writeFileTool,
      editFileTool,
      bashTool,
      grepTool,
      globTool,
      webFetchTool,
      createWebSearchTool(resolved.webSearch),
      ...(mcp?.tools ?? []),
    ];
    const built = buildAgentTools({
      baseTools,
      adapter: activeAdapter,
      gate,
      model: activeModel.model,
      cwd: session.cwd,
      // Unset config → on only for models with reliable native tool-calling; a weak model
      // that keeps delegating to itself mostly burns turns.
      subAgents: resolved.subAgents ?? activeAdapter.capabilities.nativeToolCalling === "reliable",
    });
    // Always registered - not gated on the mode the session *started* in - since the user can
    // switch into plan mode later via Shift+Tab, and the model must still be able to call these
    // then. (What gets *advertised* in the system prompt is filtered by the live mode below;
    // the registry itself just needs to never come back "Unknown tool".)
    built.register(
      createExitPlanModeTool(
        gate,
        (plan) =>
          new Promise<boolean>((resolve) => {
            planResolveRef.current = resolve;
            setPlanRequest(plan);
          }),
        "manual",
        resolved.persistTranscripts,
      ),
    );
    built.register(
      createAskUserQuestionTool(
        (request) =>
          new Promise<string[]>((resolve) => {
            questionResolveRef.current = resolve;
            setQuestionRequest(request);
          }),
      ),
    );
    return built;
  }, [activeAdapter, activeModel.model, session.cwd, resolved.subAgents]);

  const systemPrompt = useMemo(
    () =>
      assembleSystemPrompt({
        tools: tools.list(),
        cwd: session.cwd,
        mode,
        structured: activeAdapter.capabilities.structuredOutput,
      }),
    [tools, session.cwd, mode, activeAdapter.capabilities.structuredOutput],
  );

  // One audit sink per session (a fresh file on /reset or /resume). No-op when audit is off.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resolved.audit.* is process-stable; only session.id varies
  const auditSink = useMemo(
    () =>
      createAuditSink({
        enabled: resolved.audit.enabled,
        sessionId: session.id,
        path: resolved.audit.path,
        hashArgs: resolved.audit.hashArgs,
      }),
    [session.id],
  );
  useEffect(() => {
    return () => {
      void auditSink.close();
    };
  }, [auditSink]);

  if (!startedRef.current) {
    startedRef.current = true;
    if (probeNote) {
      pushItem({ kind: "system", tone: "info", text: probeNote });
    }
    if (resumed) {
      pushItem({
        kind: "system",
        tone: "info",
        text: `Resumed session ${session.name ?? session.id} (${session.messages.length} messages)`,
      });
      for (const item of reconstructTranscript(session.messages, tools)) pushItem(item);
    }
    if (mcp) {
      for (const error of mcp.errors) {
        pushItem({
          kind: "system",
          tone: "error",
          text: `MCP server "${error.serverName}" failed to connect: ${error.message}`,
        });
      }
      if (mcp.tools.length > 0) {
        pushItem({
          kind: "system",
          tone: "info",
          text: `Connected ${mcp.tools.length} MCP tool(s) from: ${Object.keys(resolved.mcpServers).join(", ")}`,
        });
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: pushItem is stable enough here (setState-only, ref-based id) and this must run exactly once on mount
  useEffect(() => {
    (async () => {
      let autoUpdate = getAutoUpdatePreference();

      if (autoUpdate === undefined) {
        autoUpdate = await new Promise<boolean>((resolve) => {
          updateConsentResolveRef.current = resolve;
          setShowUpdateConsent(true);
        });
        setAutoUpdatePreference(autoUpdate);
        pushItem({
          kind: "system",
          tone: "info",
          text: autoUpdate
            ? "Got it - polyglot will update itself automatically from now on."
            : "Got it - polyglot will only notify you about updates. Change this anytime in ~/.polyglot/settings.json.",
        });
      }

      const result = await checkForUpdate(__PACKAGE_NAME__, __VERSION__);
      if (!result?.updateAvailable) return;

      if (autoUpdate) {
        pushItem({
          kind: "system",
          tone: "info",
          text: `Updating polyglot ${result.currentVersion} -> ${result.latestVersion} in the background…`,
        });
        const update = await runSelfUpdate(__PACKAGE_NAME__);
        pushItem({
          kind: "system",
          tone: update.ok || update.transient ? "info" : "warn",
          text: update.message,
        });
      } else {
        pushItem({
          kind: "system",
          tone: "info",
          text: `A newer version is available: ${result.currentVersion} -> ${result.latestVersion}. Run "npm install -g ${__PACKAGE_NAME__}@latest" to update.`,
        });
      }
    })();
    // run once on startup - intentionally not re-checking on every render
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount; session.id is the initial session's, stable here
  useEffect(() => {
    const days = resolved.retentionDays;
    if (!resolved.persistTranscripts || !days) return;
    (async () => {
      const [sessions, plans, audits] = await Promise.all([
        pruneSessions(days, session.id),
        prunePlans(days),
        pruneAuditLogs(days, { path: resolved.audit.path, exceptId: session.id }),
      ]);
      const total = sessions + plans + audits;
      if (total > 0) {
        pushItem({
          kind: "system",
          tone: "info",
          text: `Pruned ${total} transcript/plan file(s) older than ${days} days (retention policy).`,
        });
      }
    })();
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    const noModal =
      !approvalRequest &&
      !planRequest &&
      !questionRequest &&
      !showUpdateConsent &&
      !resumeRequest &&
      !modelRequest;

    // Esc stops the in-progress turn (model call and/or tool execution) without exiting the
    // app, as long as no modal prompt is currently claiming input focus - those handle Esc
    // themselves (e.g. as "deny"/"reject"). First Esc stops the turn and lets anything queued
    // while it ran run next; a second Esc *while those queued messages are running* (drainingRef)
    // stops that too and drops the rest of the queue.
    if (key.escape && isRunning && noModal) {
      hardStop("Stopped.", { resumeQueue: !drainingRef.current });
      return;
    }

    if (key.tab && key.shift && noModal && !isRunning) {
      const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length] as PermissionMode;
      gate.setMode(next);
      setMode(next);
      noteSwitch(`Switched to ${next} mode`);
    }
  });

  /** Shared by /reset and resuming a session: clears the visible transcript for a fresh one.
   * Ink's <Static> is append-only - it can never un-print what it's already flushed to the
   * terminal, so this also needs an actual terminal clear and a fresh Static instance (forced
   * by keying <Static> off session.id), not just resetting `items` to []. Does NOT touch
   * `session` itself - callers set that afterward, once they know what the new one is. */
  function resetTranscriptUI() {
    if (stdout?.isTTY) {
      stdout.write("\x1b[2J\x1b[3J\x1b[H");
    }
    cancelStreamFlush();
    streamingRef.current = "";
    setStreamingText("");
    liveTurnItemsRef.current = [];
    setLiveTurnItems([]);
    nextId.current = 0;
    setItems([]);
    clearMessageQueue();
    switchNoticeRef.current = null;
    setSwitchNotice(null);
  }

  /** The actual entry point wired to InputBar's onSubmit. Never blocked by isRunning - typing
   * and submitting while a turn is in progress queues the message instead (InputBar stays
   * enabled throughout, see below), so nothing typed is ever silently dropped. */
  async function handleSubmit(raw: string) {
    const value = raw.trim();
    setInputValue("");
    if (!value) return;

    if (isRunning) {
      enqueueMessage(value);
      return;
    }

    await runTurn(value);
  }

  /** Runs one submission to completion, then drains the queue: if anything was typed while it
   * ran, immediately runs the next one the same way, and so on until the queue is empty. This
   * wraps runTurnBody() rather than living inside it because a slash command (most of
   * runTurnBody's branches) returns long before reaching runTurnBody's own end - draining needs
   * to happen after *every* exit path, not just the one a real agent turn takes. */
  async function runTurn(value: string) {
    await runTurnBody(value);
    await drainQueue();
  }

  /** Runs queued messages one at a time, in order, until the queue is empty. Safe to call from
   * more than one place concurrently (see drainingRef) - used both by runTurn() after a normal
   * turn and by hardStop() after an Esc interrupt. */
  async function drainQueue() {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      let next = dequeueMessage();
      while (next !== undefined) {
        await runTurnBody(next);
        next = dequeueMessage();
      }
    } finally {
      drainingRef.current = false;
    }
  }

  async function runTurnBody(value: string) {
    // A real action is happening now, so a pending mode/model breadcrumb is final - commit it
    // to the permanent transcript ahead of this turn's own output.
    commitSwitchNotice();

    if (value === "/exit" || value === "/quit") {
      exit();
      return;
    }

    if (value === "/status") {
      pushItem({ kind: "user", text: value });
      pushItem({
        kind: "system",
        tone: "info",
        text: formatStatusReport({
          provider: activeModel.provider,
          model: activeModel.model,
          baseURL: activeModel.provider === "anthropic" ? undefined : resolved.engine.baseURL,
          permissionMode: mode,
          webSearchProvider: resolved.webSearch.provider,
          webSearchBaseURL: resolved.webSearch.baseURL,
          webSearchHasKey: Boolean(resolved.webSearch.apiKey),
          transcriptPath: resolved.persistTranscripts
            ? `~/.polyglot/sessions/${session.id}.jsonl`
            : null,
          retentionDays: resolved.retentionDays,
          autoUpdate: getAutoUpdatePreference(),
          mcpServers: Object.keys(resolved.mcpServers),
          sessionId: session.id,
          messageCount: session.messages.length,
          contextUsedPercent,
          cost: formatCostLine(session.usage, anyPricing),
          cwd: session.cwd,
        }),
      });
      return;
    }

    if (value === "/cost") {
      pushItem({ kind: "user", text: value });
      pushItem({
        kind: "system",
        tone: "info",
        text: formatCostReport(session.usage, { anyPricing }),
      });
      return;
    }

    if (value === "/compact") {
      pushItem({ kind: "user", text: value });
      const { before, after } = await compactSession(session, activeAdapter);
      pushItem({
        kind: "system",
        tone: "info",
        text: `Compacted session: ~${before} -> ~${after} tokens`,
      });
      return;
    }

    if (value === "/reset" || value === "/newsession") {
      const newSession = createSession({
        cwd: session.cwd,
        provider: activeModel.provider,
        model: activeModel.model,
      });
      if (resolved.persistTranscripts) await persistSessionHeader(newSession);
      resetTranscriptUI();
      setSession(newSession);
      pushItem({ kind: "system", tone: "info", text: `Started a new session (${newSession.id}).` });
      return;
    }

    if (value === "/rename" || value.startsWith("/rename ")) {
      pushItem({ kind: "user", text: value });
      const newName = value === "/rename" ? "" : value.slice("/rename ".length).trim();
      if (!newName) {
        pushItem({ kind: "system", tone: "error", text: "Usage: /rename <name>" });
        return;
      }
      session.name = newName;
      if (resolved.persistTranscripts) await persistSessionRename(session.id, newName);
      pushItem({ kind: "system", tone: "info", text: `Renamed session to "${newName}".` });
      return;
    }

    if (value === "/resume") {
      pushItem({ kind: "user", text: value });
      const all = await listSessions();
      // Most-recently-updated first (listSessions()'s own sort), current session excluded, and
      // capped so the picker never has to scroll - a long tail of very old sessions is rarely
      // what you meant by "resume a previous one".
      const others = all.filter((s) => s.id !== session.id).slice(0, 15);
      if (others.length === 0) {
        pushItem({ kind: "system", tone: "info", text: "No other sessions to resume." });
        return;
      }
      setResumeRequest(others);
      return;
    }

    if (value === "/model" || value.startsWith("/model ")) {
      pushItem({ kind: "user", text: value });
      const options = listModelOptions(activeModel, modelEntries);
      const query = value === "/model" ? "" : value.slice("/model ".length).trim();

      if (!query) {
        setModelRequest(options);
        return;
      }

      const match = findModelOption(query, options);
      if (!match) {
        pushItem({
          kind: "system",
          tone: "error",
          text: `No model matches "${query}". Available: ${options.map((o) => o.label).join(", ")}.`,
        });
        return;
      }
      switchToModel(match);
      return;
    }

    if (shouldCompact(session, activeAdapter)) {
      const { before, after } = await compactSession(session, activeAdapter);
      pushItem({
        kind: "system",
        tone: "info",
        text: `Context was getting large - compacted automatically: ~${before} -> ~${after} tokens`,
      });
    }

    pushItem({ kind: "user", text: value });
    setIsRunning(true);
    cancelStreamFlush();
    streamingRef.current = "";
    setStreamingText("");

    const controller = new AbortController();
    abortControllerRef.current = controller;
    // Aborting the signal only asks the in-flight work to stop cooperatively - a hung child
    // process or a stream that doesn't check the signal can leave the underlying promise
    // pending forever. hardStop() (Esc, plan rejection) supersedes this controller and resets
    // the UI immediately regardless; every callback below checks isStale() first so that if
    // the old promise does eventually settle, it can't clobber a UI that's already moved on.
    const isStale = () => abortControllerRef.current !== controller;
    try {
      await runAgentTurn({
        session,
        adapter: activeAdapter,
        userInput: value,
        systemPrompt,
        tools,
        gate,
        signal: controller.signal,
        onMessage: resolved.persistTranscripts
          ? (message) => persistMessage(session.id, message)
          : undefined,
        onEvent: (event) => {
          if (isStale()) return;
          const auditEvent = auditEventFromAgentEvent(event, {
            sessionId: session.id,
            model: session.model,
            hashArgs: resolved.audit.hashArgs,
            at: new Date().toISOString(),
          });
          if (auditEvent) auditSink.record(auditEvent);
          if (event.type === "text_delta") {
            streamingRef.current += event.delta;
            scheduleStreamFlush();
          }
          if (event.type === "turn_end" && streamingRef.current) {
            // Flush whatever tool calls happened before this text chunk first, so history
            // stays in chronological order.
            cancelStreamFlush();
            flushLiveItems();
            pushItem({ kind: "assistant", text: streamingRef.current });
            streamingRef.current = "";
            setStreamingText("");
          }
          if (event.type === "tool_call") {
            pushLiveItem({
              kind: "tool_call",
              toolCallId: event.toolCallId,
              name: event.name,
              input: event.input,
              correctedFromName: event.correctedFromName,
            });
          }
          if (event.type === "tool_result") {
            pushLiveItem({
              kind: "tool_result",
              toolCallId: event.toolCallId,
              name: event.name,
              resultText: event.resultText,
              isError: event.isError,
            });
          }
          if (event.type === "tool_parse_error") {
            pushLiveItem({
              kind: "tool_parse_error",
              toolCallId: event.toolCallId,
              message: event.message,
            });
          }
          if (event.type === "usage" && event.inputTokens > 0) {
            // runAgentTurn already updated session.lastContextTokens in memory (drives the
            // status-bar indicator). Accumulate cost + token totals (mutated in place like
            // session.messages - /status, /cost and the status bar read it fresh) and persist
            // the turn so `--resume` restores an accurate figure.
            const turn = turnUsageFromEvent(event, {
              provider: session.provider as "anthropic" | "openai-compatible",
              model: session.model,
              overrides: resolved.pricing,
            });
            session.usage = addTurnUsage(session.usage ?? emptyUsageTotals(), turn);
            if (resolved.persistTranscripts) void persistTurnUsage(session.id, turn);
          }
          if (event.type === "agent_stop" && event.reason === "unreliable_model") {
            pushItem({
              kind: "system",
              tone: "warn",
              text: "This model isn't reliably producing valid tool calls; stopping. Try a larger model.",
            });
          }
          if (event.type === "agent_stop" && event.reason === "max_steps") {
            pushItem({ kind: "system", tone: "warn", text: "Hit the step limit for this turn." });
          }
        },
      });
    } catch (err) {
      // hardStop() already reset the UI and posted its own message - don't also surface the
      // raw (likely AbortError) rejection once the old, now-superseded promise catches up.
      if (!isStale()) {
        pushItem({
          kind: "system",
          tone: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (!isStale()) {
        abortControllerRef.current = null;
        cancelStreamFlush();
        if (streamingRef.current) {
          // Loop stopped (error, max_steps, ...) without a trailing turn_end to flush this.
          flushLiveItems();
          pushItem({ kind: "assistant", text: streamingRef.current });
          streamingRef.current = "";
          setStreamingText("");
        }
        flushLiveItems();
        setIsRunning(false);
      }
    }
  }

  /** Immediately returns the UI to an idle, ready-for-input state - used for both Esc and a
   * rejected plan. Does NOT wait for the in-flight turn to actually acknowledge the abort: a
   * hung child process or a non-cooperative stream could otherwise leave the UI locked forever
   * with no way out. Any state that promise's callbacks would still touch is guarded by
   * isStale() inside handleSubmit, so a late/never-arriving resolution is a safe no-op.
   *
   * With `resumeQueue`, anything queued while the turn ran is kept and drained right after (Esc:
   * stop this turn, then carry on with what I lined up). Without it, the queue is discarded - a
   * rejected plan or a redirect comment supersedes whatever was queued as a reaction to it. */
  function hardStop(message: string, opts?: { resumeQueue?: boolean }) {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelStreamFlush();
    if (streamingRef.current) {
      flushLiveItems();
      pushItem({ kind: "assistant", text: streamingRef.current });
      streamingRef.current = "";
      setStreamingText("");
    } else {
      flushLiveItems();
    }
    setIsRunning(false);

    const queued = messageQueueRef.current.length;
    if (opts?.resumeQueue && queued > 0) {
      const note = ` (running ${queued} queued message${queued === 1 ? "" : "s"} - Esc again to cancel)`;
      pushItem({ kind: "system", tone: "info", text: `${message}${note}` });
      void drainQueue();
      return;
    }

    clearMessageQueue();
    const queueNote =
      queued > 0 ? ` (${queued} queued message${queued === 1 ? "" : "s"} discarded)` : "";
    pushItem({ kind: "system", tone: "info", text: `${message}${queueNote}` });
  }

  /** Used when the user picks "Comment" on an approval/plan prompt instead of a plain yes/no:
   * stops the current turn (same hardStop() every other interruption uses) and immediately
   * starts a fresh one with their comment as the next user message. isRunning is false by the
   * time hardStop() returns, so this handleSubmit() call isn't blocked by its own concurrency
   * guard - it's a genuinely new turn, not a continuation of the interrupted one. */
  function interruptWithComment(text: string) {
    hardStop("Interrupted - sending your comment as the next message.");
    void handleSubmit(text);
  }

  function respondApproval(response: ApprovalResponse) {
    approvalResolveRef.current?.(response);
    approvalResolveRef.current = null;
    setApprovalRequest(null);
  }

  function respondApprovalComment(text: string) {
    approvalResolveRef.current?.("deny");
    approvalResolveRef.current = null;
    setApprovalRequest(null);
    interruptWithComment(text);
  }

  function respondPlan(approved: boolean) {
    planResolveRef.current?.(approved);
    planResolveRef.current = null;
    setPlanRequest(null);
    if (approved) {
      // exit_plan_mode's own execute() calls gate.setMode("manual") on approval - mirror that
      // here so the status bar and the mode-aware system prompt don't stay stuck showing "plan"
      // after the gate has actually moved on.
      setMode("manual");
    } else {
      // Rejecting the plan shouldn't just feed a "not approved" result back to the model and
      // let it keep going on its own - stop the turn here and wait for the user's actual
      // instructions on what to change.
      hardStop("Plan not approved - stopped. Reply with what to change.");
    }
  }

  function respondPlanComment(text: string) {
    planResolveRef.current?.(false);
    planResolveRef.current = null;
    setPlanRequest(null);
    interruptWithComment(text);
  }

  function respondQuestion(answers: string[]) {
    questionResolveRef.current?.(answers);
    questionResolveRef.current = null;
    setQuestionRequest(null);
  }

  function respondUpdateConsent(enabled: boolean) {
    updateConsentResolveRef.current?.(enabled);
    updateConsentResolveRef.current = null;
    setShowUpdateConsent(false);
  }

  async function handleResumeSelect(id: string) {
    setResumeRequest(null);
    const loaded = await loadSession(id);
    if (!loaded) {
      pushItem({ kind: "system", tone: "error", text: `Could not load session ${id}.` });
      return;
    }

    // The loaded session remembers whichever provider/model it was originally created with -
    // try to switch back to a matching configured entry so it actually continues on that model.
    // If none is configured anymore, patch the loaded session's own provider/model to whatever's
    // currently active instead of leaving them pointing at a model we're not actually using -
    // loop.ts sends session.model verbatim to the live adapter, so leaving a stale mismatch there
    // would silently send the wrong model name to whichever adapter ends up active.
    let modelNote = "";
    if (loaded.provider !== activeModel.provider || loaded.model !== activeModel.model) {
      const entry = modelEntries.find(
        (m) => m.provider === loaded.provider && m.model === loaded.model,
      );
      if (entry) {
        try {
          const newAdapter = createProviderAdapter(
            resolveEngineConfigForModel(entry, undefined, {
              structuredOutput: resolved.engine.structuredOutput,
            }),
          );
          const label = entry.label ?? entry.model;
          setActiveAdapter(newAdapter);
          setActiveModel({ provider: entry.provider, model: entry.model, label });
        } catch (err) {
          modelNote = ` - it was originally on ${loaded.provider}/${loaded.model}; switching back failed (${err instanceof Error ? err.message : String(err)}), continuing on ${activeModel.label} instead`;
          loaded.provider = activeModel.provider;
          loaded.model = activeModel.model;
        }
      } else {
        modelNote = ` - it was originally on ${loaded.provider}/${loaded.model}, which isn't currently configured, so continuing on ${activeModel.label} instead`;
        loaded.provider = activeModel.provider;
        loaded.model = activeModel.model;
      }
    }

    resetTranscriptUI();
    setSession(loaded);
    const label = loaded.name ?? loaded.id.slice(0, 8);
    pushItem({
      kind: "system",
      tone: "info",
      text: `Resumed session ${label} (${loaded.messages.length} messages)${modelNote}.`,
    });
    for (const item of reconstructTranscript(loaded.messages, tools)) pushItem(item);
  }

  function handleResumeCancel() {
    setResumeRequest(null);
  }

  function switchToModel(match: ModelOption) {
    if (match.isCurrent || !match.entry) {
      noteSwitch(`Already on ${match.label}.`);
      return;
    }
    const entry: ModelEntry = match.entry;
    try {
      const newAdapter = createProviderAdapter(
        resolveEngineConfigForModel(entry, undefined, {
          structuredOutput: resolved.engine.structuredOutput,
        }),
      );
      session.model = match.model;
      session.provider = match.provider;
      setActiveAdapter(newAdapter);
      setActiveModel({ provider: match.provider, model: match.model, label: match.label });
      noteSwitch(`Switched to ${match.label}.`);
    } catch (err) {
      pushItem({
        kind: "system",
        tone: "error",
        text: `Could not switch to ${match.label}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  function handleModelSelect(option: ModelOption) {
    setModelRequest(null);
    switchToModel(option);
  }

  function handleModelCancel() {
    setModelRequest(null);
  }

  // Only anchor the input to the bottom of a fresh, empty terminal (like Claude Code's welcome
  // screen) - once any transcript content exists, Static output is no longer accounted for in
  // Ink's own layout height, so keeping this on would make the "filled" area grow unbounded
  // and push the transcript off-screen.
  const fillHeight =
    items.length === 0 && stdout?.rows
      ? Math.max(0, stdout.rows - HEADER_LINE_COUNT - 1)
      : undefined;

  // Prefers the provider-measured input-token count from the last turn (set on `session` by
  // runAgentTurn, and mutated in place like `session.messages` - a memo keyed on it wouldn't
  // reliably invalidate, and it's cheap to recompute every render anyway), falling back to the
  // char-heuristic estimate before the first turn and right after compaction.
  const maxContextTokens = activeAdapter.capabilities.maxContextTokens;
  const contextUsedPercent =
    maxContextTokens > 0
      ? Math.min(100, Math.round((sessionContextTokens(session) / maxContextTokens) * 100))
      : undefined;

  // Whether a cost estimate is meaningful at all: an anthropic model has built-in prices, and
  // a `pricing` override can price any (e.g. local) model.
  const anyPricing =
    activeModel.provider === "anthropic" || Object.keys(resolved.pricing).length > 0;

  return (
    <Box flexDirection="column" minHeight={fillHeight}>
      <Static key={session.id} items={staticEntries}>
        {(entry) =>
          entry.kind === "header" ? (
            <Header
              key="__header__"
              provider={activeModel.provider}
              model={activeModel.model}
              sessionId={session.id}
              version={__VERSION__}
              cwd={session.cwd}
            />
          ) : (
            <TranscriptGroupView key={groupKey(entry)} group={entry} />
          )
        }
      </Static>

      {switchNotice !== null ? (
        <TranscriptLine
          item={{ kind: "system", tone: "info", id: "__switch_notice__", text: switchNotice }}
        />
      ) : null}

      {streamingText ? <Box marginTop={1}>{renderMarkdown(streamingText)}</Box> : null}

      <LiveToolLog items={liveTurnItems} />

      {/* The thinking indicator stays pinned below the live turn's output (streamed text and
          tool calls) so freshly added lines never push it out of view. */}
      {isRunning ? (
        <Box marginTop={1}>
          <Spinner />
          <ThinkingLabel />
        </Box>
      ) : null}

      {messageQueue.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {messageQueue.map((q) => (
            <Text key={q.id} dimColor>
              ⏸ {q.text.length > 100 ? `${q.text.slice(0, 100)}…` : q.text}
            </Text>
          ))}
        </Box>
      ) : null}

      {fillHeight !== undefined ? <Box flexGrow={1} /> : null}

      {approvalRequest ? (
        <ApprovalPrompt
          request={approvalRequest}
          onRespond={respondApproval}
          onComment={respondApprovalComment}
        />
      ) : planRequest ? (
        <PlanApprovalPrompt
          plan={planRequest}
          onRespond={respondPlan}
          onComment={respondPlanComment}
        />
      ) : questionRequest ? (
        <AskUserQuestionPrompt request={questionRequest} onRespond={respondQuestion} />
      ) : showUpdateConsent ? (
        <AutoUpdateConsentPrompt onRespond={respondUpdateConsent} />
      ) : resumeRequest ? (
        <ResumeSessionPrompt
          sessions={resumeRequest}
          onSelect={handleResumeSelect}
          onCancel={handleResumeCancel}
        />
      ) : modelRequest ? (
        <ModelSelectPrompt
          options={modelRequest}
          onSelect={handleModelSelect}
          onCancel={handleModelCancel}
        />
      ) : (
        <InputBar
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          disabled={isRunning}
          queuedCount={messageQueue.length}
        />
      )}

      <StatusBar
        mode={mode}
        model={activeModel.label}
        contextUsedPercent={contextUsedPercent}
        sessionCostUSD={session.usage?.costUSD}
        sessionLabel={session.name}
      />
    </Box>
  );
}
