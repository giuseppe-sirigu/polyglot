/**
 * Best-effort scrubbing of secret-looking strings from text destined for a shared export.
 * This is a safety net, not a guarantee - it catches common formats (cloud keys, bearer
 * tokens, private-key blocks, `KEY=...` assignments) but will miss bespoke secrets. The raw
 * session JSONL on disk is never modified; only the `polyglot share` output is redacted, and
 * `--no-redact` turns even that off.
 */

interface Pattern {
  label: string;
  re: RegExp;
}

// Order matters: the structured formats (PEM, JWT) and vendor-prefixed keys run before the
// generic `key = value` catch-all so a longer match isn't chewed up piecemeal by a shorter one.
const PATTERNS: Pattern[] = [
  {
    label: "private-key",
    re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { label: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: "openai-key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { label: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/g },
  {
    label: "assignment",
    re: /\b([\w-]*(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key))(\s*[:=]\s*)(["']?)[A-Za-z0-9._\-/+]{12,}\3/gi,
  },
];

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const { label, re } of PATTERNS) {
    out = out.replace(re, (match, key?: string, sep?: string) => {
      count++;
      // For the `key = value` rule, keep the key and separator so the line still reads.
      if (label === "assignment" && key && sep) return `${key}${sep}[redacted]`;
      return `[redacted:${label}]`;
    });
  }
  return { text: out, count };
}
