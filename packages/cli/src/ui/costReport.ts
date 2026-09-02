import type { SessionUsageTotals } from "@usepolyglot/core";

/** Agent-session costs are usually cents or fractions of a cent - keep 4 places below $1 so a
 * $0.03 turn doesn't collapse and lose the detail; dollars show cents. */
export function fmtUSD(n: number): string {
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The `/cost` command body: cumulative session tokens + estimated cost, with a per-model
 * breakdown. `anyPricing` is true when at least one model in play has a price (an anthropic
 * model, or a local model with a `pricing` override) - when false the cost is genuinely $0 and
 * we say why rather than implying the run was free of consequence.
 */
export function formatCostReport(
  usage: SessionUsageTotals | undefined,
  ctx: { anyPricing: boolean },
): string {
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) {
    return "No token usage recorded yet this session.";
  }

  const lines = ["Session usage (estimated)"];
  lines.push(
    `  total:  ${fmtUSD(usage.costUSD)}  ·  ${fmtTokens(usage.inputTokens)} in / ${fmtTokens(
      usage.outputTokens,
    )} out`,
  );

  const models = Object.values(usage.byModel).sort((a, b) => b.costUSD - a.costUSD);
  if (models.length > 1 || (models[0] && models[0].costUSD > 0)) {
    lines.push("  by model:");
    for (const m of models) {
      lines.push(
        `    ${m.model}  ${fmtUSD(m.costUSD)}  ·  ${fmtTokens(m.inputTokens)} in / ${fmtTokens(
          m.outputTokens,
        )} out`,
      );
    }
  }

  if (!ctx.anyPricing) {
    lines.push(
      '  (no priced model used - local models are free; add a "pricing" entry in settings.json to estimate their cost)',
    );
  } else {
    lines.push("  cost is an estimate from list prices, not a bill.");
  }

  return lines.join("\n");
}

/** One-line cost summary for the `/status` block. */
export function formatCostLine(usage: SessionUsageTotals | undefined, anyPricing: boolean): string {
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) {
    return "no usage yet";
  }
  const tokens = `${fmtTokens(usage.inputTokens)} in / ${fmtTokens(usage.outputTokens)} out`;
  if (usage.costUSD > 0) return `~${fmtUSD(usage.costUSD)} estimated · ${tokens} (see /cost)`;
  return anyPricing ? `$0 · ${tokens} (see /cost)` : `$0 · local model · ${tokens} (see /cost)`;
}
