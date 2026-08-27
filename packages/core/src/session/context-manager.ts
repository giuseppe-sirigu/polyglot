import type { ProviderAdapter } from "../providers/types.js";
import type { Message, Session } from "./types.js";

/** No provider-agnostic tokenizer exists, so this is a conservative heuristic
 * (~4 chars/token for English-ish text) rather than an exact count - good enough
 * to decide when to compact, not to bill against. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateSessionTokens(session: Session): number {
  return session.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/** Best known size of the full prompt context: the provider-measured input-token count from the
 * last turn when available (set by runAgentTurn), otherwise the char-heuristic estimate. The
 * measured count also covers the system prompt and tool docs, which the estimate ignores. */
export function sessionContextTokens(session: Session): number {
  return session.lastContextTokens ?? estimateSessionTokens(session);
}

export function shouldCompact(
  session: Session,
  adapter: ProviderAdapter,
  threshold = 0.75,
): boolean {
  const used = sessionContextTokens(session);
  return used > adapter.capabilities.maxContextTokens * threshold;
}

const SUMMARY_PROMPT =
  "Summarize the conversation so far in a few dense paragraphs, preserving concrete facts " +
  "(file paths, decisions made, values discovered, open questions) that would matter for " +
  "continuing the task. Do not add commentary about the summary itself - output only the summary.";

/**
 * Collapses everything but the last `keepLastN` messages into one summary message,
 * asking the model itself to produce the summary. Real, working compaction - not a
 * blind truncation - so context survives across the cut.
 */
export async function compactSession(
  session: Session,
  adapter: ProviderAdapter,
  keepLastN = 6,
): Promise<{ before: number; after: number }> {
  const before = sessionContextTokens(session);
  if (session.messages.length <= keepLastN) {
    return { before, after: before };
  }

  const toSummarize = session.messages.slice(0, -keepLastN);
  const kept = session.messages.slice(-keepLastN);

  const transcript = toSummarize.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
  let summaryText = "";
  const controller = new AbortController();
  for await (const event of adapter.chat(
    {
      model: session.model,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: transcript },
      ],
    },
    { signal: controller.signal },
  )) {
    if (event.type === "text_delta") summaryText += event.delta;
  }

  const summaryMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: `[Summary of earlier conversation]\n${summaryText.trim()}`,
    createdAt: Date.now(),
  };

  session.messages.length = 0;
  session.messages.push(summaryMessage, ...kept);
  // The provider-measured count is now stale (it reflected the pre-compaction prompt); drop it
  // so callers fall back to a fresh estimate over the compacted messages until the next turn
  // re-measures.
  session.lastContextTokens = undefined;

  return { before, after: estimateSessionTokens(session) };
}
