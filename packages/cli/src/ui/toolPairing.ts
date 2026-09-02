import type { DisplayItem } from "./types.js";

type ToolCallItem = Extract<DisplayItem, { kind: "tool_call" }>;
type ToolResultItem = Extract<DisplayItem, { kind: "tool_result" }>;

export type TranscriptGroup =
  | { kind: "item"; item: DisplayItem }
  | { kind: "toolPair"; call: ToolCallItem; result?: ToolResultItem };

/**
 * Groups a flat transcript so each tool result renders directly under its own call - even when
 * several calls in one step executed concurrently and their `tool_result` events arrived
 * interleaved (which otherwise puts the first result under the last call). Items with no
 * `toolCallId` (older resumed sessions) fall back to flat order.
 */
export function groupTranscript(items: DisplayItem[]): TranscriptGroup[] {
  const resultByCallId = new Map<string, ToolResultItem>();
  for (const item of items) {
    if (item.kind === "tool_result" && item.toolCallId) {
      resultByCallId.set(item.toolCallId, item);
    }
  }

  const pairedResultIds = new Set<string>();
  const groups: TranscriptGroup[] = [];
  for (const item of items) {
    if (item.kind === "tool_call" && item.toolCallId) {
      const result = resultByCallId.get(item.toolCallId);
      if (result) pairedResultIds.add(result.id);
      groups.push({ kind: "toolPair", call: item, result });
    } else if (item.kind === "tool_result" && pairedResultIds.has(item.id)) {
      // already rendered under its call
    } else {
      groups.push({ kind: "item", item });
    }
  }
  return groups;
}
