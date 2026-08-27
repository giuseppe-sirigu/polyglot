import { Box, Text } from "ink";
import type { SlashCommand } from "./slashCommands.js";
import { theme } from "./theme.js";

export interface SlashCommandMenuProps {
  commands: SlashCommand[];
  highlightedIndex: number;
}

/** Live-updating `/`-command suggestion popup, rendered above the input box. Purely
 * presentational — InputBar owns the filtering and highlighted index, MultilineTextInput owns
 * accepting a suggestion (it's the only thing allowed to mutate the actual input text). */
export function SlashCommandMenu({ commands, highlightedIndex }: SlashCommandMenuProps) {
  if (commands.length === 0) return null;
  const highlighted = commands[highlightedIndex];

  return (
    <Box flexDirection="column" paddingX={1}>
      {commands.map((c, idx) => {
        const isHighlighted = idx === highlightedIndex;
        return (
          <Box key={c.command}>
            <Text color={isHighlighted ? theme.signal : undefined} bold={isHighlighted}>
              {isHighlighted ? "❯ " : "  "}
              {c.command}
            </Text>
            <Text dimColor> — {c.description}</Text>
          </Box>
        );
      })}
      <Text dimColor>
        ↑↓ select · tab complete{highlighted?.takesArgument ? "" : " · enter run"}
      </Text>
    </Box>
  );
}
