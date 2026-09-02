import { jsonrepair } from "jsonrepair";

/**
 * Qwen/DeepSeek-family models habitually wrap a tool-call body in a markdown code fence or an
 * XML-ish `<syntax>` / `<block>` / `<code>` tag, even when the prompt tells them not to. When
 * such a wrapper encloses the *entire* body it carries no information - the body was always
 * meant to be bare JSON - so peeling it here is deterministic and lossless. Without this a 7B
 * model loops (parse error → correction it won't follow → same output) and gives up.
 *
 * Only a wrapper around the whole (trimmed) body is stripped: valid JSON starts with `{`/`[`,
 * so a leading fence/tag can't be real content, and it ends with `}`/`]`, so a trailing fence
 * or `</tag>` line can't be either. A dropped closing fence (truncated output) still gets its
 * opening line removed.
 */
function stripEnclosingWrapper(text: string): string {
  let s = text.trim();
  // Peel repeatedly: a fence nested inside a tag, or stacked tags, both show up in the wild.
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      .replace(/^(?:`{3,}|~{3,})[^\n]*(?:\n|$)/, "")
      .replace(/(?:\n|^)[ \t]*(?:`{3,}|~{3,})[ \t]*$/, "")
      .replace(/^<(?:syntax|block|code|json)\b[^>]*>\s*/i, "")
      .replace(/\s*<\/(?:syntax|block|code|json)>\s*$/i, "")
      .trim();
    if (s === before) break;
  }
  return s;
}

/** Tries increasingly aggressive strategies to coerce near-miss JSON text into a parsed object. */
export function repairJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = stripEnclosingWrapper(text);
  if (trimmed.length === 0) {
    return { ok: false, error: "empty body" };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // fall through to repair
  }

  try {
    const repaired = jsonrepair(trimmed);
    const value = JSON.parse(repaired);
    // jsonrepair's last resort for text with no JSON structure at all is to quote-wrap
    // it into a bare string - that's not a useful "repair" for a tool-call body, which
    // is always meant to be an object, so treat it the same as a failed repair and keep
    // trying the looser fallback below instead of accepting a wrapped string verbatim.
    if (!(typeof value === "string" && value === trimmed)) {
      return { ok: true, value };
    }
  } catch {
    // fall through to regex fallback
  }

  const fallback = extractLooseKeyValuePairs(trimmed);
  if (fallback) {
    return { ok: true, value: fallback };
  }

  return { ok: false, error: "could not parse body as JSON, even after repair" };
}

/** Last-resort extraction for bodies that look like YAML/Python-dict rather than JSON,
 * e.g. `path: src/app.ts` or `path = 'src/app.ts'` lines. */
function extractLooseKeyValuePairs(text: string): Record<string, unknown> | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const pairRegex = /^["']?([\w-]+)["']?\s*[:=]\s*(.+)$/;
  const result: Record<string, unknown> = {};
  let matchedAny = false;

  for (const line of lines) {
    const match = pairRegex.exec(line);
    if (!match) continue;
    matchedAny = true;
    const key = match[1] as string;
    const rawValue = (match[2] as string).replace(/,\s*$/, "").trim();
    result[key] = coerceScalar(rawValue);
  }

  return matchedAny ? result : null;
}

function coerceScalar(raw: string): unknown {
  const unquoted = raw.replace(/^["']|["']$/g, "");
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (unquoted === "null" || unquoted === "None") return null;
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}
