/**
 * Best-effort scrubbing of secret-looking strings from text destined for a shared export.
 * This is a safety net, not a guarantee - it catches common formats (cloud keys, bearer
 * tokens, private-key blocks, `KEY=...` assignments) but will miss bespoke secrets. The raw
 * session JSONL on disk is never modified; only the `polyglot share` output is redacted, and
 * `--no-redact` turns even that off.
 *
 * The pattern set and the scan engine live in `permissions/secret-patterns.ts`, shared with
 * content scanning of tool output.
 */

import { scanContent } from "../permissions/secret-patterns.js";

export function redactSecrets(text: string): { text: string; count: number } {
  const { text: out, findings } = scanContent(text, { redact: true, pii: false });
  return { text: out, count: findings.reduce((n, f) => n + f.count, 0) };
}
