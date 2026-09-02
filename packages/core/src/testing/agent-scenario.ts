import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../agent/events.js";
import { runAgentTurn } from "../agent/loop.js";
import { assembleSystemPrompt } from "../agent/system-prompt.js";
import { AllowAllGate, type PermissionGate } from "../permissions/gate.js";
import type { ChatRequest, ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { type Session, createSession } from "../session/types.js";
import { bashTool } from "../tools/bash.js";
import { buildAgentTools } from "../tools/build-agent-tools.js";
import { editFileTool } from "../tools/edit.js";
import { globTool } from "../tools/glob.js";
import { grepTool } from "../tools/grep.js";
import { readFileTool } from "../tools/read.js";
import type { ToolDefinition } from "../tools/types.js";
import { writeFileTool } from "../tools/write.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The real editing toolset a scenario runs against by default (no network tools). */
export const DEFAULT_SCENARIO_TOOLS: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  grepTool,
  globTool,
];

/**
 * A ProviderAdapter that replays one scripted completion per `chat()` call - a free-text
 * `<tool_call>`-tagged string, or (with `structured: true`) a `{"message","tool_calls"}` JSON
 * envelope string. Running out of scripted turns throws rather than silently ending the run.
 * Sub-agent calls (detected from the system prompt) get a canned "done" reply and don't consume
 * a scripted turn - override with `subAgentReply`.
 */
export function scriptedAdapter(
  turns: string[],
  opts: { structured?: boolean; subAgentReply?: string } = {},
): ProviderAdapter {
  let i = 0;
  const structured = opts.structured ?? false;
  const subReply =
    opts.subAgentReply ?? (structured ? '{"message":"done","tool_calls":[]}' : "done");
  return {
    id: "scripted",
    capabilities: {
      nativeToolCalling: "none",
      maxContextTokens: 100_000,
      structuredOutput: structured,
    },
    async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
      const isSubAgent = (request.messages[0]?.content ?? "").includes("You are a sub-agent");
      const text = isSubAgent ? subReply : turns[i++];
      if (text === undefined) {
        throw new Error(
          `scriptedAdapter: model asked for turn ${i} but only ${turns.length} were scripted`,
        );
      }
      yield { type: "text_delta", delta: text };
      yield { type: "usage", inputTokens: 100 + i, outputTokens: 20 };
      yield { type: "message_stop", stopReason: "end_turn" };
    },
  };
}

/**
 * Wraps an adapter to count `chat()` calls (aborting once `maxCalls` is hit) and record each
 * completion's raw text - the latter is what makes a live-run failure promotable into a
 * scripted fixture.
 */
function withCallBudget(
  adapter: ProviderAdapter,
  maxCalls: number,
  onExceed: () => void,
): ProviderAdapter & { calls: number; completions: string[] } {
  const wrapper = {
    calls: 0,
    completions: [] as string[],
    id: adapter.id,
    capabilities: adapter.capabilities,
    async *chat(
      request: ChatRequest,
      o: { signal: AbortSignal },
    ): AsyncIterable<ProviderStreamEvent> {
      wrapper.calls += 1;
      if (wrapper.calls > maxCalls) {
        onExceed();
        throw new Error(`scenario model-call budget exceeded (${maxCalls})`);
      }
      let text = "";
      for await (const event of adapter.chat(request, o)) {
        if (event.type === "text_delta") text += event.delta;
        yield event;
      }
      wrapper.completions.push(text);
    },
  };
  return wrapper;
}

export interface ScenarioBudget {
  /** Max adapter `chat()` calls before the scenario aborts. Default 40. */
  modelCalls?: number;
  /** Wall-clock ceiling in ms before the scenario aborts. Default 60_000. */
  wallMs?: number;
}

export interface RunScenarioOptions {
  /** Scripted completions (one per step), or a real adapter for live runs. */
  model: string[] | ProviderAdapter;
  /** The model id to send to a real adapter (ignored for scripted runs). Required when `model`
   * is a ProviderAdapter - the adapter forwards it as the provider's `model` param. */
  modelId?: string;
  userInput: string;
  /** Seed the temp working dir from a bundled fixture directory. */
  fixture?: "todo-demo";
  /** Seed explicit files into the temp working dir (path → contents), relative to cwd. */
  files?: Record<string, string>;
  tools?: ToolDefinition[];
  /** Include the `task` sub-agent tool (default: false in scenarios). */
  subAgents?: boolean;
  gate?: PermissionGate;
  /** Free-text vs. structured-envelope scripting; ignored when `model` is a real adapter. */
  structured?: boolean;
  maxSteps?: number;
  budget?: ScenarioBudget;
}

export interface ToolCallRecord {
  toolCallId: string;
  name: string;
  input: unknown;
}
export interface ToolResultRecord {
  toolCallId: string;
  name: string;
  resultText: string;
  isError: boolean;
}

export type ScenarioStopReason = "done" | "max_steps" | "unreliable_model" | undefined;

export interface ScenarioResult {
  events: AgentEvent[];
  session: Session;
  /** The temp working directory (already removed by the time this resolves). */
  cwd: string;
  stopReason: ScenarioStopReason;
  /** Whether a runaway budget (model calls / wall clock) tripped. */
  abortedByBudget: boolean;
  modelCallCount: number;
  /** Raw text of each model completion, in order - a scripted transcript of this exact run. */
  completions: string[];
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  /** Parse errors surfaced to the model (bad tool-call syntax). */
  parseErrors: { toolCallId: string; attemptedName: string | null; message: string }[];
  /** The exact tool-result text fed back to the model after each step. */
  resultsSeenByModel: string[];
  /** Prose the model produced in its final step (post the last tool round). */
  finalAssistantText: string;
  /** Contents of every seeded file at the end (path → contents), captured before cleanup. */
  finalFiles: Record<string, string>;
  countToolCalls(name: string): number;
  readWorkFile(rel: string): string | null;
  workFileChanged(rel: string): boolean;
}

