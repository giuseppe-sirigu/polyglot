import { scanContent } from "../permissions/secret-patterns.js";
import type { FlaggedSample } from "./generate.js";

export interface RedactedSample extends FlaggedSample {
  redactedText: string;
  findings: { label: string; count: number }[];
}

/**
 * Runs every flagged sample through the same secret-scanning engine `polyglot share`'s
 * `--redact` and mid-turn tool-output scanning already use (`permissions/secret-patterns.ts`)
 * - no new pattern-matching logic. Always redacts, unconditionally - a sample is never held or
 * shown in a fully-unredacted state, auto-redaction runs before display, not after approval,
 * per the plan's design. This is the load-bearing safeguard the raw-samples review screen
 * displays; the screen itself never sees the original text.
 */
export function buildRedactionPreview(samples: FlaggedSample[]): RedactedSample[] {
  return samples.map((s) => {
    const { text, findings } = scanContent(s.rawCall, { redact: true, pii: false });
    return { ...s, redactedText: text, findings };
  });
}
