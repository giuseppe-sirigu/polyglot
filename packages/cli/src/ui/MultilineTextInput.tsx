import chalk from "chalk";
import { Box, Text, useInput, useStdin } from "ink";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { SlashCommand } from "./slashCommands.js";

export interface MultilineTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** Live `/`-command matches for the text currently being typed (InputBar computes these from
   * `value`) - while non-empty, up/down/tab are reclaimed for navigating/accepting a suggestion
   * instead of their normal cursor-movement/no-op behavior. Accepting is done here (not by
   * InputBar pushing a new `value` down) because this component owns its text as internal,
   * uncontrolled state (`stateRef`) - it only reads the `value` prop once, at mount, so nothing
   * external can inject text into it after that; only its own `apply()` can. */
  suggestions?: SlashCommand[];
  highlightedSuggestionIndex?: number;
  onNavigateSuggestions?: (direction: -1 | 1) => void;
}

// Escape sequences a terminal sends for the literal Home/End keys, taken from Ink's own
// parse-keypress.js keyName table - Ink's public useInput() never exposes home/end as flags,
// so these are read directly off the raw input stream that useInput is itself built on.
const HOME_SEQUENCES = ["\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~"];
const END_SEQUENCES = ["\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~"];

// Ink's parser (parse-keypress.js) maps the physical Backspace key's byte (0x7f, sent by
// most terminals including tmux's "BSpace") to `key.name === 'delete'` - the same name it
// gives the physical Delete key's sequence (\x1b[3~ and rxvt/putty variants). `key.backspace`
// only fires for the raw \b/\x08 byte, which almost no physical key actually sends. So Ink's
// public delete/backspace flags cannot tell these two keys apart - read the raw bytes instead.
const BACKSPACE_SEQUENCES = ["\x7f", "\b"];
const FORWARD_DELETE_SEQUENCES = ["\x1b[3~", "\x1b[3$", "\x1b[3^"];

function lineBounds(text: string, offset: number): [start: number, end: number] {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const nextBreak = text.indexOf("\n", offset);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return [start, end];
}

function moveVertical(text: string, offset: number, direction: -1 | 1): number {
  const lines = text.split("\n");
  let runningOffset = 0;
  let lineIndex = 0;
  let column = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (offset <= runningOffset + line.length) {
      lineIndex = i;
      column = offset - runningOffset;
      break;
    }
    runningOffset += line.length + 1;
  }

  const targetIndex = lineIndex + direction;
  if (targetIndex < 0 || targetIndex >= lines.length) return offset;

  let targetOffset = 0;
  for (let i = 0; i < targetIndex; i++) {
    targetOffset += (lines[i]?.length ?? 0) + 1;
  }
  const targetLine = lines[targetIndex] ?? "";
  return targetOffset + Math.min(column, targetLine.length);
}

