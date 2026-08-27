import type { UserQuestionRequest } from "@usepolyglot/core";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "./theme.js";

export interface AskUserQuestionPromptProps {
  request: UserQuestionRequest;
  onRespond: (answers: string[]) => void;
}

export function AskUserQuestionPrompt({ request, onRespond }: AskUserQuestionPromptProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const optionCount = request.options.length;

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => (c - 1 + optionCount) % optionCount);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % optionCount);
      return;
    }
    if (request.multiSelect && input === " ") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      return;
    }
    if (key.return) {
      const labels = request.options.map((o) => o.label);
      const chosen = request.multiSelect
        ? [...selected]
            .sort((a, b) => a - b)
            .map((i) => labels[i])
            .filter((l): l is string => l !== undefined)
        : [labels[cursor]].filter((l): l is string => l !== undefined);
      onRespond(chosen.length > 0 ? chosen : [labels[cursor] ?? ""]);
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
        {request.question}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {request.options.map((option, idx) => {
          const isCursor = idx === cursor;
          const isChecked = request.multiSelect && selected.has(idx);
          const marker = request.multiSelect ? (isChecked ? "[x]" : "[ ]") : isCursor ? "❯" : " ";
          return (
            <Box key={option.label}>
              <Text color={isCursor ? theme.signal : undefined} bold={isCursor}>
                {marker} {option.label}
              </Text>
              {option.description ? <Text dimColor> - {option.description}</Text> : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {request.multiSelect
            ? "↑↓ move · space toggle · enter confirm"
            : "↑↓ move · enter select"}
        </Text>
      </Box>
    </Box>
  );
}
