/**
 * Regex patterns for secret-looking and (opt-in) PII-looking strings, plus `scanContent()` -
 * the shared engine behind both `polyglot share` redaction (`session/redact.ts`) and
 * content scanning of tool output before it reaches the model (`agent/executor.ts`).
 *
 * This is best-effort: it catches common formats and will miss bespoke secrets. A false
 * positive is a spurious `[redacted:…]` (redact mode) or an extra warning line (warn mode),
 * never a crash.
 */

export interface SecretPattern {
  label: string;
  re: RegExp;
  /** Optional second-stage check on the raw match (e.g. a Luhn digit check for card numbers).
   * A match that fails it is neither counted nor redacted. */
  validate?: (match: string) => boolean;
}

export interface ContentFinding {
  label: string;
  count: number;
}

export interface ScanResult {
  text: string;
  findings: ContentFinding[];
}

export interface ScanOptions {
  /** Replace matches with `[redacted:<label>]`. When false, `text` is returned unchanged and
   * only `findings` is populated. */
  redact: boolean;
  /** Include the noisier PII patterns (email, SSN, card, phone). Default false. */
  pii?: boolean;
  /** Extra caller-supplied patterns (from `redaction.extraPatterns` in settings). */
  extra?: SecretPattern[];
}

// Order matters: the structured formats (PEM, JWT) and vendor-prefixed keys run before the
// generic `key = value` catch-all so a longer match isn't chewed up piecemeal by a shorter one.
export const SECRET_PATTERNS: SecretPattern[] = [
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

/** Luhn checksum - trims false positives on the card-number pattern. */
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export const PII_PATTERNS: SecretPattern[] = [
  { label: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // US SSN, excluding the ranges the SSA never issues.
  { label: "ssn", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  {
    label: "credit-card",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => luhnValid(m.replace(/\D/g, "")),
  },
  // E.164 international numbers - the leading + keeps this from matching every long integer.
  { label: "phone", re: /\B\+[1-9]\d{7,14}\b/g },
];

function applyPatterns(text: string, patterns: SecretPattern[], redact: boolean): ScanResult {
  let out = text;
  const findings: ContentFinding[] = [];
  for (const { label, re, validate } of patterns) {
    let count = 0;
    out = out.replace(re, (match: string, ...args: unknown[]) => {
      if (validate && !validate(match)) return match;
      count++;
      if (!redact) return match;
      // The `key = value` rule keeps the key and separator so the line still reads.
      if (label === "assignment") {
        const key = args[0];
        const sep = args[1];
        if (typeof key === "string" && typeof sep === "string") return `${key}${sep}[redacted]`;
      }
      return `[redacted:${label}]`;
    });
    if (count > 0) findings.push({ label, count });
  }
  return { text: out, findings };
}

/**
 * Scans `text` for secret- and (when `opts.pii`) PII-looking values. Returns the findings
 * tally always; returns redacted text when `opts.redact`, otherwise the input unchanged.
 */
export function scanContent(text: string, opts: ScanOptions): ScanResult {
  const patterns = [...SECRET_PATTERNS, ...(opts.pii ? PII_PATTERNS : []), ...(opts.extra ?? [])];
  return applyPatterns(text, patterns, opts.redact);
}
