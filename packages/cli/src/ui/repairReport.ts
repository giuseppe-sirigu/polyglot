import { describeToolCall, truncate } from "./toolDisplay.js";
import type { DisplayItem } from "./types.js";

type RepairedCall = Extract<DisplayItem, { kind: "tool_call" }>;

/** The `/raw` command body: the model's verbatim malformed output for each repaired tool call
 * this session, next to what it resolved to. Lets you spot a model producing more broken
 * calls even though the repair layer keeps hiding it in the normal view. */
export function formatRepairReport(repairs: RepairedCall[], limit = 8): string {
  if (repairs.length === 0) {
    return "No repaired tool calls this session - every call parsed cleanly.";
  }

  const shown = repairs.slice(-limit);
  const omitted = repairs.length - shown.length;
  const lines: string[] = [
    `${repairs.length} tool call${repairs.length === 1 ? "" : "s"} needed repair this session${
      omitted > 0 ? ` (showing the last ${shown.length})` : ""
    }:`,
  ];

  for (const call of shown) {
    lines.push("");
    lines.push(`  ⏺ ${describeToolCall(call.name, call.input)}`);
    if (call.correctedFromName) {
      lines.push(`    tool name corrected from "${call.correctedFromName}"`);
    }
    if (call.rawCall) {
      lines.push("    raw:");
      for (const raw of truncate(call.rawCall, 1600).split("\n")) {
        lines.push(`      ${raw}`);
      }
    }
  }

  return lines.join("\n");
}
