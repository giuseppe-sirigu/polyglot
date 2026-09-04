export type AtCandidateKind = "file" | "agent" | "skill";

export interface AtCandidate {
  kind: AtCandidateKind;
  /** Text inserted into the input when this candidate is accepted. */
  value: string;
  /** Shown in the menu. */
  label: string;
  /** Optional secondary text (an agent/skill description). */
  hint?: string;
}

/**
 * Finds the `@`-mention token the cursor is currently inside, if any. The token is an `@`
 * immediately preceded by start-of-text or whitespace, followed by non-whitespace up to the
 * cursor. Returns `{ query, start }` where `start` is the `@`'s index. `query` is `""` right
 * after typing a bare `@`. Null when there's no such token (or an intervening space, or the
 * `@` sits mid-word like an email address).
 */
export function findMentionQuery(
  text: string,
  cursor: number,
): { query: string; start: number } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === undefined) return null;
    if (/\s/.test(ch)) return null;
    if (ch === "@") {
      const before = i === 0 ? "" : text[i - 1];
      if (before === "" || /\s/.test(before ?? "")) {
        return { query: text.slice(i + 1, cursor), start: i };
      }
      return null;
    }
  }
  return null;
}

/** Lower is better. -1 means "no match at all". */
function score(query: string, candidate: string): number {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();

  if (c === q) return 0;
  // Prefix of the whole string, or of the last path segment.
  if (c.startsWith(q)) return 1;
  const seg = c.slice(c.lastIndexOf("/") + 1);
  if (seg.startsWith(q)) return 2;
  // Ordered subsequence (fzf-style): every query char appears in order.
  let ci = 0;
  for (const qc of q) {
    ci = c.indexOf(qc, ci);
    if (ci === -1) break;
    ci++;
  }
  if (ci !== -1) return 3;
  if (c.includes(q)) return 4;
  return -1;
}

/** Ranks candidates against a mention query, best first, capped at `limit`. */
export function rankMentions(query: string, candidates: AtCandidate[], limit = 10): AtCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, s: score(query, candidate.label) }))
    .filter((x) => x.s >= 0)
    .sort(
      (a, b) =>
        a.s - b.s ||
        a.candidate.label.length - b.candidate.label.length ||
        a.candidate.label.localeCompare(b.candidate.label),
    )
    .slice(0, limit)
    .map((x) => x.candidate);
}
