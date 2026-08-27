import type { SessionSummary } from "@usepolyglot/core";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "./theme.js";

export interface ResumeSessionPromptProps {
  sessions: SessionSummary[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

function relativeTime(ms: number): string {
  const diffMinutes = Math.floor((Date.now() - ms) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function ResumeSessionPrompt({ sessions, onSelect, onCancel }: ResumeSessionPromptProps) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + sessions.length) % sessions.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % sessions.length);
      return;
    }
    if (key.return) {
      const chosen = sessions[cursor];
      if (chosen) onSelect(chosen.id);
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
        Resume a session
      </Text>
      <Box marginTop={1} flexDirection="column">
        {sessions.map((s, idx) => {
          const isCursor = idx === cursor;
          const label = s.name ?? s.id.slice(0, 8);
          return (
            <Box key={s.id} flexDirection="column">
              <Text color={isCursor ? theme.signal : undefined} bold={isCursor}>
                {isCursor ? "❯ " : "  "}
                {label}
              </Text>
              <Text dimColor>
                {"    "}
                {s.provider}/{s.model} · {s.messageCount} messages · {s.cwd} ·{" "}
                {relativeTime(s.updatedAt)}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter resume · esc cancel</Text>
      </Box>
    </Box>
  );
}
