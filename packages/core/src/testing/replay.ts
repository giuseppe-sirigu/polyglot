import { parseToolResultBlocks } from "../session/serialize.js";
import type { Session } from "../session/types.js";
import { finalize, resolveEnvelope } from "../tool-protocol/resolve.js";
import { ToolCallStreamParser } from "../tool-protocol/stream-parser.js";
import { parseStructuredEnvelope } from "../tool-protocol/structured-schema.js";
import type { RawToolCallEnvelope } from "../tool-protocol/types.js";
import type { ToolRegistry } from "../tools/types.js";

/**
 * Deterministic, no-execution re-run of a saved session against the *current* tool-call
 * parser / repair pipeline. For every assistant turn it re-resolves the model's verbatim
 * completion exactly the way `agent/loop.ts` does at run time (free-text -> ToolCallStreamParser
 * -> resolveEnvelope; structured -> parseStructuredEnvelope -> finalize) and lines the result up
 * against what the session recorded actually happening (the `<tool_result>` blocks in the
 * following user message). A tool call that now resolves where the transcript shows it didn't -
 * or the reverse - is a `divergence`: the signal that a since-released fix would have helped, or
 * that a parser change regressed.
 */

export interface ReplayCall {
  name: string;
  input: unknown;
  repaired: boolean;
  correctedFromName?: string;
}

export interface ReplayParseError {
  attemptedName: string | null;
  message: string;
}

export interface TurnReplay {
  /** Index among assistant messages (0-based). */
  turnIndex: number;
  /** Index in `session.messages`. */
  messageIndex: number;
  transport: "structured" | "free-text";
  resolvedCalls: ReplayCall[];
  parseErrors: ReplayParseError[];
  /** Tool-result blocks the session recorded after this turn - `[]` for the turn that ended the
   * run (no tool calls) or a genuine trailing user message. */
  recordedResults: { name: string; isError: boolean }[];
}

export interface ReplayReport {
  sessionId: string;
  turns: TurnReplay[];
  /** Human-readable notes where the current pipeline diverges from what the session recorded. */
  divergences: string[];
  summary: {
    turns: number;
    totalCalls: number;
    totalParseErrors: number;
    /** Resolutions that now fail to parse where the session recorded a non-error result. */
    nowFailsWasOk: number;
    /** Resolutions that now resolve cleanly where the session recorded an error result. */
    nowOkWasError: number;
    /** Turns where the number of extracted envelopes no longer matches the recorded count. */
    envelopeCountChanged: number;
  };
}

export interface ReplayOptions {
  /** Force the tool-call transport instead of detecting it per message. */
  structured?: boolean;
}

function extractEnvelopes(text: string): RawToolCallEnvelope[] {
  const parser = new ToolCallStreamParser();
  const events = [...parser.push(text), ...parser.flush()];
  return events
    .filter((e): e is { type: "envelope"; envelope: RawToolCallEnvelope } => e.type === "envelope")
    .map((e) => e.envelope);
}

function replayTurn(
  content: string,
  tools: ToolRegistry,
  opts: ReplayOptions,
): { transport: "structured" | "free-text"; calls: ReplayCall[]; parseErrors: ReplayParseError[] } {
  const structured = opts.structured ?? parseStructuredEnvelope(content).ok;

  const calls: ReplayCall[] = [];
  const parseErrors: ReplayParseError[] = [];

  if (structured) {
    const parsed = parseStructuredEnvelope(content);
    if (!parsed.ok) {
      parseErrors.push({ attemptedName: null, message: parsed.error });
      return { transport: "structured", calls, parseErrors };
    }
    for (const call of parsed.value.tool_calls) {
      const resolved = finalize({ raw: JSON.stringify(call) }, call.name, call.arguments, tools);
      if ("message" in resolved) {
        parseErrors.push({ attemptedName: resolved.attemptedName, message: resolved.message });
      } else {
        calls.push({
          name: resolved.name,
          input: resolved.input,
          repaired: resolved.repaired ?? false,
          ...(resolved.correctedFromName ? { correctedFromName: resolved.correctedFromName } : {}),
        });
      }
    }
    return { transport: "structured", calls, parseErrors };
  }

  for (const envelope of extractEnvelopes(content)) {
    const resolved = resolveEnvelope(envelope, tools);
    if ("message" in resolved) {
      parseErrors.push({ attemptedName: resolved.attemptedName, message: resolved.message });
    } else {
      calls.push({
        name: resolved.name,
        input: resolved.input,
        repaired: resolved.repaired ?? false,
        ...(resolved.correctedFromName ? { correctedFromName: resolved.correctedFromName } : {}),
      });
    }
  }
  return { transport: "free-text", calls, parseErrors };
}

export function replaySession(
  session: Session,
  tools: ToolRegistry,
  opts: ReplayOptions = {},
): ReplayReport {
  const turns: TurnReplay[] = [];
  const divergences: string[] = [];
  let turnIndex = 0;
  let nowFailsWasOk = 0;
  let nowOkWasError = 0;
  let envelopeCountChanged = 0;
  let totalCalls = 0;
  let totalParseErrors = 0;

  for (let i = 0; i < session.messages.length; i++) {
    const message = session.messages[i];
    if (!message || message.role !== "assistant") continue;

    const { transport, calls, parseErrors } = replayTurn(message.content, tools, opts);

    const next = session.messages[i + 1];
    const recordedResults =
      next && next.role === "user"
        ? parseToolResultBlocks(next.content).map((b) => ({ name: b.name, isError: b.isError }))
        : [];

    const resolutionCount = calls.length + parseErrors.length;
    if (recordedResults.length > 0 && resolutionCount !== recordedResults.length) {
      envelopeCountChanged++;
      divergences.push(
        `turn ${turnIndex}: now extracts ${resolutionCount} tool-call(s), session recorded ${recordedResults.length}`,
      );
    } else if (recordedResults.length > 0) {
      // Same count - compare position by position. Resolutions map 1:1 to result blocks in the
      // order the loop emitted them (a parse error also produces one result block).
      const nowSeq: ("call" | "error")[] = [];
      // Rebuild the emitted order: loop.ts resolves envelopes in stream order, calls and parse
      // errors interleaved. We approximate by concatenating - good enough since a turn almost
      // never mixes both, and the count already matched.
      for (let k = 0; k < calls.length; k++) nowSeq.push("call");
      for (let k = 0; k < parseErrors.length; k++) nowSeq.push("error");

      recordedResults.forEach((rec, idx) => {
        const now = nowSeq[idx];
        if (now === "error" && !rec.isError) {
          nowFailsWasOk++;
          divergences.push(
            `turn ${turnIndex} call ${idx}: no longer resolves (session ran it as \`${rec.name}\`) - parser regression`,
          );
        } else if (now === "call" && rec.isError && rec.name === "unknown") {
          nowOkWasError++;
          divergences.push(
            `turn ${turnIndex} call ${idx}: now resolves cleanly; session recorded a parse error - a since-released fix would have helped`,
          );
        }
      });
    }

    turns.push({
      turnIndex,
      messageIndex: i,
      transport,
      resolvedCalls: calls,
      parseErrors,
      recordedResults,
    });
    totalCalls += calls.length;
    totalParseErrors += parseErrors.length;
    turnIndex++;
  }

  return {
    sessionId: session.id,
    turns,
    divergences,
    summary: {
      turns: turns.length,
      totalCalls,
      totalParseErrors,
      nowFailsWasOk,
      nowOkWasError,
      envelopeCountChanged,
    },
  };
}
