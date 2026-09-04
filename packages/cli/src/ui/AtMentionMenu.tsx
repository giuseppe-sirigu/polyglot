import { Box, Text } from "ink";
import type { AtCandidate } from "./atMentions.js";
import { theme } from "./theme.js";

export interface AtMentionMenuProps {
  candidates: AtCandidate[];
  highlightedIndex: number;
}

/** Live `@`-mention suggestion popup, rendered above the input box (sibling of the slash-command
 * menu; at most one is non-empty at a time). Purely presentational - InputBar owns the ranking
 * and highlighted index, MultilineTextInput owns splicing the accepted candidate into the text. */
export function AtMentionMenu({ candidates, highlightedIndex }: AtMentionMenuProps) {
  if (candidates.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={1}>
      {candidates.map((c, idx) => {
        const isHighlighted = idx === highlightedIndex;
        return (
          <Box key={`${c.kind}:${c.value}`}>
            <Text color={isHighlighted ? theme.signal : undefined} bold={isHighlighted}>
              {isHighlighted ? "❯ " : "  "}
              {c.label}
            </Text>
            <Text dimColor>
              {" "}
              {c.kind}
              {c.hint ? ` - ${c.hint}` : ""}
            </Text>
          </Box>
        );
      })}
      <Text dimColor>↑↓ select · tab/enter insert</Text>
    </Box>
  );
}
