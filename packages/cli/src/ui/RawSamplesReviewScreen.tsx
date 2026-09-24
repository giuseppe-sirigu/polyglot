import type { RedactedSample } from "@usepolyglot/core";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "./theme.js";

export interface RawSamplesReviewResult {
  included: RedactedSample[];
  excludedCount: number;
}

export interface RawSamplesReviewScreenProps {
  samples: RedactedSample[];
  /** null means the review was aborted (Esc) - nothing should be included, matching the
   * plan's "nobody should be able to submit raw samples without having explicitly asked for
   * them to be included" rule: an abort is not the same as "include none but still proceed". */
  onComplete: (result: RawSamplesReviewResult | null) => void;
}

const MAX_PREVIEW_LINES = 20;

/** Splits on `[redacted:label]` markers (scanContent's own output format) so they render in a
 * distinct color from the surrounding original text - what was scrubbed vs. what's original
 * content needs to be unambiguous at a glance, per the plan's design for this screen. */
function RedactedBody({ text }: { text: string }) {
  const lines = text.split("\n").slice(0, MAX_PREVIEW_LINES);
  const truncated = text.split("\n").length > MAX_PREVIEW_LINES;
  const pattern = /(\[redacted:[a-z0-9_-]+\])/gi;
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are a static per-render split of a fixed string, no reordering
        <Text key={i} wrap="truncate-end">
          {line.split(pattern).map((part, j) =>
            pattern.test(part) ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: same as above
              <Text key={j} color={theme.warn} bold>
                {part}
              </Text>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: same as above
              <Text key={j}>{part}</Text>
            ),
          )}
        </Text>
      ))}
      {truncated ? (
        <Text dimColor>… truncated for preview - the full body is what ships</Text>
      ) : null}
    </Box>
  );
}

export function RawSamplesReviewScreen({ samples, onComplete }: RawSamplesReviewScreenProps) {
  const [cursor, setCursor] = useState(0);
  const [included, setIncluded] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.escape) {
      onComplete(null);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + samples.length) % samples.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % samples.length);
      return;
    }
    if (input === " ") {
      setIncluded((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      return;
    }
    if (key.return) {
      onComplete({
        included: samples.filter((_, i) => included.has(i)),
        excludedCount: samples.length - included.size,
      });
    }
  });

  const current = samples[cursor];
  if (!current) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.signal}
      paddingX={1}
      marginTop={1}
    >
      <Text color={theme.signal} bold>
        Review {samples.length} low-confidence repair sample{samples.length === 1 ? "" : "s"} -
        already auto-redacted below
      </Text>
      <Text dimColor>
        Nothing here is included in the report unless you explicitly mark it. Space toggles
        include/exclude, ↑↓ moves, Enter finishes, Esc aborts (nothing included).
      </Text>

      <Box marginTop={1} flexDirection="column">
        {samples.map((s, i) => {
          const isCursor = i === cursor;
          const isIncluded = included.has(i);
          return (
            <Text key={`${s.at}-${i}`} color={isCursor ? theme.signal : undefined} bold={isCursor}>
              {isCursor ? "❯ " : "  "}[{isIncluded ? "x" : " "}] {s.model} /{" "}
              {s.toolName ?? "(unknown tool)"} - {s.strategy}
              {s.findings.length > 0
                ? ` (${s.findings.map((f) => `${f.count}x ${f.label}`).join(", ")} redacted)`
                : ""}
            </Text>
          );
        })}
      </Box>

      <Box
        marginTop={1}
        borderStyle="single"
        borderColor={theme.dim}
        paddingX={1}
        flexDirection="column"
      >
        <Text dimColor>At: {current.at}</Text>
        <RedactedBody text={current.redactedText} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {included.size} included / {samples.length} total
        </Text>
      </Box>
    </Box>
  );
}
