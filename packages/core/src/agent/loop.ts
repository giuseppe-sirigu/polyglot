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

    // Structured mode is decided once per adapter (see providers/registry.ts) and asks the
    // provider to grammar-constrain the whole completion to our envelope schema, so malformed
    // tool-call syntax becomes structurally impossible rather than best-effort tolerated. The
    // free-text tag protocol (ToolCallStreamParser) stays the default/fallback for providers
    // that don't support it.
    const structured = adapter.capabilities.structuredOutput;
    const responseSchema = structured ? buildEnvelopeSchema(tools.list()) : undefined;

    let fullText = "";
    let stopReason: "end_turn" | "max_tokens" | "error" = "end_turn";
    const liveParser = new ToolCallStreamParser();

    try {
      for await (const event of adapter.chat(
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
        onEvent({
          type: "tool_parse_error",
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
      onEvent({ type: "agent_stop", reason: "done" });
      return;
    }

    // All calls in one turn were decided by the model before seeing any of their
    // results, so there's no ordering dependency between them - run them concurrently
    // (this is also what makes multiple "task" sub-agent calls in one turn parallel).
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
