import {
  type Message,
  type ParsedToolCall,
  type StructuredEnvelope,
  type ToolCallParseError,
  ToolCallStreamParser,
  type ToolRegistry,
  finalize,
  parseStructuredEnvelope,
  resolveEnvelope,
} from "@usepolyglot/core";
import type { NewDisplayItem } from "./types.js";

// Mirrors agent/loop.ts's formatToolResultBlock() - the exact shape a tool result gets wrapped
// in before being fed back to the model as a "user"-role message. This is our own internal
// serialization, never something a real user would type by hand, so matching it structurally is
// a reliable way to tell "this user message is actually a tool result" from a genuine one.
const TOOL_RESULT_BLOCK =
  /<tool_result name="([^"]*)"( status="error")?>\n([\s\S]*?)\n<\/tool_result>/g;

function parseToolResultBlocks(content: string): NewDisplayItem[] {
  return [...content.matchAll(TOOL_RESULT_BLOCK)].map(([, name, errorAttr, resultText]) => ({
    kind: "tool_result",
    name: name ?? "",
    resultText: resultText ?? "",
    isError: Boolean(errorAttr),
  }));
}

function pushResolvedCall(
  items: NewDisplayItem[],
  resolved: ParsedToolCall | ToolCallParseError,
): void {
  if ("message" in resolved) {
    items.push({ kind: "tool_parse_error", message: resolved.message });
  } else {
    items.push({
      kind: "tool_call",
      name: resolved.name,
      input: resolved.input,
      correctedFromName: resolved.correctedFromName,
    });
  }
}

// A structured-output completion is persisted verbatim too (see loop.ts's pushMessage call) -
// one raw JSON object (`{"message": "...", "tool_calls": [...]}`), not <tool_call>-tagged text.
// Which shape a given historical message is in isn't recorded anywhere per-message (the model
// may even have been switched mid-session via /model), so this is decided by trying to parse it
// as one first and falling back to tag parsing when that fails.
function parseStructuredMessage(
  envelope: StructuredEnvelope,
  tools: ToolRegistry,
): NewDisplayItem[] {
  const items: NewDisplayItem[] = [];
  if (envelope.message.trim().length > 0) {
    items.push({ kind: "assistant", text: envelope.message });
  }
  for (const call of envelope.tool_calls) {
    pushResolvedCall(
      items,
      finalize({ raw: JSON.stringify(call) }, call.name, call.arguments, tools),
    );
  }
  return items;
}

// The free-text tag protocol: prose interleaved with <tool_call> envelopes. ToolCallStreamParser
// is built to stream in chunks, so pushing a whole message at once can still yield several
// consecutive "text" events (it holds back a trailing slice in case a marker was split) - those
// need concatenating into one assistant item rather than one item per event, or a single
// paragraph fragments into several oddly-broken boxes in the transcript.
function parseTaggedMessage(content: string, tools: ToolRegistry): NewDisplayItem[] {
  const parser = new ToolCallStreamParser();
  const events = [...parser.push(content), ...parser.flush()];
  const items: NewDisplayItem[] = [];
  let textBuffer = "";
  const flushText = () => {
    if (textBuffer.trim().length > 0) items.push({ kind: "assistant", text: textBuffer });
    textBuffer = "";
  };
  for (const event of events) {
    if (event.type === "text") {
      textBuffer += event.text;
      continue;
    }
    flushText();
    pushResolvedCall(items, resolveEnvelope(event.envelope, tools));
  }
  flushText();
  return items;
}

function parseAssistantMessage(content: string, tools: ToolRegistry): NewDisplayItem[] {
  const structured = parseStructuredEnvelope(content);
  if (structured.ok) return parseStructuredMessage(structured.value, tools);
  return parseTaggedMessage(content, tools);
}

/** Rebuilds the transcript display items for a session's already-persisted messages, for
 * `/resume` and `--resume` - `session.messages` only stores raw role/content pairs (an
 * assistant completion's full raw text, tool_call tags and all; a "user"-role message that's
 * really a <tool_result> wrapper fed back to the model), so this reruns the same tag parsing
 * the live turn uses to turn that back into the tool_call/tool_result/assistant items the UI
 * shows for a turn in progress. */
export function reconstructTranscript(messages: Message[], tools: ToolRegistry): NewDisplayItem[] {
  const items: NewDisplayItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const resultBlocks = parseToolResultBlocks(message.content);
      if (resultBlocks.length > 0) {
        items.push(...resultBlocks);
      } else {
        items.push({ kind: "user", text: message.content });
      }
      continue;
    }
    items.push(...parseAssistantMessage(message.content, tools));
  }
  return items;
}
