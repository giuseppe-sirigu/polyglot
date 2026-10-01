import type { ParserEvent, RawToolCallEnvelope } from "./types.js";

const START_XML = /<tool[_-]?call\b/gi;
/** A `<tool_call` at the end of the buffer whose tag, or the JSON after it, hasn't arrived yet. */
const PENDING_GLUED_XML = /<tool[_-]?call\b(?:[^>\n]*|[^>\n]*>\s*)$/i;
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
/** Inside a call, the model has started writing the next turn itself - a bare `</` line, a
 * `user>` line, or an opening `<tool_result` (seen live on qwen2.5-coder:32b, where the
 * envelope ran on through an invented tool result and all of it was written into a file).
 * None of these is ever part of a call's arguments, so the call ends there. */
const RUNAWAY_TURN =
  /\n[ \t]*<\/[ \t]*\n|\n[ \t]*(?:user|assistant|system)>?[ \t]*\n|\n[ \t]*<tool_result\b/;
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
      /** Arguments written as attributes on a tool-name tag; used when the body is empty
       * (`<glob pattern="*.json"></glob>`, seen live on Devstral). */
      attrArgs?: Record<string, string>;
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
      // `<glob>`, `<glob_call name="glob">`, self-closing `<glob pattern="*"/>` (Devstral).
      // Also an invented suffix (`<glob_pattern>`, Devstral) - accepted only with JSON after it.
      this.startNameTag = new RegExp(`<(${alt})(?:[_-]([a-z]+))?(?=[\\s>/])[^>\\n]*>`, "gi");
      // `glob{"`, `glob {"`, `glob>\n{"` (a dropped `<`), `[TOOL_CALLS]glob[ARGS]{"`, `glob.call({"`,
      // `glob_call name="glob">\n{"` (a dropped `<` on an attribute tag).
      this.startBare = new RegExp(
        // Second branch: glued onto the previous word (`main.mjsedit_file>{`, Devstral) - only in
        // the explicit `name>` / `name[ARGS]` forms, so a word merely ending in a tool name stays text.
        // Separators seen live on Devstral: none, `[ARGS]`, `>`, `=`, `:`, and a `(` around the JSON.
        `(?:\\[TOOL_CALLS\\][ \\t]*)?(?:\\b(${alt})(?:\\[ARGS\\]|\\.call|[>=:])?|(${alt})(?:\\[ARGS\\]|(?:_call\\b[^>\\n]*)?>))[ \\t]*\\n?[ \\t]*(?:\\([ \\t]*\\n?[ \\t]*)?(?=\\{[ \\t\\n]*")`,
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
        // A closing tag cut off by the end of the stream (`</edit_file` with no `>`, seen
        // live on Devstral) is not part of the arguments.
        body: this.buffer.replace(/<\/[\w-]*[ \t]*$/, ""),
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
      [this.findXmlStart(), "xml"],
      [findAnchoredMatch(START_FENCE, this.buffer, this.precedingChar), "fenced"],
      [
        this.toolNames.size > 0
          ? findAnchoredMatch(START_JSON_FENCE, this.buffer, this.precedingChar)
          : null,
        "jsonFence",
      ],
      [this.startNameTag ? this.findNameTag() : null, "nameTag"],
      // Not line-anchored on purpose: Devstral glues the call straight onto its prose.
      [this.startBare ? firstMatch(this.startBare, this.buffer) : null, "bare"],
    ]);
    if (!candidate) {
      if (final) {
        return false; // let flush() emit the remaining buffer as plain text
      }
      let safeLen = Math.max(0, this.buffer.length - this.tailReserve);
      // A tool-name tag can be longer than the tail reserve (a self-closing tag carrying a
      // whole command as an attribute): never flush past a `<` whose tag hasn't closed yet.
      if (this.startNameTag) {
        const open = this.buffer.lastIndexOf("<");
        const rest = open >= 0 ? this.buffer.slice(open) : "";
        if (open >= 0 && /^<[\w-]*$|^<[\w-]+[ \t/]/.test(rest) && !/[>\n]/.test(rest)) {
          safeLen = Math.min(safeLen, open);
        }
      }
      // A `<tool_call` glued onto prose may still turn out to be a call once its JSON arrives.
      const gluedTag = this.buffer.search(PENDING_GLUED_XML);
      if (gluedTag >= 0) safeLen = Math.min(safeLen, gluedTag);
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
      this.mode = {
        kind: "bare",
        declaredName: (match[1] ?? match[2]) as string,
        startRaw: marker,
      };
      return true;
    }

    if (variant === "nameTag") {
      const tagName = match[1] as string;
      if (matchStart > 0) events.push({ type: "text", text: this.consumeFront(matchStart) });
      const openTag = this.consumeFront(match[0].length);
      const attrName = NAME_ATTR.exec(openTag)?.[1];
      const declaredName = attrName && this.toolNames.has(attrName) ? attrName : tagName;
      if (openTag.endsWith("/>")) {
        // Self-closing, arguments as attributes: the whole call is the tag.
        const args = tagAttributes(openTag);
        events.push({
          type: "envelope",
          envelope: { variant: "xml", declaredName, body: JSON.stringify(args), raw: openTag },
        });
        return true;
      }
      this.mode = {
        kind: "envelope",
        variant: "xml",
        declaredName,
        startRaw: openTag,
        attrArgs: tagAttributes(openTag),
        end: new RegExp(
          `<\\/[ \\t]*${escapeRegExp(tagName)}(?:[_-][a-z]+)?[ \\t]*>|${END_XML.source}`,
          "i",
        ),
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

  /** A tool-name tag counts when it opens a line, when it is self-closing with attributes, or
   * when a JSON object follows it - the last two may sit mid-sentence (Devstral writes
   * `...to "sum"<edit_file name="edit_file">{...}`). A tag at the very end of the buffer that
   * needs the following text to decide is skipped until more arrives. */
  /** `<tool_call>` opening a line, or glued onto prose (`util.mjs:<tool_call name="edit_file">`,
   * seen on Devstral) when JSON arguments follow the tag - a mention mid-sentence has none. */
  private findXmlStart(): RegExpExecArray | null {
    START_XML.lastIndex = 0;
    for (let m = START_XML.exec(this.buffer); m !== null; m = START_XML.exec(this.buffer)) {
      if (isAtLineStart(this.buffer, m.index, this.precedingChar)) return m;
      const close = this.buffer.indexOf(">", m.index);
      const tag = close === -1 ? "" : this.buffer.slice(m.index, close);
      if (
        close !== -1 &&
        !tag.includes("\n") &&
        this.buffer
          .slice(close + 1)
          .trimStart()
          .startsWith("{")
      ) {
        return m;
      }
    }
    return null;
  }

  private findNameTag(): RegExpExecArray | null {
    const regex = this.startNameTag as RegExp;
    regex.lastIndex = 0;
    for (let m = regex.exec(this.buffer); m !== null; m = regex.exec(this.buffer)) {
      const after = this.buffer.slice(m.index + m[0].length).trimStart();
      const jsonFollows = after.startsWith("{");
      // An invented suffix (`<glob_pattern>`) is only a call when its JSON arguments follow.
      if (m[2] && m[2].toLowerCase() !== "call") {
        if (jsonFollows) return m;
      } else {
        if (isAtLineStart(this.buffer, m.index, this.precedingChar)) return m;
        if (m[0].endsWith("/>") && m[0].includes("=")) return m;
        if (jsonFollows) return m;
      }
      if (regex.lastIndex === m.index) regex.lastIndex++;
    }
    return null;
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
    if (this.mode.variant === "xml") {
      const runaway = RUNAWAY_TURN.exec(this.buffer);
      if (runaway && (!match || runaway.index < match.index)) {
        const body = this.consumeFront(runaway.index);
        // A bare `</` line is the call's own broken close; anything else is invented
        // conversation, left as text so it stays visible.
        if (/^\n[ \t]*<\/[ \t]*\n$/.test(runaway[0])) this.consumeFront(runaway[0].length);
        events.push({
          type: "envelope",
          envelope: {
            variant: this.mode.variant,
            declaredName: this.mode.declaredName,
            body,
            raw: this.mode.startRaw + body,
          },
        });
        this.mode = { kind: "text" };
        return true;
      }
    }
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
    const attrArgs = this.mode.attrArgs;
    const useAttrs = body.trim() === "" && attrArgs && Object.keys(attrArgs).length > 0;
    const envelope: RawToolCallEnvelope = {
      variant: this.mode.variant,
      declaredName: this.mode.declaredName,
      body: useAttrs ? JSON.stringify(attrArgs) : body,
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

const TAG_ATTRIBUTE = /([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;

/** The attributes of a self-closing call tag as arguments, minus `name` (the tool itself):
 * `<bash command="find . -name \"*.json\""/>` → `{"command": "find . -name \"*.json\""}`. */
function tagAttributes(tag: string): Record<string, string> {
  const args: Record<string, string> = {};
  TAG_ATTRIBUTE.lastIndex = 0;
  for (let m = TAG_ATTRIBUTE.exec(tag); m !== null; m = TAG_ATTRIBUTE.exec(tag)) {
    const key = m[1] as string;
    if (key === "name") continue;
    args[key] = m[2] !== undefined ? m[2].replace(/\\(["\\])/g, "$1") : (m[3] ?? "");
  }
  return args;
}

function firstMatch(regex: RegExp, buffer: string): RegExpExecArray | null {
  regex.lastIndex = 0;
  return regex.exec(buffer);
}
