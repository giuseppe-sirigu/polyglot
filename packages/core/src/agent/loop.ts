import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { Message, Session } from "../session/types.js";
import { finalize, resolveEnvelope } from "../tool-protocol/resolve.js";
import { ToolCallStreamParser } from "../tool-protocol/stream-parser.js";
import {
  buildEnvelopeSchema,
  parseStructuredEnvelope,
} from "../tool-protocol/structured-schema.js";
import type {
  ParsedToolCall,
  RawToolCallEnvelope,
  ToolCallParseError,
} from "../tool-protocol/types.js";
import type { ToolRegistry } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { executeToolCall } from "./executor.js";

/** A model to fall back to when the active one fails mid-turn. The caller pre-resolves the
 * model and hands over a thunk for the adapter (built lazily / memoized so a chain that never
 * fires costs nothing). */
export interface FailoverModel {
  model: string;
  provider: string;
  label?: string;
  getAdapter: () => ProviderAdapter | Promise<ProviderAdapter>;
  /** Rebuilds the system prompt for this model's tool-call protocol - only needed when it
   * differs from the primary's (structured vs free-text). Falls back to
   * `RunAgentTurnOptions.buildSystemPrompt`, then the original `systemPrompt` string. */
  buildSystemPrompt?: (ctx: { structured: boolean }) => string;
}

export interface RunAgentTurnOptions {
  session: Session;
  adapter: ProviderAdapter;
  userInput: string;
  systemPrompt: string;
  tools: ToolRegistry;
  gate: PermissionGate;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onMessage?: (message: Message) => void | Promise<void>;
  maxSteps?: number;
  maxConsecutiveParseFailures?: number;
  /** Cap on `task` sub-agent spawns for this whole user turn (across all steps). Extra `task`
   * calls return an error result instead of spawning - bounds cost when a model loops on
   * delegation. */
  maxSubAgentSpawns?: number;
  /** Ordered fallback models. On a provider error or a give-up (`unreliable_model`) mid-turn,
   * the turn continues on the next one - sticky: `session.model` / `session.provider` are
   * updated so all downstream attribution follows. Each model is tried at most once per turn. */
  failover?: FailoverModel[];
  /** Rebuilds the system prompt after a failover, for the new model's tool-call protocol. */
  buildSystemPrompt?: (ctx: { structured: boolean }) => string;
}

const DEFAULT_MAX_STEPS = 25;
const DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES = 2;
const DEFAULT_MAX_SUBAGENT_SPAWNS = 3;

