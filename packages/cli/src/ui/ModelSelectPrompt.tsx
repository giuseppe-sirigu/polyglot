import type { ModelOption } from "@usepolyglot/core";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "./theme.js";

export interface ModelSelectPromptProps {
  options: ModelOption[];
  onSelect: (option: ModelOption) => void;
  onCancel: () => void;
}

export function ModelSelectPrompt({ options, onSelect, onCancel }: ModelSelectPromptProps) {
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.isCurrent),
    ),
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % options.length);
      return;
    }
    if (key.return) {
      const chosen = options[cursor];
      if (chosen) onSelect(chosen);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.signal}
      paddingX={1}
      marginTop={1}
    >
      <Text color={theme.signal} bold>
        Switch model
      </Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((o, idx) => {
          const isCursor = idx === cursor;
          return (
            <Box key={`${o.provider}:${o.model}`}>
              <Text color={isCursor ? theme.signal : undefined} bold={isCursor}>
                {isCursor ? "❯ " : "  "}
                {o.label}
                {o.isCurrent ? " (current)" : ""}
              </Text>
              <Text dimColor>
                {" "}
                — [{o.provider}] {o.model}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
