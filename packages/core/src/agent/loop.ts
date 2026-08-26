import type { PermissionGate } from "../permissions/gate.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { Message, Session } from "../session/types.js";
import { resolveEnvelope } from "../tool-protocol/resolve.js";
import { ToolCallStreamParser } from "../tool-protocol/stream-parser.js";
import type { RawToolCallEnvelope } from "../tool-protocol/types.js";
import type { ToolRegistry } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { executeToolCall } from "./executor.js";

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
}

const DEFAULT_MAX_STEPS = 25;
const DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES = 2;

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
  } = opts;

  await pushMessage(session, "user", userInput, onMessage);

  let consecutiveParseFailures = 0;

  for (let step = 0; step < maxSteps; step++) {
    onEvent({ type: "turn_start" });

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...session.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let fullText = "";
    let stopReason: "end_turn" | "max_tokens" | "error" = "end_turn";
    const liveParser = new ToolCallStreamParser();

    try {
      for await (const event of adapter.chat(
        { model: session.model, messages: chatMessages },
        { signal },
      )) {
        if (event.type === "text_delta") {
          fullText += event.delta;
          for (const parserEvent of liveParser.push(event.delta)) {
            if (parserEvent.type === "text") {
              onEvent({ type: "text_delta", delta: parserEvent.text });
            }
          }
        }
        if (event.type === "message_stop") {
          stopReason = event.stopReason;
        }
      }
    } catch (err) {
      onEvent({ type: "turn_end", stopReason: "error" });
      throw err;
    }

    for (const parserEvent of liveParser.flush()) {
      if (parserEvent.type === "text") onEvent({ type: "text_delta", delta: parserEvent.text });
    }

    onEvent({ type: "turn_end", stopReason });
    await pushMessage(session, "assistant", fullText, onMessage);

    const envelopes = extractEnvelopes(fullText);
    if (envelopes.length === 0) {
      onEvent({ type: "agent_stop", reason: "done" });
      return;
    }

    // All calls in one turn were decided by the model before seeing any of their
    // results, so there's no ordering dependency between them — run them concurrently
    // (this is also what makes multiple "task" sub-agent calls in one turn parallel).
    const resolutions = envelopes.map((envelope) => resolveEnvelope(envelope, tools));

    for (const resolved of resolutions) {
      if ("message" in resolved) {
        onEvent({
          type: "tool_parse_error",
          attemptedName: resolved.attemptedName,
          message: resolved.message,
        });
      } else {
        onEvent({
          type: "tool_call",
          name: resolved.name,
          input: resolved.input,
          correctedFromName: resolved.correctedFromName,
        });
      }
    }

    const outcomes = await Promise.all(
      resolutions.map((resolved) => {
        if ("message" in resolved) {
          return Promise.resolve({
            resultBlock: formatToolResultBlock(
              resolved.attemptedName ?? "unknown",
              resolved.message,
              true,
            ),
            succeeded: false,
          });
        }
        return executeToolCall(resolved, tools, gate, {
          cwd: session.cwd,
          sessionId: session.id,
          signal,
        }).then((executed) => {
          onEvent({
            type: "tool_result",
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
            succeeded: true,
          };
        });
      }),
    );

    const resultBlocks = outcomes.map((o) => o.resultBlock);
    const anySucceeded = outcomes.some((o) => o.succeeded);

    consecutiveParseFailures = anySucceeded ? 0 : consecutiveParseFailures + 1;
    if (consecutiveParseFailures > maxConsecutiveParseFailures) {
      onEvent({ type: "agent_stop", reason: "unreliable_model" });
      return;
    }

    await pushMessage(session, "user", resultBlocks.join("\n\n"), onMessage);
  }

  onEvent({ type: "agent_stop", reason: "max_steps" });
}
