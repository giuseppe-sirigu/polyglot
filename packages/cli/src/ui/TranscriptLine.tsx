import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown.js";
import { theme } from "./theme.js";
import type { DisplayItem } from "./types.js";

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\n/g, " ⏎ ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

const TONE_COLOR = { info: theme.dim, warn: theme.warn, error: theme.error } as const;

export function TranscriptLine({ item }: { item: DisplayItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color={theme.signal} bold>
            ›{" "}
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );

    case "assistant":
      return <Box marginTop={1}>{renderMarkdown(item.text)}</Box>;

    case "tool_call": {
      const label = item.correctedFromName
        ? `${item.name} (corrected from "${item.correctedFromName}")`
        : item.name;
      return (
        <Box marginTop={1}>
          <Text color={theme.toolName}>⏺ {label}</Text>
          <Text dimColor>({truncate(JSON.stringify(item.input), 90)})</Text>
        </Box>
      );
    }

    case "tool_result":
      return (
        <Box paddingLeft={2}>
          <Text color={item.isError ? theme.error : theme.success}>
            {item.isError ? "✗ " : "⎿ "}
          </Text>
          <Text dimColor={!item.isError}>{truncate(item.resultText, 140)}</Text>
        </Box>
      );

    case "tool_parse_error":
      return (
        <Box paddingLeft={2}>
          <Text color={theme.warn}>⚠ tool call parse error: {truncate(item.message, 140)}</Text>
        </Box>
      );

    case "system":
      return (
        <Box marginTop={1}>
          <Text color={TONE_COLOR[item.tone]}>[polyglot] {item.text}</Text>
        </Box>
      );

    default:
      return null;
  }
}
