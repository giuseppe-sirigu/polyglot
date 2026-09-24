import type { AuditEvent } from "../audit/audit-log.js";
import type { RepairRecordInput } from "./types.js";

/**
 * Maps the CLI's own local `AuditEvent`s onto the source-agnostic shape `generate.ts` expects.
 * Only `tool_call` and `tool_parse_error` events carry repair-relevant data - everything else
 * (turn_start, usage, agent_stop, etc.) is irrelevant to a reliability digest and dropped here.
 */
export function repairRecordsFromAuditEvents(events: AuditEvent[]): RepairRecordInput[] {
  const records: RepairRecordInput[] = [];
  for (const e of events) {
    if (e.kind === "tool_call") {
      records.push({
        at: e.at,
        model: e.model,
        toolName: e.toolName,
        strategy: e.strategy ?? "unknown",
        repaired: Boolean(e.repaired),
        rawCall: e.rawCall ?? null,
      });
    } else if (e.kind === "tool_parse_error") {
      records.push({
        at: e.at,
        model: e.model,
        toolName: e.attemptedName,
        strategy: null,
        repaired: false,
        rawCall: null,
      });
    }
  }
  return records;
}
