import type { RepairStrategy } from "../tool-protocol/json-repair.js";

/**
 * One tool-call resolution attempt, source-agnostic. Both the CLI's local audit log
 * (`audit/audit-log.ts`) and the Gateway's own SQLite `audit_repairs` table map their own data
 * into this shape before handing it to `generate.ts`, so the aggregation/redaction logic lives
 * once (per the plan's "lives once in @usepolyglot/core, not duplicated" design).
 */
export interface RepairRecordInput {
  at: string;
  model: string;
  toolName: string | null;
  /** null means this attempt never resolved into a call at all - a parse error. "unknown"
   * means it *did* resolve but which strategy isn't tracked (structured-output mode, the
   * schema-extraction fallback, or an audit-log entry written before this field existed) -
   * kept distinct from null so an untracked-but-successful call is never miscounted as a
   * parse error in generate.ts's aggregation. */
  strategy: RepairStrategy | "unknown" | null;
  repaired: boolean;
  /** The verbatim malformed body - present only when repaired and the source captured it.
   * Never leaves this record's own process by default; `--include-raw-samples` (and, within
   * that, a per-sample review) is the only path that can put it in an output file. */
  rawCall: string | null;
}