const DEFAULT_BUDGET: Required<ScenarioBudget> = { modelCalls: 40, wallMs: 60_000 };

/**
 * Runs one user turn end-to-end: seeds a real temp working directory, drives `runAgentTurn`
 * with the real tools against it, and returns the events plus the resulting file state and a
 * handful of derived views. Deterministic with `model: string[]`; a canary with a real adapter.
 */
export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioResult> {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const cwd = mkdtempSync(join(tmpdir(), "polyglot-scenario-"));
  const seeded: Record<string, string> = {};

  try {
    if (opts.fixture) {
      cpSync(join(FIXTURES_DIR, opts.fixture), cwd, { recursive: true });
    }
    for (const [rel, contents] of Object.entries(opts.files ?? {})) {
      writeFileSync(join(cwd, rel), contents, "utf8");
    }
    // Snapshot everything that was seeded so workFileChanged() has a baseline.
    const snapshot = (rel: string) => {
      try {
        seeded[rel] = readFileSync(join(cwd, rel), "utf8");
      } catch {
        // not a regular file (dir, missing) - skip
      }
    };
    for (const rel of Object.keys(opts.files ?? {})) snapshot(rel);
    if (opts.fixture === "todo-demo") {
      snapshot("todo.mjs");
      snapshot("todos.json");
    }

    const structured = Array.isArray(opts.model) ? (opts.structured ?? false) : undefined;
    const baseAdapter = Array.isArray(opts.model)
      ? scriptedAdapter(opts.model, { structured })
      : opts.model;

    let abortedByBudget = false;
    const controller = new AbortController();
    const adapter = withCallBudget(baseAdapter, budget.modelCalls, () => {
      abortedByBudget = true;
      controller.abort();
    });

    const model = Array.isArray(opts.model) ? "scripted-model" : (opts.modelId ?? "scenario-model");
    const session = createSession({ cwd, provider: "scenario", model });
    const gate = opts.gate ?? new AllowAllGate();
    const tools = buildAgentTools({
      baseTools: opts.tools ?? DEFAULT_SCENARIO_TOOLS,
      adapter,
      gate,
      model,
      cwd,
      subAgents: opts.subAgents ?? false, // `task` is off in scenarios unless asked for
    });
    const systemPrompt = assembleSystemPrompt({
      tools: tools.list(),
      cwd,
      structured: adapter.capabilities.structuredOutput,
    });

    const events: AgentEvent[] = [];
    let stopReason: ScenarioStopReason;
    let finalTurnText = "";
    const onEvent = (event: AgentEvent) => {
      events.push(event);
      if (event.type === "turn_start") finalTurnText = "";
      if (event.type === "text_delta") finalTurnText += event.delta;
      if (event.type === "agent_stop") stopReason = event.reason;
    };

    const timer = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        abortedByBudget = true;
        controller.abort();
        reject(new Error(`scenario wall-clock budget exceeded (${budget.wallMs}ms)`));
      }, budget.wallMs);
      // don't keep the event loop alive on the timer
      if (typeof t.unref === "function") t.unref();
    });

    try {
      await Promise.race([
        runAgentTurn({
          session,
          adapter,
          userInput: opts.userInput,
          systemPrompt,
          tools,
          gate,
          signal: controller.signal,
          maxSteps: opts.maxSteps,
          onEvent,
        }),
        timer,
      ]);
    } catch (err) {
      if (!abortedByBudget) throw err;
      // budget abort: the partial run is the result we want to inspect
    }

    const finalFiles: Record<string, string> = {};
    for (const rel of new Set([...Object.keys(seeded)])) {
      try {
        finalFiles[rel] = readFileSync(join(cwd, rel), "utf8");
      } catch {
        // deleted
      }
    }

    const toolCalls: ToolCallRecord[] = events
      .filter((e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call")
      .map((e) => ({ toolCallId: e.toolCallId, name: e.name, input: e.input }));
    const toolResults: ToolResultRecord[] = events
      .filter((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result")
      .map((e) => ({
        toolCallId: e.toolCallId,
        name: e.name,
        resultText: e.resultText,
        isError: e.isError,
      }));
    const parseErrors = events
      .filter(
        (e): e is Extract<AgentEvent, { type: "tool_parse_error" }> =>
          e.type === "tool_parse_error",
      )
      .map((e) => ({
        toolCallId: e.toolCallId,
        attemptedName: e.attemptedName,
        message: e.message,
      }));

    const userMessages = session.messages.filter((m) => m.role === "user").map((m) => m.content);
    const resultsSeenByModel = userMessages.slice(1); // drop the initial userInput

    return {
      events,
      session,
      cwd,
      stopReason,
      abortedByBudget,
      modelCallCount: adapter.calls,
      completions: adapter.completions,
      toolCalls,
      toolResults,
      parseErrors,
      resultsSeenByModel,
      finalAssistantText: finalTurnText.trim(),
      finalFiles,
      countToolCalls: (name) => toolCalls.filter((c) => c.name === name).length,
      readWorkFile: (rel) => finalFiles[rel] ?? null,
      workFileChanged: (rel) =>
        rel in seeded ? finalFiles[rel] !== seeded[rel] : rel in finalFiles,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
