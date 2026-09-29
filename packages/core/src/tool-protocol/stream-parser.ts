import type { ParserEvent, RawToolCallEnvelope } from "./types.js";

const START_XML = /<tool[_-]?call\b/gi;
const START_FENCE = /```[ \t]*(tool_call|toolcall)\b[ \t]*\n/gi;
// Accepts "</tool_call>" as documented, but also the shorter "</tool>" some models default to
// when abbreviating a closing tag, and "</tool_result>" (seen live on qwen3.8-27b: a model
// that blends its own natively-trained closing tag with our prompted <tool_call> convention) -
// without this, a mismatched close never terminates the envelope, so the parser keeps consuming
// everything after it (including every subsequent tool call in the same message) as one giant
// unparseable body until the stream ends.
// A closing tag that repeats the opening tag's attributes (`</tool_call name="read_file">`, seen
// live on qwen2.5-coder) is still a close - without allowing them the envelope never ended and
// the body swallowed the closing tag into the last argument's value.
const END_XML = /<\/[ \t]*tool(?:[_-]?(?:call|result))?\b[^>\n]*>/i;
const END_FENCE = /\n?```[ \t]*(\n|$)/;
const NAME_ATTR = /name\s*=\s*["']([^"']*)["']/i;
/** A ```json fence - only treated as a tool call when its body names a known tool (checked
 * once the fence closes), so ordinary JSON shown to the user stays text. */
const START_JSON_FENCE = /```[ \t]*json[ \t]*\n/gi;
const NAME_ALIAS_FIELD = /"(?:name|tool|function|tool_name)"\s*:\s*"([^"]+)"/;

/** Some models append a stray, never-opened closing fence marker - a bare ``` on its own line
 * with no language tag - right after `</tool_call>`, apparently out of habit even though
 * nothing was ever fenced. Left in the text stream, that marker pairs up with whatever real
 * ``` fence comes next in the message and desyncs fence rendering for the rest of it. Matched
 * only when bare (no language) since a deliberate fence almost always carries one. */
const STRAY_FENCE_AFTER_ENVELOPE = /^\n?[ \t]*```[ \t]*\n/;
/** Bound on how long to wait, buffered, for a still-arriving stray-fence line to resolve one
 * way or the other before giving up and treating the buffer as ordinary text. */
const STRAY_FENCE_MAX_LOOKAHEAD = 24;

/** Reserve this many trailing chars unflushed while scanning for a start marker,
 * so a marker split across two stream chunks (e.g. "<tool_c" | "all name=...") isn't missed. */
const SAFE_TAIL_RESERVE = 20;

/** Hard cap on envelope body size so a model that never closes its tag can't buffer forever. */
const MAX_ENVELOPE_CHARS = 500_000;

export interface ToolCallStreamParserOptions {
  /** The registered tool names. When given, the parser also recognises calls written in forms
   * models are natively trained on rather than our `<tool_call>` grammar:
   * - the tool name as the tag: `<edit_file>{...}</edit_file>`
   * - the tool name glued to its JSON arguments, optionally with Mistral's special markers:
   *   `read_file{"path": "a"}`, `[TOOL_CALLS]read_file[ARGS]{"path": "a"}` (Devstral through
   *   Ollama, which strips the markers but leaves the rest - often mid-sentence)
   * - a ```json fence whose body names a known tool: `{"name": "bash", "arguments": {...}}`
   * Every form is keyed on an exact registered name, so prose that merely mentions JSON or a
   * tool is left as text. */
  toolNames?: string[];
}

