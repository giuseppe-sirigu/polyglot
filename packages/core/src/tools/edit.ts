import { readFile, writeFile } from "node:fs/promises";
import { resolveToolPath } from "./resolve-path.js";
import { type DiffPreview, type ToolDefinition, textResult } from "./types.js";

interface EditFileInput {
  path: string;
  old_string: string;
  new_string: string;
}

const PATH_DESCRIPTION = "Absolute path, or relative to the current working directory.";

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Weak models mangle `old_string` in two predictable ways: they double their escapes
 * (`\\n`, `\\"`, `\\$`, `` \\` ``) after being told to escape, and they drop or flatten
 * the file's indentation. `collapseDoubledEscapes` undoes the first; `matchTrimmedLines`
 * (line-by-line, ignoring leading/trailing whitespace) handles the second.
 *
 * Both are strictly additive: a normalized form is only used when it produces a *unique*
 * match, so a file that legitimately contains a backslash-n or unusual indentation is
 * never matched by accident - exact matching is always tried first and wins.
 */
function collapseDoubledEscapes(s: string): string {
  if (!s.includes("\\")) return s;
  return s
    .replace(/\\\\/g, "\\")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, "`")
    .replace(/\\\$/g, "$");
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/** Re-anchors `text` to `baseIndent`: strips the block's own common indent, then prefixes
 * every non-blank line with `baseIndent`, preserving relative nesting. */
function reindent(text: string, baseIndent: string): string {
  const lines = text.split("\n");
  const bodyIndents = lines.filter((l) => l.trim() !== "").map((l) => leadingWhitespace(l).length);
  const common = bodyIndents.length > 0 ? Math.min(...bodyIndents) : 0;
  return lines.map((l) => (l.trim() === "" ? "" : baseIndent + l.slice(common))).join("\n");
}

interface TrimmedMatch {
  count: number;
  start: number;
  end: number;
  baseIndent: string;
}

/** Finds `needle` in `original` comparing line-by-line with leading/trailing whitespace
 * ignored. Returns how many places matched (only a count of 1 is usable). */
function matchTrimmedLines(original: string, needle: string): TrimmedMatch {
  const empty: TrimmedMatch = { count: 0, start: 0, end: 0, baseIndent: "" };
  const needleLines = needle.split("\n");
  const needleTrimmed = needleLines.map((l) => l.trim());
  if (needleTrimmed.every((l) => l === "")) return empty;

  const origLines = original.split("\n");
  const hits: number[] = [];
  for (let i = 0; i + needleLines.length <= origLines.length; i++) {
    let ok = true;
    for (let j = 0; j < needleLines.length; j++) {
      if ((origLines[i + j] ?? "").trim() !== needleTrimmed[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }
  if (hits.length !== 1) return { ...empty, count: hits.length };

  const startLine = hits[0] as number;
  let start = 0;
  for (let k = 0; k < startLine; k++) start += (origLines[k]?.length ?? 0) + 1;
  const matched = origLines.slice(startLine, startLine + needleLines.length).join("\n");
  return {
    count: 1,
    start,
    end: start + matched.length,
    baseIndent: leadingWhitespace(origLines[startLine] ?? ""),
  };
}

type EditLocation =
  | { ok: true; start: number; end: number; replacement: string; normalized: boolean }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "ambiguous"; count: number };

/** Locates the span of `original` to replace, tolerating a weak model's over-escaping and
 * indentation drift. Exact matching is tried first; looser passes only apply when they land
 * a single unambiguous hit. */
function locateEdit(original: string, oldStr: string, newStr: string): EditLocation {
  const exact = countOccurrences(original, oldStr);
  if (exact === 1) {
    const start = original.indexOf(oldStr);
    return { ok: true, start, end: start + oldStr.length, replacement: newStr, normalized: false };
  }
  if (exact > 1) return { ok: false, reason: "ambiguous", count: exact };

  const oldUnescaped = collapseDoubledEscapes(oldStr);
  if (oldUnescaped !== oldStr) {
    const c = countOccurrences(original, oldUnescaped);
    if (c === 1) {
      const start = original.indexOf(oldUnescaped);
      return {
        ok: true,
        start,
        end: start + oldUnescaped.length,
        replacement: collapseDoubledEscapes(newStr),
        normalized: true,
      };
    }
    if (c > 1) return { ok: false, reason: "ambiguous", count: c };
  }

  const candidates: Array<{ old: string; next: string }> = [{ old: oldStr, next: newStr }];
  if (oldUnescaped !== oldStr) {
    candidates.push({ old: oldUnescaped, next: collapseDoubledEscapes(newStr) });
  }
  for (const cand of candidates) {
    const m = matchTrimmedLines(original, cand.old);
    if (m.count === 1) {
      return {
        ok: true,
        start: m.start,
        end: m.end,
        replacement: reindent(cand.next, m.baseIndent),
        normalized: true,
      };
    }
    if (m.count > 1) return { ok: false, reason: "ambiguous", count: m.count };
  }

  return { ok: false, reason: "none" };
}

function applyLocation(original: string, loc: Extract<EditLocation, { ok: true }>): string {
  return original.slice(0, loc.start) + loc.replacement + original.slice(loc.end);
}

export const editFileTool: ToolDefinition<EditFileInput> = {
  name: "edit_file",
  description:
    "Replace one occurrence of old_string with new_string in a file. old_string should match " +
    "the file exactly, including whitespace, and must identify a single unambiguous location. " +
    "Minor whitespace and over-escaping differences are tolerated when the match is still unique.",
  permission: "write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: `File path to edit. ${PATH_DESCRIPTION}` },
      old_string: {
        type: "string",
        description: "Text to replace, copied from the file. Must identify one unique location.",
      },
      new_string: { type: "string", description: "Replacement text." },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async previewDiff(input, ctx): Promise<DiffPreview | null> {
    const resolved = resolveToolPath(input.path, ctx.cwd);
    if ("error" in resolved) return null;
    try {
      const original = await readFile(resolved.path, { encoding: "utf8", signal: ctx.signal });
      const loc = locateEdit(original, input.old_string, input.new_string);
      if (!loc.ok) return null;
      return { label: input.path, oldText: original, newText: applyLocation(original, loc) };
    } catch {
      return null;
    }
  },
  async execute(input, ctx) {
    const resolved = resolveToolPath(input.path, ctx.cwd);
    if ("error" in resolved) return textResult(resolved.error, false);
    const target = resolved.path;

    let original: string;
    try {
      original = await readFile(target, { encoding: "utf8", signal: ctx.signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error reading ${input.path}: ${message}`, false);
    }

    if (input.old_string === input.new_string) {
      return textResult("old_string and new_string are identical; nothing to do.", false);
    }

    const loc = locateEdit(original, input.old_string, input.new_string);
    if (!loc.ok) {
      if (loc.reason === "ambiguous") {
        return textResult(
          `old_string matches ${loc.count} places in ${input.path}, so the edit was refused to avoid changing the wrong one. Add more surrounding lines to make it unique.`,
          false,
        );
      }
      return textResult(
        `No match for old_string in ${input.path}. Re-read the file and copy the target text verbatim from the read_file result - do not add backslashes, and keep the file's own indentation. old_string is literal text, not a regex or a quoted string.`,
        false,
      );
    }

    const updated = applyLocation(original, loc);
    try {
      await writeFile(target, updated, { encoding: "utf8", signal: ctx.signal });
      const note = loc.normalized
        ? " (old_string was matched after normalizing whitespace/escaping - copy text verbatim next time)"
        : "";
      return textResult(`Edited ${input.path} (1 occurrence replaced).${note}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error writing ${input.path}: ${message}`, false);
    }
  },
};