async function pushMessage(
  session: Session,
  role: Message["role"],
  content: string,
  onMessage?: (message: Message) => void | Promise<void>,
): Promise<void> {
  const message: Message = { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
  session.messages.push(message);
  await onMessage?.(message);
}

function extractEnvelopes(text: string): RawToolCallEnvelope[] {
  const parser = new ToolCallStreamParser();
  const events = [...parser.push(text), ...parser.flush()];
  return events
    .filter((e) => e.type === "envelope")
    .map((e) => (e as { envelope: RawToolCallEnvelope }).envelope);
}

function formatToolResultBlock(name: string, resultText: string, isError: boolean): string {
  const attr = isError ? ' status="error"' : "";
  return `<tool_result name="${name}"${attr}>\n${resultText}\n</tool_result>`;
}

/**
 * Runs one user turn to completion. Because tool use is text-parsed rather than
 * relying on native function-calling, a single user turn may drive several model
 * calls in a row (model responds with a tool call -> we execute it -> feed the
 * result back -> model responds again), so this loops internally until the model
 * produces a turn with no tool calls, or a limit is hit.
 */
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<void> {
  const {
    session,
    adapter,
    userInput,
    systemPrompt,
    tools,
    gate,
    signal,
    onEvent,
    onMessage,
    maxSteps = DEFAULT_MAX_STEPS,
    maxConsecutiveParseFailures = DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES,
    maxSubAgentSpawns = DEFAULT_MAX_SUBAGENT_SPAWNS,
  } = opts;

  await pushMessage(session, "user", userInput, onMessage);

  let consecutiveParseFailures = 0;
  let subAgentSpawns = 0;

  // Which model is actually running this turn. Starts as the caller's; a failover swaps the
  // adapter + system prompt here and rewrites `session.model` / `session.provider` (sticky) so
  // usage / reliability accounting - which key off the session - stay correct with no change to
  // the event contract.
  let activeAdapter = adapter;
  let activeSystemPrompt = systemPrompt;
  const failoverChain = [...(opts.failover ?? [])];

  /** Swaps to the next failover model, if any. Returns whether it did. The caller then
   * `step--; continue`s so the swap doesn't burn a step. */
  async function failover(reason: "error" | "unreliable_model", detail?: string): Promise<boolean> {
    const next = failoverChain.shift();
    if (!next) return false;
    // Drop the failed model's just-pushed completion so it can't prime the fallback to imitate
    // its broken output. A no-op at the sites where nothing was pushed this step yet.
    if (session.messages.at(-1)?.role === "assistant") session.messages.pop();
    onEvent({
      type: "model_fell_back",
      from: session.model,
      to: next.model,
      reason,
      ...(detail ? { detail } : {}),
    });
    activeAdapter = await next.getAdapter();
    session.model = next.model;
    session.provider = next.provider;
    activeSystemPrompt =
      (next.buildSystemPrompt ?? opts.buildSystemPrompt)?.({
        structured: activeAdapter.capabilities.structuredOutput,
      }) ?? activeSystemPrompt;
    consecutiveParseFailures = 0;
    return true;
  }

  for (let step = 0; step < maxSteps; step++) {
    onEvent({ type: "turn_start" });

    const chatMessages = [
      { role: "system" as const, content: activeSystemPrompt },
      ...session.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Structured mode is decided once per adapter (see providers/registry.ts) and asks the
    // provider to grammar-constrain the whole completion to our envelope schema, so malformed
    // tool-call syntax becomes structurally impossible rather than best-effort tolerated. The
    // free-text tag protocol (ToolCallStreamParser) stays the default/fallback for providers
    // that don't support it.
    const structured = activeAdapter.capabilities.structuredOutput;
    const responseSchema = structured ? buildEnvelopeSchema(tools.list()) : undefined;

    let fullText = "";
    let stopReason: "end_turn" | "max_tokens" | "error" = "end_turn";
    const liveParser = new ToolCallStreamParser();

    try {
      for await (const event of activeAdapter.chat(
        { model: session.model, messages: chatMessages, responseSchema },
        { signal },
      )) {
        if (event.type === "text_delta") {
          fullText += event.delta;
          // Structured mode buffers the whole response - the completion is one JSON object,
          // so there's nothing human-readable to reveal incrementally; it's parsed and shown
          // as a single unit once the stream ends (see the `structured` branch below).
          if (!structured) {
            for (const parserEvent of liveParser.push(event.delta)) {
              if (parserEvent.type === "text") {
                onEvent({ type: "text_delta", delta: parserEvent.text });
              }
            }
          }
        }
        if (event.type === "message_stop") {
          stopReason = event.stopReason;
        }
        if (event.type === "usage") {
          onEvent({
            type: "usage",
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            ...(event.cachedInputTokens !== undefined
              ? { cachedInputTokens: event.cachedInputTokens }
              : {}),
          });
          // Providers may emit an interim usage with inputTokens: 0 before the final one - only
          // the real prompt-size count is worth recording as the session's context size.
          if (event.inputTokens > 0) {
            session.lastContextTokens = event.inputTokens;
          }
        }
      }
    } catch (err) {
      onEvent({ type: "turn_end", stopReason: "error" });
      // A provider error (5xx, timeout, auth) - not an abort - falls over to the next model.
      if (!signal.aborted && err instanceof Error && (await failover("error", err.message))) {
        step--;
        continue;
      }
      if (structured && err instanceof Error) {
        throw new Error(
          `Structured-output request failed (the backend may not support response_format/json_schema): ${err.message}`,
        );
      }
      throw err;
    }

    if (!structured) {
      for (const parserEvent of liveParser.flush()) {
        if (parserEvent.type === "text") onEvent({ type: "text_delta", delta: parserEvent.text });
      }
    }

    let resolutions: (ParsedToolCall | ToolCallParseError)[];

    if (structured) {
      const parsed = parseStructuredEnvelope(fullText);
      if (!parsed.ok) {
        onEvent({ type: "turn_end", stopReason });
        // Try a failover model before giving up (fullText isn't in history yet, so the malformed
        // JSON never reaches the fallback).
        if (await failover("unreliable_model", parsed.error)) {
          step--;
          continue;
        }
        onEvent({
          type: "tool_parse_error",
          toolCallId: crypto.randomUUID(),
          attemptedName: null,
          message: `This model's backend does not appear to be honoring structured-output constraints (response_format/json_schema): ${parsed.error}. If this keeps happening, disable "structuredOutput" in your config and fall back to free-text tool calling.`,
        });
        onEvent({ type: "agent_stop", reason: "unreliable_model" });
        await pushMessage(session, "assistant", fullText, onMessage);
        return;
      }
      // Re-validated against each tool's schema via finalize() even though the schema was
      // supposedly enforced during generation: grammar generation on some backends only
      // enforces JSON *shape* and may silently ignore deeper schema keywords (pattern, enum,
      // nested oneOf) that don't translate to a token grammar - the server accepting the
      // schema isn't the same guarantee as the arguments being fully valid.
      resolutions = parsed.value.tool_calls.map((call) =>
        finalize({ raw: JSON.stringify(call) }, call.name, call.arguments, tools),
      );
      if (parsed.value.message) onEvent({ type: "text_delta", delta: parsed.value.message });
    } else {
      const envelopes = extractEnvelopes(fullText);
      resolutions = envelopes.map((envelope) => resolveEnvelope(envelope, tools));
    }

    onEvent({ type: "turn_end", stopReason });
    // Persist the full raw completion, not just the human-facing "message" text in structured
    // mode - this mirrors free-text mode, where the <tool_call> tags are naturally part of the
    // persisted text too. Dropping the model's own tool_calls from history here was the actual
    // bug: on a later turn the model had no memory of e.g. its own already-approved plan call,
    // and (correctly, given what it could see) concluded nothing had been approved yet.
    await pushMessage(session, "assistant", fullText, onMessage);

    if (resolutions.length === 0) {
      // No tool call this step. Normally that means the model is finished - but if it was
      // mid-recovery from parse errors (consecutiveParseFailures > 0) and just bailed to prose
      // ("can you extract the code and paste it yourself"), that's a give-up, not a completion.
      if (consecutiveParseFailures > 0) {
        if (await failover("unreliable_model")) {
          step--;
          continue;
        }
        onEvent({ type: "agent_stop", reason: "unreliable_model" });
        return;
      }
      onEvent({ type: "agent_stop", reason: "done" });
      return;
    }

    // Each resolution gets a stable id up front so the tool_call event and its
    // result/permission/parse-error events can be correlated by the consumer (a ParsedToolCall
    // already has one from resolve.ts; a parse error needs a fresh one).
    const withId = resolutions.map((resolved) => ({
      resolved,
      toolCallId: "message" in resolved ? crypto.randomUUID() : resolved.id,
    }));

    // All calls in one turn were decided by the model before seeing any of their
    // results, so there's no ordering dependency between them - run them concurrently
    // (this is also what makes multiple "task" sub-agent calls in one turn parallel).
    for (const { resolved, toolCallId } of withId) {
      if ("message" in resolved) {
        onEvent({
          type: "tool_parse_error",
          toolCallId,
          attemptedName: resolved.attemptedName,
          message: resolved.message,
        });
      } else {
        onEvent({
          type: "tool_call",
          toolCallId,
          name: resolved.name,
          input: resolved.input,
          correctedFromName: resolved.correctedFromName,
          ...(resolved.repaired ? { repaired: true, rawCall: resolved.raw } : {}),
        });
      }
    }

    const outcomes = await Promise.all(
      withId.map(({ resolved, toolCallId }) => {
        if ("message" in resolved) {
          return Promise.resolve({
            resultBlock: formatToolResultBlock(
              resolved.attemptedName ?? "unknown",
              resolved.message,
              true,
            ),
            progressed: false,
          });
        }
        if (resolved.name === "task") {
          if (subAgentSpawns >= maxSubAgentSpawns) {
            const message = `Sub-agent budget for this turn is exhausted (${subAgentSpawns} spawned). Do the remaining work directly with read_file / edit_file / bash instead of delegating.`;
            onEvent({
              type: "permission_decision",
              toolCallId,
              toolName: "task",
              decision: "deny",
              reason: "sub-agent turn budget exhausted",
            });
            onEvent({
              type: "tool_result",
              toolCallId,
              name: "task",
              resultText: message,
              isError: true,
            });
            return Promise.resolve({
              resultBlock: formatToolResultBlock("task", message, true),
              progressed: false,
            });
          }
          subAgentSpawns += 1;
        }
        return executeToolCall(resolved, tools, gate, {
          cwd: session.cwd,
          sessionId: session.id,
          signal,
        }).then((executed) => {
          onEvent({
            type: "permission_decision",
            toolCallId,
            toolName: executed.toolName,
            decision: executed.permission.decision,
            reason: executed.permission.reason,
          });
          onEvent({
            type: "tool_result",
            toolCallId,
            name: executed.toolName,
            resultText: executed.resultText,
            isError: executed.isError,
          });
          return {
            resultBlock: formatToolResultBlock(
              executed.toolName,
              executed.resultText,
              executed.isError,
            ),
            // A denied call, a tool that threw, and a tool's own error result all count as
            // "not progress" - a step that only produces those alongside parse errors is the
            // model spinning, not working.
            progressed: !executed.isError,
          };
        });
      }),
    );

    const resultBlocks = outcomes.map((o) => o.resultBlock);
    const madeProgress = outcomes.some((o) => o.progressed);
    const hadParseError = resolutions.some((r) => "message" in r);

    // Give up on a model that keeps emitting unparseable tool calls without landing a single
    // real one. Any genuine progress resets the count. Known gap: one always-succeeding call
    // (e.g. a repeated read_file) alongside a broken one every step still resets it and the
    // turn grinds to maxSteps - catching that needs goal-progress awareness we don't have.
    if (madeProgress) {
      consecutiveParseFailures = 0;
    } else if (hadParseError) {
      consecutiveParseFailures += 1;
    }
    if (consecutiveParseFailures > maxConsecutiveParseFailures) {
      if (await failover("unreliable_model")) {
        step--;
        continue;
      }
      onEvent({ type: "agent_stop", reason: "unreliable_model" });
      return;
    }

    await pushMessage(session, "user", resultBlocks.join("\n\n"), onMessage);
  }

  onEvent({ type: "agent_stop", reason: "max_steps" });
}
