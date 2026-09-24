import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type RedactedSample,
  buildRedactionPreview,
  generateReliabilityDigest,
  readAuditEvents,
  renderDigestMarkdown,
  repairRecordsFromAuditEvents,
} from "@usepolyglot/core";
import { render } from "ink";
import { createElement } from "react";
import type { CliArgs } from "./args.js";
import {
  type RawSamplesReviewResult,
  RawSamplesReviewScreen,
} from "./ui/RawSamplesReviewScreen.js";

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function reviewRawSamplesInteractively(
  samples: RedactedSample[],
): Promise<RawSamplesReviewResult | null> {
  return new Promise((resolvePromise) => {
    const instance = render(
      createElement(RawSamplesReviewScreen, {
        samples,
        onComplete: (result: RawSamplesReviewResult | null) => {
          instance.unmount();
          resolvePromise(result);
        },
      }),
    );
  });
}

function countFindings(samples: RedactedSample[]): number {
  return samples.reduce((n, s) => n + s.findings.reduce((m, f) => m + f.count, 0), 0);
}

async function runGenerate(args: CliArgs): Promise<number> {
  const events = await readAuditEvents({ sinceDays: args.reportDays });
  const records = repairRecordsFromAuditEvents(events);

  const now = new Date();
  const periodStart = new Date(now.getTime() - args.reportDays * 86_400_000).toISOString();
  const digest = generateReliabilityDigest(records, {
    periodLabel: `last ${args.reportDays} day${args.reportDays === 1 ? "" : "s"}`,
    periodStart,
    periodEnd: now.toISOString(),
  });

  let includedSamples: RedactedSample[] | undefined;
  let reviewSummary: string | undefined;

  if (args.reportIncludeRawSamples && digest.flaggable.length > 0) {
    const previews = buildRedactionPreview(digest.flaggable);
    const totalFindings = countFindings(previews);

    if (!isInteractive()) {
      // No TTY means no Ink screen can render at all, not just a policy choice - see the
      // plan's design for why this refuses by default rather than silently skipping review.
      if (!args.reportApproveRawSamples) {
        process.stderr.write(
          `[polyglot] --include-raw-samples needs an interactive terminal to review ${previews.length} flagged sample(s) one at a time. Run this interactively, or pass --i-have-reviewed-and-approve-raw-samples to include all of them (already auto-redacted) without per-item review.\n`,
        );
        return 1;
      }
      includedSamples = previews;
      reviewSummary = `${previews.length} sample(s) auto-redacted (${totalFindings} secret-like span(s) removed), all included via --i-have-reviewed-and-approve-raw-samples (no interactive review - no TTY).`;
    } else {
      const result = await reviewRawSamplesInteractively(previews);
      if (result === null) {
        process.stderr.write(
          "[polyglot] raw-samples review aborted - proceeding with aggregate-only output.\n",
        );
      } else {
        includedSamples = result.included;
        reviewSummary = `${previews.length} sample(s) auto-redacted (${totalFindings} secret-like span(s) removed), ${result.included.length} included, ${result.excludedCount} excluded.`;
      }
    }
  }

  const markdown = renderDigestMarkdown(digest, { includedSamples, reviewSummary });
  const outPath = resolve(
    process.cwd(),
    args.reportOut ?? `polyglot-reliability-digest-${now.toISOString().slice(0, 10)}.md`,
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf8");

  process.stderr.write(`[polyglot] wrote ${outPath}\n`);
  process.stderr.write(
    `[polyglot] ${digest.totalCalls} tool-call attempt(s), ${digest.totalRepaired} repaired, ${digest.totalParseErrors} parse error(s), across ${digest.byModel.length} model(s).\n`,
  );
  if (includedSamples) {
    process.stderr.write(
      `[polyglot] ${includedSamples.length} raw sample(s) included (redacted).\n`,
    );
  } else if (digest.flaggable.length > 0 && !args.reportIncludeRawSamples) {
    process.stderr.write(
      `[polyglot] ${digest.flaggable.length} low-confidence repair(s) found but not reviewed - re-run with --include-raw-samples to review them.\n`,
    );
  }
  return 0;
}

async function runSubmit(args: CliArgs): Promise<number> {
  const path = resolve(process.cwd(), args.reportSubmitTarget as string);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    process.stderr.write(`[polyglot] could not read ${path}\n`);
    return 1;
  }

  process.stdout.write(`${content}\n`);
  process.stderr.write(
    "\n[polyglot] the report above is exactly what would be submitted for corpus review.\n",
  );

  if (!isInteractive()) {
    process.stderr.write(
      "[polyglot] no TTY to confirm on - not submitted. Run this interactively.\n",
    );
    return 1;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Submit this report? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    process.stderr.write("[polyglot] not submitted.\n");
    return 1;
  }

  // Deliberately no default here - this is a small, single-purpose, Polyglot-operated
  // ingestion endpoint (not the customer's own control plane), and it isn't deployed yet.
  // Guessing a plausible-looking URL would be worse than erroring: it would look like a real,
  // decided endpoint when none exists.
  const submitUrl = process.env.POLYGLOT_REPORT_SUBMIT_URL;
  if (!submitUrl) {
    process.stderr.write(
      "[polyglot] POLYGLOT_REPORT_SUBMIT_URL is not set - there is no submission endpoint deployed yet, so there's nowhere to send this. The report was NOT submitted (it's still on disk at the path above).\n",
    );
    return 1;
  }

  try {
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: content,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      process.stderr.write(`[polyglot] submission endpoint returned ${res.status}.\n`);
      return 1;
    }
  } catch (err) {
    process.stderr.write(
      `[polyglot] could not reach ${submitUrl}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stderr.write("[polyglot] submitted. Thank you!\n");
  return 0;
}

export async function runReport(args: CliArgs): Promise<number> {
  if (args.reportAction === "submit") return runSubmit(args);
  return runGenerate(args);
}
