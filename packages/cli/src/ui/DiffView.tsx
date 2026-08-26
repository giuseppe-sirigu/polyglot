import { diffLines } from "diff";
import { Box, Text, useStdout } from "ink";
import { theme } from "./theme.js";

export interface DiffViewProps {
  label: string;
  oldText: string;
  newText: string;
}

type RowKind = "same" | "change" | "remove-only" | "add-only" | "ellipsis";

interface Row {
  left: string | null;
  right: string | null;
  kind: RowKind;
}

const CONTEXT_LINES = 3;
const MAX_ROWS = 60;

function splitLines(value: string): string[] {
  const withoutTrailingNewline = value.endsWith("\n") ? value.slice(0, -1) : value;
  return withoutTrailingNewline.length === 0 ? [] : withoutTrailingNewline.split("\n");
}

function buildRows(oldText: string, newText: string): Row[] {
  const changes = diffLines(oldText, newText);
  const rows: Row[] = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change) continue;

    if (!change.added && !change.removed) {
      for (const line of splitLines(change.value))
        rows.push({ left: line, right: line, kind: "same" });
      continue;
    }

    if (change.removed) {
      const next = changes[i + 1];
      const removedLines = splitLines(change.value);
      if (next?.added) {
        const addedLines = splitLines(next.value);
        const max = Math.max(removedLines.length, addedLines.length);
        for (let j = 0; j < max; j++) {
          rows.push({
            left: removedLines[j] ?? null,
            right: addedLines[j] ?? null,
            kind: "change",
          });
        }
        i++; // consume the paired addition
        continue;
      }
      for (const line of removedLines) rows.push({ left: line, right: null, kind: "remove-only" });
      continue;
    }

    // A standalone addition (not paired with a preceding removal).
    for (const line of splitLines(change.value))
      rows.push({ left: null, right: line, kind: "add-only" });
  }

  return collapseContext(rows);
}

/** Keeps only a few lines of unchanged context around each change, like `git diff -U3`, so
 * one small edit in a large file doesn't dump the whole file into the approval prompt. */
function collapseContext(rows: Row[]): Row[] {
  const keep = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.kind !== "same") {
      for (
        let j = Math.max(0, i - CONTEXT_LINES);
        j <= Math.min(rows.length - 1, i + CONTEXT_LINES);
        j++
      ) {
        keep.add(j);
      }
    }
  }

  const collapsed: Row[] = [];
  let skipping = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (keep.has(i) || row.kind !== "same") {
      collapsed.push(row);
      skipping = false;
    } else if (!skipping) {
      collapsed.push({ left: "⋮", right: "⋮", kind: "ellipsis" });
      skipping = true;
    }
  }
  return collapsed;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

const KIND_COLOR: Record<RowKind, { left?: string; right?: string }> = {
  same: {},
  change: { left: theme.error, right: theme.success },
  "remove-only": { left: theme.error },
  "add-only": { right: theme.success },
  ellipsis: {},
};

export function DiffView({ label, oldText, newText }: DiffViewProps) {
  const { stdout } = useStdout();
  const totalWidth = Math.max(60, (stdout?.columns ?? 100) - 6);
  const colWidth = Math.floor((totalWidth - 3) / 2);

  const rows = buildRows(oldText, newText);
  const shown = rows.slice(0, MAX_ROWS);
  const hiddenCount = rows.length - shown.length;

  return (
    <Box flexDirection="column">
      <Text color={theme.signal} bold>
        {label}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {shown.map((row, idx) => {
          const colors = KIND_COLOR[row.kind];
          const left = row.left === null ? "" : truncate(row.left, colWidth);
          const right = row.right === null ? "" : truncate(row.right, colWidth);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are re-derived fresh every render, no stable id
            <Box key={idx}>
              <Box width={colWidth}>
                <Text color={colors.left} dimColor={!colors.left}>
                  {left.padEnd(colWidth)}
                </Text>
              </Box>
              <Text dimColor> │ </Text>
              <Box width={colWidth}>
                <Text color={colors.right} dimColor={!colors.right}>
                  {right}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      {hiddenCount > 0 ? <Text dimColor>[{hiddenCount} more line(s) not shown]</Text> : null}
    </Box>
  );
}
