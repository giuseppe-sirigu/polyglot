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
  const original = text.trim();
  let s = original;
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
  // A single-line wrapper (```json{...}``` with no newline) would otherwise be eaten whole.
  return s.length > 0 ? s : original;
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

  const blob = extractTrailingBlobField(trimmed);
  if (blob) {
    return { ok: true, value: blob };
  }

  return { ok: false, error: "could not parse body as JSON, even after repair" };
}

function strictObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not strict JSON
  }
  return null;
}

/**
 * Last resort for `{"path": "...", "content": "<a whole file, quotes and newlines
 * unescaped>"}` - the dominant `write_file` failure from weaker models. Walks the `"key":`
 * markers left to right, keeping the last one whose preceding text still closes into a valid
 * object; everything after that key is taken as the raw value (JSON-parse and jsonrepair have
 * already given up on it as a whole). A `"x":` *inside* the unescaped blob doesn't fool it,
 * because by then the head no longer parses. Returns null unless a clean head and a
 * string-shaped tail are found, so a genuinely different malformation still errors.
 */
function extractTrailingBlobField(text: string): Record<string, unknown> | null {
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const inner = text.slice(1, -1);

  const keyRe = /(?:^|,)\s*"([A-Za-z_]\w*)"\s*:\s*/g;
  let scalars: Record<string, unknown> | null = null;
  let blobKey = "";
  let valueStart = -1;
  for (let m = keyRe.exec(inner); m !== null; m = keyRe.exec(inner)) {
    const headText = `{${inner.slice(0, m.index).replace(/,\s*$/, "")}}`;
    const head = strictObject(headText);
    if (!head) break;
    scalars = head;
    blobKey = m[1] as string;
    valueStart = m.index + m[0].length;
  }
  if (!scalars || valueStart < 0) return null;

  let raw = inner.slice(valueStart).replace(/,\s*$/, "").trim();
  const quote = raw[0];
  if (!(quote === '"' || quote === "'" || quote === "`") || raw.length < 2) return null;
  raw = raw.slice(1);
  if (raw.endsWith(quote)) raw = raw.slice(0, -1);

  // If a real trailing scalar field is still sitting in `raw`, the blob wasn't last and we
  // over-consumed - bail rather than write a file with `", "path": "..."` glued on the end.
  if (/["'`]\s*,\s*"[A-Za-z_]\w*"\s*:\s*["'`]/.test(raw)) return null;

  raw = stripEnclosingWrapper(raw);
  // A model that flattened the string to one line with `\n` escapes but then broke the
  // quoting: unescape what it clearly meant. A value with real newlines is already literal.
  if (!raw.includes("\n") && /\\[nrt]/.test(raw)) {
    raw = raw
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  raw = raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  return { ...scalars, [blobKey]: raw };
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