export function MultilineTextInput({
  value,
  onChange,
  onSubmit,
  suggestions = [],
  highlightedSuggestionIndex = 0,
  onNavigateSuggestions,
}: MultilineTextInputProps) {
  // Mutated synchronously (not via setState) so a burst of keypresses delivered within a
  // single React batch - e.g. several escape sequences arriving in one stdin chunk - each see
  // the previous keypress's result instead of racing on a stale render-time closure.
  const stateRef = useRef({ text: value, cursor: value.length });
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const { internal_eventEmitter } = useStdin();

  const apply = useCallback(
    (nextText: string, nextCursor: number) => {
      const changed = nextText !== stateRef.current.text;
      stateRef.current = { text: nextText, cursor: nextCursor };
      if (changed) onChange(nextText);
      bump();
    },
    [onChange],
  );

  useInput((input, key) => {
    const { text, cursor } = stateRef.current;

    if (suggestions.length > 0) {
      if (key.upArrow) {
        onNavigateSuggestions?.(-1);
        return;
      }
      if (key.downArrow) {
        onNavigateSuggestions?.(1);
        return;
      }
      // Not key.shift too - Shift+Tab is the global permission-mode cycle handled in App.tsx,
      // and Ink delivers every keypress to every active useInput() with no way to stop that, so
      // this must explicitly stay out of Shift+Tab's way rather than also firing alongside it.
      if (key.tab && !key.shift) {
        const chosen = suggestions[highlightedSuggestionIndex];
        if (chosen) apply(`${chosen.command} `, chosen.command.length + 1);
        return;
      }
      // Enter accepts whichever suggestion is highlighted, same as Tab. For a command that
      // takes an argument (e.g. "/rename"), that just fills it into the input - running it
      // immediately would skip the chance to type the argument - so only run right away when
      // the command needs nothing more.
      if (key.return) {
        const chosen = suggestions[highlightedSuggestionIndex];
        if (chosen) {
          if (chosen.takesArgument) {
            apply(`${chosen.command} `, chosen.command.length + 1);
          } else {
            onSubmit(chosen.command);
            apply("", 0);
          }
          return;
        }
      }
    }

    if (key.return) {
      onSubmit(text);
      apply("", 0);
      return;
    }

    // Alt+Enter arrives as the 2-byte sequence ESC+CR: Ink can't tell it apart from other
    // escape-prefixed input at the key-name level, so `key.return` stays false (a real Enter
    // sets it true) while `input` collapses to a bare "\r" - that combination is what
    // distinguishes this case from everything else.
    if (input === "\r") {
      apply(`${text.slice(0, cursor)}\n${text.slice(cursor)}`, cursor + 1);
      return;
    }

    // Backspace/Delete are handled entirely by the raw-stream listener below, since Ink's
    // key.delete/key.backspace flags can't distinguish the two physical keys (see above). Both
    // land here with `input === ''` (they're in Ink's nonAlphanumericKeys list), so falling
    // through to the final catch-all below is a safe no-op for them.

    if (key.leftArrow) {
      apply(text, Math.max(0, cursor - 1));
      return;
    }

    if (key.rightArrow) {
      apply(text, Math.min(text.length, cursor + 1));
      return;
    }

    if (key.upArrow) {
      apply(text, moveVertical(text, cursor, -1));
      return;
    }

    if (key.downArrow) {
      apply(text, moveVertical(text, cursor, 1));
      return;
    }

    if (key.ctrl && input === "a") {
      apply(text, lineBounds(text, cursor)[0]);
      return;
    }

    if (key.ctrl && input === "e") {
      apply(text, lineBounds(text, cursor)[1]);
      return;
    }

    if (key.ctrl || key.meta || key.tab || !input) {
      return;
    }

    apply(text.slice(0, cursor) + input + text.slice(cursor), cursor + input.length);
  });

  useEffect(() => {
    const onData = (chunk: string) => {
      const { text, cursor } = stateRef.current;
      if (HOME_SEQUENCES.includes(chunk)) {
        apply(text, lineBounds(text, cursor)[0]);
      } else if (END_SEQUENCES.includes(chunk)) {
        apply(text, lineBounds(text, cursor)[1]);
      } else if (BACKSPACE_SEQUENCES.includes(chunk)) {
        if (cursor > 0) {
          apply(text.slice(0, cursor - 1) + text.slice(cursor), cursor - 1);
        }
      } else if (FORWARD_DELETE_SEQUENCES.includes(chunk)) {
        if (cursor < text.length) {
          apply(text.slice(0, cursor) + text.slice(cursor + 1), cursor);
        }
      }
    };
    internal_eventEmitter.on("input", onData);
    return () => {
      internal_eventEmitter.off("input", onData);
    };
  }, [internal_eventEmitter, apply]);

  const { text, cursor } = stateRef.current;
  const lines = text.length === 0 ? [""] : text.split("\n");
  let runningOffset = 0;

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => {
        const lineStart = runningOffset;
        runningOffset += line.length + 1;
        const cursorInLine = cursor >= lineStart && cursor <= lineStart + line.length;

        if (!cursorInLine) {
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are re-derived fresh every render, no stable id
          return <Text key={idx}>{line.length > 0 ? line : " "}</Text>;
        }

        const col = cursor - lineStart;
        const before = line.slice(0, col);
        const atCursor = col < line.length ? line[col] : " ";
        const after = col < line.length ? line.slice(col + 1) : "";
        // A single string with the cursor's styling embedded as raw ANSI (via chalk), not a
        // separate sibling <Text> for the cursor: when a long unwrapped line word-wraps inside
        // the bordered box, Ink's flexbox row layout doesn't correctly re-flow a *sibling*
        // Text's position across that wrap - the cursor ends up floating at some arbitrary
        // column instead of tracking the actual wrapped text. One Text node's own content wraps
        // correctly, ANSI codes and all, because wrapping never needs to reason about sibling
        // layout at all.
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are re-derived fresh every render, no stable id
          <Text key={idx}>{before + chalk.inverse(atCursor) + after}</Text>
        );
      })}
    </Box>
  );
}
