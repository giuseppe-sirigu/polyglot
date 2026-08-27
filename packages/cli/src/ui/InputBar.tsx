import { Box, Text } from "ink";
import { useState } from "react";
import { MultilineTextInput } from "./MultilineTextInput.js";
import { SlashCommandMenu } from "./SlashCommandMenu.js";
import { matchSlashCommands } from "./slashCommands.js";
import { theme } from "./theme.js";

export interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** True while a turn is in progress. Input stays fully typable either way — submitting while
   * busy queues the message instead of starting a second turn — this only affects styling and
   * the hint line below the box. */
  disabled: boolean;
  queuedCount: number;
}

export function InputBar({ value, onChange, onSubmit, disabled, queuedCount }: InputBarProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const suggestions = matchSlashCommands(value);
  const clampedIndex =
    suggestions.length === 0 ? 0 : Math.min(highlightedIndex, suggestions.length - 1);

  return (
    <Box flexDirection="column">
      <SlashCommandMenu commands={suggestions} highlightedIndex={clampedIndex} />
      <Box
        borderStyle="round"
        borderColor={disabled ? "gray" : theme.signal}
        paddingX={1}
        marginTop={1}
      >
        <Text color={disabled ? "gray" : theme.signal}>› </Text>
        <MultilineTextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          suggestions={suggestions}
          highlightedSuggestionIndex={clampedIndex}
          onNavigateSuggestions={(direction) =>
            setHighlightedIndex((i) =>
              suggestions.length === 0
                ? 0
                : Math.max(0, Math.min(suggestions.length - 1, i + direction)),
            )
          }
        />
      </Box>
      {disabled ? (
        <Text dimColor>
          {queuedCount > 0
            ? `working… (Esc stops, then runs queue) · ${queuedCount} queued`
            : "working… (Esc to stop) · type to queue a message"}
        </Text>
      ) : null}
    </Box>
  );
}
