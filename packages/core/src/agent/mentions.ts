import { constants } from "node:fs";
import { open } from "node:fs/promises";
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

/** Opens, checks, and reads a mention target through a single file handle - no check-then-use
 * gap, and `O_NOFOLLOW` refuses a symlink on the final component (so a swapped-in link to a
 * secret can't be read). Returns null for anything that isn't a plain readable file. */
async function readMentionFile(
  path: string,
): Promise<{ content: string; truncated: boolean } | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) return null;
    const buf = Buffer.alloc(Math.min(st.size, MAX_MENTION_BYTES + 1));
    if (buf.length > 0) await handle.read(buf, 0, buf.length, 0);
    const truncated = st.size > MAX_MENTION_BYTES;
    const content = truncated
      ? `${buf.subarray(0, MAX_MENTION_BYTES).toString("utf8")}\n\n[... truncated]`
      : buf.toString("utf8");
    return { content, truncated };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Replaces `@<relative-path>` tokens in a message with the file's contents, wrapped in a
 * `<file path="...">` block, so the model gets the file without a `read_file` round-trip. A
 * token that doesn't resolve to a readable file inside `cwd` is left untouched (it's just
 * text). A token that resolves to a secret file (`.env`, keys, `.ssh/…`), or a symlink, is
 * never inlined - a secret is reported in `skipped` instead.
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
      if (matchesSecretPath(resolved)) {
        skipped.push(token);
      } else {
        const file = await readMentionFile(resolved);
        if (file) {
          attached.push({ path: token, lines: file.content.split("\n").length });
          expansion = `${lead}\n<file path="${token}">\n${file.content}\n</file>\n`;
        }
      }
    }

    result += text.slice(lastIndex, start) + (expansion ?? whole);
    lastIndex = start + whole.length;
  }
  result += text.slice(lastIndex);

  return { text: result, attached, skipped };
}
