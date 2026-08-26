import {
  type ApprovalResponse,
  type McpConnectResult,
  type PermissionMode,
  type PermissionRequest,
  PolicyGate,
  type ProviderAdapter,
  type ResolvedConfig,
  type Session,
  type UserQuestionRequest,
  bashTool,
  buildAgentTools,
  buildToolSystemPrompt,
  checkForUpdate,
  compactSession,
  createAskUserQuestionTool,
  createExitPlanModeTool,
  editFileTool,
  getAutoUpdatePreference,
  globTool,
  grepTool,
  persistMessage,
  readFileTool,
  runAgentTurn,
  runSelfUpdate,
  setAutoUpdatePreference,
  shouldCompact,
  webFetchTool,
  writeFileTool,
} from "@polyglot/core";
import { Box, Static, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt.js";
import { AutoUpdateConsentPrompt } from "./AutoUpdateConsentPrompt.js";
import { Header } from "./Header.js";
import { InputBar } from "./InputBar.js";
import { PlanApprovalPrompt } from "./PlanApprovalPrompt.js";
import { StatusBar } from "./StatusBar.js";
import { TranscriptLine } from "./TranscriptLine.js";
import { renderMarkdown } from "./markdown.js";
import { theme } from "./theme.js";
import type { DisplayItem, NewDisplayItem } from "./types.js";

type StaticEntry = { kind: "header" } | DisplayItem;

const PERSONA =
  "You are polyglot, a concise coding assistant that works the same way regardless of which model is answering.";

const MODE_ORDER: PermissionMode[] = ["manual", "auto", "plan"];

export interface AppProps {
  resolved: ResolvedConfig;
  adapter: ProviderAdapter;
  session: Session;
  resumed: boolean;
  mcp: McpConnectResult | null;
}

export function App({ resolved, adapter, session, resumed, mcp }: AppProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<PermissionMode>(resolved.permissions.mode);
  const [inputValue, setInputValue] = useState("");
  const [approvalRequest, setApprovalRequest] = useState<PermissionRequest | null>(null);
  const approvalResolveRef = useRef<((response: ApprovalResponse) => void) | null>(null);
  const [planRequest, setPlanRequest] = useState<string | null>(null);
  const planResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const [questionRequest, setQuestionRequest] = useState<UserQuestionRequest | null>(null);
  const questionResolveRef = useRef<((answers: string[]) => void) | null>(null);
  const [showUpdateConsent, setShowUpdateConsent] = useState(false);
  const updateConsentResolveRef = useRef<((enabled: boolean) => void) | null>(null);
  const nextId = useRef(0);
  const startedRef = useRef(false);

  function pushItem(item: NewDisplayItem) {
    const id = String(nextId.current++);
    setItems((prev) => [...prev, { ...item, id } as DisplayItem]);
  }

  const staticEntries = useMemo<StaticEntry[]>(() => [{ kind: "header" }, ...items], [items]);

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

  const toolsRef = useRef<ReturnType<typeof buildAgentTools> | null>(null);
  if (!toolsRef.current) {
    const baseTools = [
      readFileTool,
      writeFileTool,
      editFileTool,
      bashTool,
      grepTool,
      globTool,
      webFetchTool,
      ...(mcp?.tools ?? []),
    ];
    const tools = buildAgentTools({
      baseTools,
      adapter,
      gate,
      model: resolved.engine.model,
      cwd: session.cwd,
    });
    if (resolved.permissions.mode === "plan") {
      tools.register(
        createExitPlanModeTool(
          gate,
          (plan) =>
            new Promise<boolean>((resolve) => {
              planResolveRef.current = resolve;
              setPlanRequest(plan);
            }),
          "manual",
        ),
      );
      tools.register(
        createAskUserQuestionTool(
          (request) =>
            new Promise<string[]>((resolve) => {
              questionResolveRef.current = resolve;
              setQuestionRequest(request);
            }),
        ),
      );
    }
    toolsRef.current = tools;
  }
  const tools = toolsRef.current;

  const systemPrompt = useMemo(
    () => `${PERSONA}\n\n${buildToolSystemPrompt(tools.list(), session.cwd)}`,
    [tools, session.cwd],
  );

  if (!startedRef.current) {
    startedRef.current = true;
    if (resumed) {
      pushItem({
        kind: "system",
        tone: "info",
        text: `Resumed session ${session.id} (${session.messages.length} messages)`,
      });
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
            ? "Got it — polyglot will update itself automatically from now on."
            : "Got it — polyglot will only notify you about updates. Change this anytime in ~/.polyglot/settings.json.",
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
        pushItem({ kind: "system", tone: update.ok ? "info" : "warn", text: update.message });
      } else {
        pushItem({
          kind: "system",
          tone: "info",
          text: `A newer version is available: ${result.currentVersion} -> ${result.latestVersion}. Run "npm install -g ${__PACKAGE_NAME__}@latest" to update.`,
        });
      }
    })();
    // run once on startup — intentionally not re-checking on every render
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (
      key.tab &&
      key.shift &&
      !approvalRequest &&
      !planRequest &&
      !questionRequest &&
      !showUpdateConsent &&
      !isRunning
    ) {
      const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length] as PermissionMode;
      gate.setMode(next);
      setMode(next);
      pushItem({ kind: "system", tone: "info", text: `Switched to ${next} mode` });
    }
  });

  async function handleSubmit(raw: string) {
    const value = raw.trim();
    setInputValue("");
    if (!value || isRunning) return;

    if (value === "/exit" || value === "/quit") {
      exit();
      return;
    }

    if (value === "/compact") {
      pushItem({ kind: "user", text: value });
      const { before, after } = await compactSession(session, adapter);
      pushItem({
        kind: "system",
        tone: "info",
        text: `Compacted session: ~${before} -> ~${after} tokens`,
      });
      return;
    }

    if (shouldCompact(session, adapter)) {
      const { before, after } = await compactSession(session, adapter);
      pushItem({
        kind: "system",
        tone: "info",
        text: `Context was getting large — compacted automatically: ~${before} -> ~${after} tokens`,
      });
    }

    pushItem({ kind: "user", text: value });
    setIsRunning(true);
    streamingRef.current = "";
    setStreamingText("");

    const controller = new AbortController();
    try {
      await runAgentTurn({
        session,
        adapter,
        userInput: value,
        systemPrompt,
        tools,
        gate,
        signal: controller.signal,
        onMessage: (message) => persistMessage(session.id, message),
        onEvent: (event) => {
          if (event.type === "text_delta") {
            streamingRef.current += event.delta;
            setStreamingText(streamingRef.current);
          }
          if (event.type === "turn_end" && streamingRef.current) {
            pushItem({ kind: "assistant", text: streamingRef.current });
            streamingRef.current = "";
            setStreamingText("");
          }
          if (event.type === "tool_call") {
            pushItem({
              kind: "tool_call",
              name: event.name,
              input: event.input,
              correctedFromName: event.correctedFromName,
            });
          }
          if (event.type === "tool_result") {
            pushItem({
              kind: "tool_result",
              name: event.name,
              resultText: event.resultText,
              isError: event.isError,
            });
          }
          if (event.type === "tool_parse_error") {
            pushItem({ kind: "tool_parse_error", message: event.message });
          }
          if (event.type === "agent_stop" && event.reason === "unreliable_model") {
            pushItem({
              kind: "system",
              tone: "warn",
              text: "This model isn't reliably producing valid tool calls; stopping.",
            });
          }
          if (event.type === "agent_stop" && event.reason === "max_steps") {
            pushItem({ kind: "system", tone: "warn", text: "Hit the step limit for this turn." });
          }
        },
      });
    } catch (err) {
      pushItem({
        kind: "system",
        tone: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsRunning(false);
    }
  }

  function respondApproval(response: ApprovalResponse) {
    approvalResolveRef.current?.(response);
    approvalResolveRef.current = null;
    setApprovalRequest(null);
  }

  function respondPlan(approved: boolean) {
    planResolveRef.current?.(approved);
    planResolveRef.current = null;
    setPlanRequest(null);
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

  return (
    <Box flexDirection="column">
      <Static items={staticEntries}>
        {(entry) =>
          entry.kind === "header" ? (
            <Header
              key="__header__"
              provider={resolved.engine.provider}
              model={resolved.engine.model}
              sessionId={session.id}
              version={__VERSION__}
              cwd={session.cwd}
            />
          ) : (
            <TranscriptLine key={entry.id} item={entry} />
          )
        }
      </Static>

      {streamingText ? <Box marginTop={1}>{renderMarkdown(streamingText)}</Box> : null}
      {isRunning && !streamingText ? (
        <Box marginTop={1}>
          <Text color={theme.dim}>…thinking</Text>
        </Box>
      ) : null}

      {approvalRequest ? (
        <ApprovalPrompt request={approvalRequest} onRespond={respondApproval} />
      ) : planRequest ? (
        <PlanApprovalPrompt plan={planRequest} onRespond={respondPlan} />
      ) : questionRequest ? (
        <AskUserQuestionPrompt request={questionRequest} onRespond={respondQuestion} />
      ) : showUpdateConsent ? (
        <AutoUpdateConsentPrompt onRespond={respondUpdateConsent} />
      ) : (
        <InputBar
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          disabled={isRunning}
        />
      )}

      <StatusBar mode={mode} />
    </Box>
  );
}
