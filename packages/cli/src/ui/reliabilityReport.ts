import type { ModelReliabilityTotals, SessionReliabilityTotals } from "@usepolyglot/core";

/** Tool calls that parsed AND didn't need repair - the "held the format" count. */
function clean(m: ModelReliabilityTotals): number {
  return m.toolCalls - m.repaired;
}

/** Emissions the model made that were meant to be tool calls (parsed + failed). */
function attempts(m: ModelReliabilityTotals): number {
  return m.toolCalls + m.parseErrors;
}

function cleanPct(m: ModelReliabilityTotals): number {
  const a = attempts(m);
  return a === 0 ? 100 : Math.round((clean(m) / a) * 100);
}

function summarise(m: ModelReliabilityTotals): string {
  const parts = [`${clean(m)}/${attempts(m)} clean (${cleanPct(m)}%)`];
  if (m.repaired > 0) parts.push(`${m.repaired} repaired`);
  if (m.parseErrors > 0)
    parts.push(`${m.parseErrors} parse error${m.parseErrors === 1 ? "" : "s"}`);
  if (m.gaveUp > 0) parts.push(`gave up ${m.gaveUp}×`);
  return parts.join(" · ");
}

/** One-line reliability summary for the `/status` block - the active model's tally. */
export function formatReliabilityLine(
  reliability: SessionReliabilityTotals | undefined,
  activeModel: string,
): string {
  const m = reliability?.byModel[activeModel];
  if (!m || attempts(m) === 0) return "no tool calls yet";
  return `${activeModel} · ${summarise(m)} (see /reliability)`;
}

/** The `/reliability` command body: a per-model breakdown of this session's tool-call
 * reliability. */
export function formatReliabilityReport(reliability: SessionReliabilityTotals | undefined): string {
  const models = Object.values(reliability?.byModel ?? {}).filter((m) => attempts(m) > 0);
  if (models.length === 0) {
    return "No tool calls this session yet - nothing to score.";
  }
  models.sort((a, b) => attempts(b) - attempts(a));
  const lines = ["Tool-call reliability this session"];
  for (const m of models) {
    lines.push(`  ${m.model}`);
    lines.push(`    ${summarise(m)}`);
    if (m.nameCorrected > 0) {
      lines.push(`    (${m.nameCorrected} of the repairs were a mistyped tool name)`);
    }
  }
  lines.push("  'clean' = parsed on the first try, no repair. Session-scoped, not persisted.");
  return lines.join("\n");
}

/** Short annotation for a model row in the `/model` picker, or undefined when there's no data
 * for that model this session. */
export function reliabilityBadge(
  reliability: SessionReliabilityTotals | undefined,
  model: string,
): string | undefined {
  const m = reliability?.byModel[model];
  if (!m || attempts(m) === 0) return undefined;
  if (m.gaveUp > 0) return `gave up ${m.gaveUp}× this session`;
  if (m.parseErrors > 0)
    return `${m.parseErrors} parse error${m.parseErrors === 1 ? "" : "s"} this session`;
  return `${cleanPct(m)}% clean this session`;
}
