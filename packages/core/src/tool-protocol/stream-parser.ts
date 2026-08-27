import type { ParserEvent, RawToolCallEnvelope } from "./types.js";

const START_XML = /<tool[_-]?call\b/gi;
const START_FENCE = /```[ \t]*(tool_call|toolcall)\b[ \t]*\n/gi;
// Accepts "</tool_call>" as documented, but also the shorter "</tool>" some models default to
// when abbreviating a closing tag — without this, a mismatched close never terminates the
// envelope, so the parser keeps consuming everything after it (including every subsequent tool
// call in the same message) as one giant unparseable body until the stream ends.
const END_XML = /<\/[ \t]*tool(?:[_-]?call)?[ \t]*>/i;
const END_FENCE = /\n?```[ \t]*(\n|$)/;
const NAME_ATTR = /name\s*=\s*["']([^"']*)["']/i;

/** Some models append a stray, never-opened closing fence marker — a bare ``` on its own line
 * with no language tag — right after `</tool_call>`, apparently out of habit even though
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

type Mode =
  | { kind: "text" }
  | {
      kind: "envelope";
      variant: "xml" | "fenced";
      declaredName: string | null;
      startRaw: string;
    };

/** Start markers only count when they open a line (optionally after leading spaces/tabs) —
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

  /** Feed a chunk of streamed text; returns events resolvable so far. */
  push(chunk: string): ParserEvent[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  /** Call once the stream has ended; flushes any remaining buffered text
   * and force-closes an unterminated envelope as an error-carrying envelope. */
  flush(): ParserEvent[] {
    const events = this.drain(true);
    if (this.mode.kind === "envelope") {
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
        this.mode.kind === "text" ? this.drainText(events, final) : this.drainEnvelope(events);
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

    const xmlMatch = findAnchoredMatch(START_XML, this.buffer, this.precedingChar);
    const fenceMatch = findAnchoredMatch(START_FENCE, this.buffer, this.precedingChar);

    const candidate = pickEarlier(xmlMatch, fenceMatch);
    if (!candidate) {
      if (final) {
        return false; // let flush() emit the remaining buffer as plain text
      }
      const safeLen = Math.max(0, this.buffer.length - SAFE_TAIL_RESERVE);
      if (safeLen > 0) {
        const text = this.consumeFront(safeLen);
        events.push({ type: "text", text });
      }
      return false;
    }

    const [match, variant] = candidate;
    const matchStart = match.index;

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

  private drainEnvelope(events: ParserEvent[]): boolean {
    if (this.mode.kind !== "envelope") return false;
    const endRegex = this.mode.variant === "xml" ? END_XML : END_FENCE;
    const match = endRegex.exec(this.buffer);

    if (!match) {
      if (this.buffer.length > MAX_ENVELOPE_CHARS) {
        // runaway unterminated envelope — force-close it now so the caller can surface an error
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

function pickEarlier(
  xmlMatch: RegExpExecArray | null,
  fenceMatch: RegExpExecArray | null,
): [RegExpExecArray, "xml" | "fenced"] | null {
  if (xmlMatch && fenceMatch) {
    return xmlMatch.index <= fenceMatch.index ? [xmlMatch, "xml"] : [fenceMatch, "fenced"];
  }
  if (xmlMatch) return [xmlMatch, "xml"];
  if (fenceMatch) return [fenceMatch, "fenced"];
  return null;
}
