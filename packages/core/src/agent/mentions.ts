import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { matchesSecretPath } from "../permissions/secret-paths.js";

/** Per-file cap on an inlined `@file` mention - a huge file shouldn't be able to blow the
 * context window from one keystroke. Anything past this is truncated with a marker. */
const MAX_MENTION_BYTES = 65_536;

export interface ExpandedMentions {
  /** The message with resolved `@file` tokens replaced by `<file>` blocks. */
  text: string;
  /** Files that were inlined. */
  attached: { path: string; lines: number }[];
  /** `@` tokens that resolved to a secret file and were left as-is (not inlined). */
  skipped: string[];
}

// `@` preceded by start-of-string or whitespace, then a run of non-space / non-`@` chars.
const MENTION_RE = /(^|\s)@([^\s@]+)/g;

function insideCwd(resolved: string, cwd: string): boolean {
  const rel = relative(cwd, resolved);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/**
 * Replaces `@<relative-path>` tokens in a message with the file's contents, wrapped in a
 * `<file path="...">` block, so the model gets the file without a `read_file` round-trip. A
 * token that doesn't resolve to a readable file inside `cwd` is left untouched (it's just
 * text). A token that resolves to a secret file (`.env`, keys, `.ssh/…`) is never inlined -
 * it's reported in `skipped` instead.
 */
export async function expandFileMentions(text: string, cwd: string): Promise<ExpandedMentions> {
  const attached: { path: string; lines: number }[] = [];
  const skipped: string[] = [];
  let result = "";
  let lastIndex = 0;

  for (const match of text.matchAll(MENTION_RE)) {
    const [whole, lead, token] = match;
    const start = match.index;
    const resolved = resolve(cwd, token ?? "");

    let expansion: string | null = null;
    if (token && insideCwd(resolved, cwd)) {
      try {
        if ((await stat(resolved)).isFile()) {
          if (matchesSecretPath(resolved)) {
            skipped.push(token);
          } else {
            let content = await readFile(resolved, "utf8");
            if (Buffer.byteLength(content, "utf8") > MAX_MENTION_BYTES) {
              content = `${content.slice(0, MAX_MENTION_BYTES)}\n\n[... truncated]`;
            }
            attached.push({ path: token, lines: content.split("\n").length });
            expansion = `${lead}\n<file path="${token}">\n${content}\n</file>\n`;
          }
        }
      } catch {
        // not a real file - leave the token as text
      }
    }

    result += text.slice(lastIndex, start) + (expansion ?? whole);
    lastIndex = start + whole.length;
  }
  result += text.slice(lastIndex);

  return { text: result, attached, skipped };
}
