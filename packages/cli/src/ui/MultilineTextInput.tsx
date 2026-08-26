import { Box, Text, useInput, useStdin } from "ink";
import { useEffect, useState } from "react";

export interface MultilineTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

// Escape sequences a terminal sends for the literal Home/End keys, taken from Ink's own
// parse-keypress.js keyName table — Ink's public useInput() never exposes home/end as flags,
// so these are read directly off the raw input stream that useInput is itself built on.
const HOME_SEQUENCES = ["\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~"];
const END_SEQUENCES = ["\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~"];

function lineBounds(value: string, offset: number): [start: number, end: number] {
  const start = value.lastIndexOf("\n", offset - 1) + 1;
  const nextBreak = value.indexOf("\n", offset);
  const end = nextBreak === -1 ? value.length : nextBreak;
  return [start, end];
}

function moveVertical(value: string, offset: number, direction: -1 | 1): number {
  const lines = value.split("\n");
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

export function MultilineTextInput({ value, onChange, onSubmit }: MultilineTextInputProps) {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const { internal_eventEmitter } = useStdin();

  // Keep the cursor in bounds when `value` changes from outside (e.g. cleared on submit).
  useEffect(() => {
    setCursorOffset((prev) => Math.min(prev, value.length));
  }, [value]);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }

    // Alt+Enter arrives as the 2-byte sequence ESC+CR: Ink can't tell it apart from other
    // escape-prefixed input at the key-name level, so `key.return` stays false (a real Enter
    // sets it true) while `input` collapses to a bare "\r" — that combination is what
    // distinguishes this case from everything else.
    if (input === "\r") {
      const next = `${value.slice(0, cursorOffset)}\n${value.slice(cursorOffset)}`;
      onChange(next);
      setCursorOffset(cursorOffset + 1);
      return;
    }

    if (key.delete) {
      if (cursorOffset < value.length) {
        onChange(value.slice(0, cursorOffset) + value.slice(cursorOffset + 1));
      }
      return;
    }

    if (key.backspace) {
      if (cursorOffset > 0) {
        onChange(value.slice(0, cursorOffset - 1) + value.slice(cursorOffset));
        setCursorOffset(cursorOffset - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorOffset(Math.max(0, cursorOffset - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset(Math.min(value.length, cursorOffset + 1));
      return;
    }

    if (key.upArrow) {
      setCursorOffset(moveVertical(value, cursorOffset, -1));
      return;
    }

    if (key.downArrow) {
      setCursorOffset(moveVertical(value, cursorOffset, 1));
      return;
    }

    if (key.ctrl && input === "a") {
      setCursorOffset(lineBounds(value, cursorOffset)[0]);
      return;
    }

    if (key.ctrl && input === "e") {
      setCursorOffset(lineBounds(value, cursorOffset)[1]);
      return;
    }

    if (key.ctrl || key.meta || key.tab || !input) {
      return;
    }

    const next = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
    onChange(next);
    setCursorOffset(cursorOffset + input.length);
  });

  useEffect(() => {
    const onData = (chunk: string) => {
      if (HOME_SEQUENCES.includes(chunk)) {
        setCursorOffset((prev) => lineBounds(value, prev)[0]);
      } else if (END_SEQUENCES.includes(chunk)) {
        setCursorOffset((prev) => lineBounds(value, prev)[1]);
      }
    };
    internal_eventEmitter.on("input", onData);
    return () => {
      internal_eventEmitter.off("input", onData);
    };
  }, [internal_eventEmitter, value]);

  const lines = value.length === 0 ? [""] : value.split("\n");
  let runningOffset = 0;

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => {
        const lineStart = runningOffset;
        runningOffset += line.length + 1;
        const cursorInLine = cursorOffset >= lineStart && cursorOffset <= lineStart + line.length;

        if (!cursorInLine) {
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are re-derived fresh every render, no stable id
          return <Text key={idx}>{line.length > 0 ? line : " "}</Text>;
        }

        const col = cursorOffset - lineStart;
        const before = line.slice(0, col);
        const atCursor = col < line.length ? line[col] : " ";
        const after = col < line.length ? line.slice(col + 1) : "";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are re-derived fresh every render, no stable id
          <Box key={idx}>
            <Text>{before}</Text>
            <Text inverse>{atCursor}</Text>
            <Text>{after}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
