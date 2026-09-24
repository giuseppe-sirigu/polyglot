import type { ReliabilityDigest } from "./generate.js";
import type { RedactedSample } from "./redaction-preview.js";

/**
 * Renders the digest to markdown. `includedSamples` is only ever passed when the raw-samples
 * flow ran and produced a final, human-approved list (post-review) - the review screen's own
 * output, not `digest.flaggable` directly, so an excluded or unreviewed sample can never reach
 * this function's output at all. `reviewSummary` is the one-line provenance note ("3 samples
 * auto-redacted (4 secret-like spans removed), 3 included, 1 excluded") the plan calls for, so
 * `report submit`'s own review step has an honest total to show, not just a raw file.
 */
export function renderDigestMarkdown(
  digest: ReliabilityDigest,
  opts: { includedSamples?: RedactedSample[]; reviewSummary?: string } = {},
): string {
  const lines: string[] = [];
  lines.push("# Polyglot reliability digest");
  lines.push("");
  lines.push(`Generated: ${digest.generatedAt}`);
  lines.push(`Period: ${digest.periodLabel} (${digest.periodStart} to ${digest.periodEnd})`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total tool-call attempts: ${digest.totalCalls}`);
  lines.push(`- Repaired: ${digest.totalRepaired}`);
  lines.push(`- Parse errors (never resolved): ${digest.totalParseErrors}`);
  lines.push("");

  lines.push("## By model");
  lines.push("");
  lines.push(
    "| Model | Calls | Repaired | Parse errors | wrapper_stripped | jsonrepair | loose_kv | trailing_blob |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const m of digest.byModel) {
    lines.push(
      `| ${m.model} | ${m.totalCalls} | ${m.repaired} | ${m.parseErrors} | ${m.byStrategy.wrapper_stripped ?? 0} | ${m.byStrategy.jsonrepair ?? 0} | ${m.byStrategy.loose_kv ?? 0} | ${m.byStrategy.trailing_blob ?? 0} |`,
    );
  }
  lines.push("");

  lines.push("## Raw samples");
  lines.push("");
  if (opts.includedSamples) {
    if (opts.reviewSummary) {
      lines.push(opts.reviewSummary);
      lines.push("");
    }
    if (opts.includedSamples.length === 0) {
      lines.push("_None included in this report._");
    } else {
      for (const s of opts.includedSamples) {
        lines.push(`### ${s.model} / ${s.toolName ?? "(unknown tool)"} - ${s.strategy}`);
        lines.push("");
        lines.push(`At: ${s.at}`);
        if (s.findings.length > 0) {
          lines.push(`Redacted: ${s.findings.map((f) => `${f.count}x ${f.label}`).join(", ")}`);
        }
        lines.push("");
        lines.push("```");
        lines.push(s.redactedText);
        lines.push("```");
        lines.push("");
      }
    }
  } else if (digest.flaggable.length > 0) {
    lines.push(
      `${digest.flaggable.length} low-confidence repair(s) (loose_kv/trailing_blob) found but not included - re-run with --include-raw-samples to review and optionally include them.`,
    );
    lines.push("");
  } else {
    lines.push("_None found in this period._");
    lines.push("");
  }

  return lines.join("\n");
}