type Mode =
  | { kind: "text" }
  | {
      kind: "envelope";
      variant: "xml" | "fenced";
      declaredName: string | null;
      startRaw: string;
      /** Close pattern for a tool-name tag (`</edit_file>`); defaults to the variant's own. */
      end?: RegExp;
      /** A ```json fence: only an envelope if its body names a known tool, else plain text. */
      jsonFenceCandidate?: boolean;
    }
  | { kind: "bare"; declaredName: string; startRaw: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index just past the `}` that closes the JSON object starting at `text[0]` (which must be
 * `{`), tracking string literals so braces inside strings don't count; -1 if not closed yet. */
function balancedObjectEnd(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Start markers only count when they open a line (optionally after leading spaces/tabs) -
 * this is what tells "<tool_call> tag" mentioned mid-sentence apart from a real invocation. */
function isAtLineStart(buffer: string, index: number, precedingChar: string | null): boolean {
  let i = index;
  while (i > 0 && (buffer[i - 1] === " " || buffer[i - 1] === "\t")) i--;
  if (i === 0) return precedingChar === null || precedingChar === "\n";
  return buffer[i - 1] === "\n";
}

/** Finds the earliest match of `regex` in `buffer` that actually opens a line, skipping
 * over any mid-sentence occurrences of the same literal text. */
function findAnchoredMatch(
  regex: RegExp,
  buffer: string,
  precedingChar: string | null,
): RegExpExecArray | null {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(buffer);
  while (match !== null) {
    if (isAtLineStart(buffer, match.index, precedingChar)) return match;
    if (regex.lastIndex === match.index) regex.lastIndex++;
    match = regex.exec(buffer);
  }
  return null;
}

export class ToolCallStreamParser {
  private buffer = "";
  private mode: Mode = { kind: "text" };
  /** The character immediately preceding buffer[0] in the logical stream, or null if
   * buffer[0] truly is the start of the stream. Needed because the buffer's front gets
   * sliced away as text is flushed, so buffer[0] alone can't tell a real line start
   * from an arbitrary slice boundary that happens to land mid-line. */
  private precedingChar: string | null = null;
  /** Set right after an xml-variant envelope closes; makes the next drainText() pass check for
   * (and swallow) a stray fence marker before resuming normal text scanning. */
  private pendingStrayFenceCheck = false;
  private readonly toolNames: Set<string>;
  /** `<edit_file>` / `<edit_file attr>` - a registered tool name used as the tag. */
  private readonly startNameTag: RegExp | null;
  /** `read_file{"` / `[TOOL_CALLS]read_file[ARGS]{"` - name glued to a JSON object. */
  private readonly startBare: RegExp | null;
  private readonly tailReserve: number;

  constructor(options: ToolCallStreamParserOptions = {}) {
    const names = (options.toolNames ?? []).filter((n) => /^[\w-]+$/.test(n));
    this.toolNames = new Set(names);
    if (names.length > 0) {
      // Longest first so `read_file_range` wins over `read_file` in the alternation.
      const alt = [...names]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|");
      this.startNameTag = new RegExp(`<(${alt})(?=[\\s>])[^>\\n]*>`, "gi");
      this.startBare = new RegExp(
        `(?:\\[TOOL_CALLS\\][ \\t]*)?\\b(${alt})(?:\\[ARGS\\])?[ \\t]*(?=\\{[ \\t\\n]*")`,
        "g",
      );
      const longest = Math.max(...names.map((n) => n.length));
      this.tailReserve = Math.max(SAFE_TAIL_RESERVE, longest + 24);
    } else {
      this.startNameTag = null;
      this.startBare = null;
      this.tailReserve = SAFE_TAIL_RESERVE;
    }
  }

  /** Feed a chunk of streamed text; returns events resolvable so far. */
  push(chunk: string): ParserEvent[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  /** Call once the stream has ended; flushes any remaining buffered text
   * and force-closes an unterminated envelope as an error-carrying envelope. */
  flush(): ParserEvent[] {
    const events = this.drain(true);
    if (this.mode.kind === "bare") {
      // The object never closed: hand what there is to the resolver, which can still repair it.
      events.push({
        type: "envelope",
        envelope: {
          variant: "xml",
          declaredName: this.mode.declaredName,
          body: this.buffer,
          raw: this.mode.startRaw + this.buffer,
        },
      });
      this.buffer = "";
      this.mode = { kind: "text" };
    } else if (this.mode.kind === "envelope" && this.mode.jsonFenceCandidate) {
      // An unclosed ```json fence at end of stream: it was never a tool call, just text.
      events.push({ type: "text", text: this.mode.startRaw + this.buffer });
      this.buffer = "";
      this.mode = { kind: "text" };
    } else if (this.mode.kind === "envelope") {
      const envelope: RawToolCallEnvelope = {
        variant: this.mode.variant,
        declaredName: this.mode.declaredName,
        body: this.buffer,
        raw: this.mode.startRaw + this.buffer,
      };
      events.push({ type: "envelope", envelope });
      this.buffer = "";
      this.mode = { kind: "text" };
    } else if (this.buffer.length > 0) {
      events.push({ type: "text", text: this.buffer });
      this.buffer = "";
    }
    return events;
  }

  /** Removes and returns the first `n` characters of the buffer, keeping
   * `precedingChar` bookkeeping consistent for the line-start anchor check. */
  private consumeFront(n: number): string {
    const consumed = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    if (consumed.length > 0) {
      this.precedingChar = consumed[consumed.length - 1] as string;
    }
    return consumed;
  }

  private drain(final: boolean): ParserEvent[] {
    const events: ParserEvent[] = [];

    let progressed = true;
    while (progressed) {
      progressed =
        this.mode.kind === "text"
          ? this.drainText(events, final)
          : this.mode.kind === "bare"
            ? this.drainBare(events)
            : this.drainEnvelope(events, final);
    }

    return events;
  }

  private drainText(events: ParserEvent[], final: boolean): boolean {
    if (this.pendingStrayFenceCheck) {
      const match = STRAY_FENCE_AFTER_ENVELOPE.exec(this.buffer);
      if (match) {
        this.pendingStrayFenceCheck = false;
        this.consumeFront(match[0].length);
        return true;
      }
      if (!final && this.buffer.length < STRAY_FENCE_MAX_LOOKAHEAD) {
        return false; // not enough buffered yet to know either way
      }
      this.pendingStrayFenceCheck = false; // resolved: not a stray fence, fall through as text
    }

    const candidate = pickEarliest([
      [findAnchoredMatch(START_XML, this.buffer, this.precedingChar), "xml"],
      [findAnchoredMatch(START_FENCE, this.buffer, this.precedingChar), "fenced"],
      [
        this.toolNames.size > 0
          ? findAnchoredMatch(START_JSON_FENCE, this.buffer, this.precedingChar)
          : null,
        "jsonFence",
      ],
      [
        this.startNameTag
          ? findAnchoredMatch(this.startNameTag, this.buffer, this.precedingChar)
          : null,
        "nameTag",
      ],
      // Not line-anchored on purpose: Devstral glues the call straight onto its prose.
      [this.startBare ? firstMatch(this.startBare, this.buffer) : null, "bare"],
    ]);
    if (!candidate) {
      if (final) {
        return false; // let flush() emit the remaining buffer as plain text
      }
      const safeLen = Math.max(0, this.buffer.length - this.tailReserve);
      if (safeLen > 0) {
        const text = this.consumeFront(safeLen);
        events.push({ type: "text", text });
      }
      return false;
    }

    const [match, variant] = candidate;
    const matchStart = match.index;

    if (variant === "bare") {
      if (matchStart > 0) events.push({ type: "text", text: this.consumeFront(matchStart) });
      const marker = this.consumeFront(match[0].length);
      this.mode = { kind: "bare", declaredName: match[1] as string, startRaw: marker };
      return true;
    }

    if (variant === "nameTag") {
      const name = match[1] as string;
      if (matchStart > 0) events.push({ type: "text", text: this.consumeFront(matchStart) });
      const openTag = this.consumeFront(match[0].length);
      this.mode = {
        kind: "envelope",
        variant: "xml",
        declaredName: name,
        startRaw: openTag,
        end: new RegExp(`<\\/[ \\t]*${escapeRegExp(name)}[ \\t]*>|${END_XML.source}`, "i"),
      };
      return true;
    }

    if (variant === "jsonFence") {
      if (matchStart > 0) events.push({ type: "text", text: this.consumeFront(matchStart) });
      const fenceOpen = this.consumeFront(match[0].length);
      this.mode = {
        kind: "envelope",
        variant: "fenced",
        declaredName: null,
        startRaw: fenceOpen,
        jsonFenceCandidate: true,
      };
      return true;
    }

    if (variant === "xml") {
      const closeIdx = this.buffer.indexOf(">", matchStart);
      if (closeIdx === -1) {
        if (!final) return false; // wait for the rest of the opening tag
        // malformed/unterminated opening tag at end of stream: treat as plain text
        const text = this.consumeFront(this.buffer.length);
        events.push({ type: "text", text });
        return false;
      }
      if (matchStart > 0) {
        const text = this.consumeFront(matchStart);
        events.push({ type: "text", text });
      }
      const openTag = this.consumeFront(closeIdx - matchStart + 1);
      const nameMatch = NAME_ATTR.exec(openTag);
      this.mode = {
        kind: "envelope",
        variant: "xml",
        declaredName: nameMatch?.[1] ?? null,
        startRaw: openTag,
      };
      return true;
    }

    // fenced variant: the whole matched string already includes the trailing newline
    const fenceOpenLength = match[0].length;
    if (matchStart > 0) {
      const text = this.consumeFront(matchStart);
      events.push({ type: "text", text });
    }
    const fenceOpen = this.consumeFront(fenceOpenLength);
    this.mode = { kind: "envelope", variant: "fenced", declaredName: null, startRaw: fenceOpen };
    return true;
  }

  private drainBare(events: ParserEvent[]): boolean {
    if (this.mode.kind !== "bare") return false;
    const end = balancedObjectEnd(this.buffer);
    if (end === -1) {
      if (this.buffer.length > MAX_ENVELOPE_CHARS) {
        const body = this.consumeFront(this.buffer.length);
        events.push({
          type: "envelope",
          envelope: {
            variant: "xml",
            declaredName: this.mode.declaredName,
            body,
            raw: this.mode.startRaw + body,
          },
        });
        this.mode = { kind: "text" };
        return true;
      }
      return false; // wait for the object to close
    }
    const body = this.consumeFront(end);
    events.push({
      type: "envelope",
      envelope: {
        variant: "xml",
        declaredName: this.mode.declaredName,
        body,
        raw: this.mode.startRaw + body,
      },
    });
    this.mode = { kind: "text" };
    return true;
  }

  private drainEnvelope(events: ParserEvent[], final: boolean): boolean {
    if (this.mode.kind !== "envelope") return false;
    const endRegex = this.mode.end ?? (this.mode.variant === "xml" ? END_XML : END_FENCE);
    let match = endRegex.exec(this.buffer);
    // A closing fence matched against the end of the buffer (`$`, not a newline) may just be a
    // chunk boundary - the newline that belongs to it can still arrive. Wait unless the stream
    // has ended, so the result doesn't depend on where the network split the text.
    if (
      match &&
      !final &&
      match[1] === "" &&
      match.index + match[0].length === this.buffer.length
    ) {
      match = null;
    }

    if (match && this.mode.jsonFenceCandidate) {
      const closeRaw = match[0];
      const body = this.consumeFront(match.index);
      this.consumeFront(closeRaw.length);
      const named = NAME_ALIAS_FIELD.exec(body)?.[1];
      if (named && this.toolNames.has(named)) {
        events.push({
          type: "envelope",
          envelope: {
            variant: "fenced",
            declaredName: null,
            body,
            raw: this.mode.startRaw + body + closeRaw,
          },
        });
      } else {
        events.push({ type: "text", text: this.mode.startRaw + body + closeRaw });
      }
      this.mode = { kind: "text" };
      return true;
    }

    if (!match) {
      if (this.buffer.length > MAX_ENVELOPE_CHARS) {
        // runaway unterminated envelope - force-close it now so the caller can surface an error
        const envelope: RawToolCallEnvelope = {
          variant: this.mode.variant,
          declaredName: this.mode.declaredName,
          body: this.buffer,
          raw: this.mode.startRaw + this.buffer,
        };
        events.push({ type: "envelope", envelope });
        this.consumeFront(this.buffer.length);
        this.mode = { kind: "text" };
        return true;
      }
      return false;
    }

    const closeRaw = match[0];
    const body = this.consumeFront(match.index);
    this.consumeFront(closeRaw.length);
    const envelope: RawToolCallEnvelope = {
      variant: this.mode.variant,
      declaredName: this.mode.declaredName,
      body,
      raw: this.mode.startRaw + body + closeRaw,
    };
    events.push({ type: "envelope", envelope });
    if (this.mode.variant === "xml") this.pendingStrayFenceCheck = true;
    this.mode = { kind: "text" };
    return true;
  }
}

type StartVariant = "xml" | "fenced" | "jsonFence" | "nameTag" | "bare";

/** The earliest match; on a tie the earlier entry in `candidates` wins, so the documented
 * `<tool_call>` grammar always takes precedence over the looser native-format patterns. */
function pickEarliest(
  candidates: [RegExpExecArray | null, StartVariant][],
): [RegExpExecArray, StartVariant] | null {
  let best: [RegExpExecArray, StartVariant] | null = null;
  for (const [match, variant] of candidates) {
    if (match && (!best || match.index < best[0].index)) best = [match, variant];
  }
  return best;
}

function firstMatch(regex: RegExp, buffer: string): RegExpExecArray | null {
  regex.lastIndex = 0;
  return regex.exec(buffer);
}
