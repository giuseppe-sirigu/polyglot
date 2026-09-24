import type { RepairRecordInput } from "./types.js";

export interface ModelBreakdown {
  model: string;
  totalCalls: number;
  repaired: number;
  parseErrors: number;
  /** Key is a RepairStrategy value, or "parse_error" for attempts that never resolved. */
  byStrategy: Record<string, number>;
}

export interface FlaggedSample {
  at: string;
  model: string;
  toolName: string | null;
  strategy: "loose_kv" | "trailing_blob";
  rawCall: string;
}

export interface ReliabilityDigest {
  generatedAt: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  totalCalls: number;
  totalRepaired: number;
  totalParseErrors: number;
  byModel: ModelBreakdown[];
  /** Only `loose_kv`/`trailing_blob` repairs - the low-confidence strategies most likely to
   * represent a genuinely new failure mode, per the plan's own reasoning. Always populated
   * (this is what decides what's *eligible* for the raw-samples review); the bodies
   * themselves only ever reach an output file via `--include-raw-samples` and per-sample
   * review - see report/redaction-preview.ts. */
  flaggable: FlaggedSample[];
}

const LOW_CONFIDENCE_STRATEGIES = new Set(["loose_kv", "trailing_blob"]);

/**
 * Aggregates a source-agnostic list of repair records into the digest's summary shape. Pure
 * function, no I/O - the CLI reads its local audit log and the Gateway reads its own SQLite
 * tables, each mapping their own data into `RepairRecordInput[]` before calling this, so the
 * aggregation logic itself lives once (per the plan's design).
 */
export function generateReliabilityDigest(
  records: RepairRecordInput[],
  opts: { periodLabel: string; periodStart: string; periodEnd: string },
): ReliabilityDigest {
  const byModelMap = new Map<string, ModelBreakdown>();
  const flaggable: FlaggedSample[] = [];
  let totalRepaired = 0;
  let totalParseErrors = 0;

  for (const r of records) {
    let entry = byModelMap.get(r.model);
    if (!entry) {
      entry = { model: r.model, totalCalls: 0, repaired: 0, parseErrors: 0, byStrategy: {} };
      byModelMap.set(r.model, entry);
    }
    entry.totalCalls++;

    if (r.strategy === null) {
      entry.parseErrors++;
      totalParseErrors++;
      entry.byStrategy.parse_error = (entry.byStrategy.parse_error ?? 0) + 1;
      continue;
    }

    entry.byStrategy[r.strategy] = (entry.byStrategy[r.strategy] ?? 0) + 1;
    if (r.repaired) {
      entry.repaired++;
      totalRepaired++;
    }
    if (LOW_CONFIDENCE_STRATEGIES.has(r.strategy) && r.rawCall) {
      flaggable.push({
        at: r.at,
        model: r.model,
        toolName: r.toolName,
        strategy: r.strategy as "loose_kv" | "trailing_blob",
        rawCall: r.rawCall,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    periodLabel: opts.periodLabel,
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    totalCalls: records.length,
    totalRepaired,
    totalParseErrors,
    byModel: [...byModelMap.values()].sort((a, b) => b.totalCalls - a.totalCalls),
    flaggable,
  };
}
