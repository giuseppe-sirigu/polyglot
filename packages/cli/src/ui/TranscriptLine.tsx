import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown.js";
import { theme } from "./theme.js";
import { describeToolCall, truncate } from "./toolDisplay.js";
import type { DisplayItem } from "./types.js";

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
      const label = describeToolCall(item.name, item.input);
      const corrected = item.correctedFromName
        ? ` (corrected from "${item.correctedFromName}")`
        : "";
      return (
        <Box marginTop={1}>
          <Text color={theme.toolName}>⏺ {label}</Text>
          {corrected ? <Text dimColor>{corrected}</Text> : null}
        </Box>
      );
    }

    case "tool_result":
      return (
        <Box paddingLeft={2}>
          <Text color={item.isError ? theme.error : theme.success}>
            {item.isError ? "✗ " : "⎿ "}
          </Text>
          {item.name ? <Text dimColor>{item.name} </Text> : null}
          <Text dimColor={!item.isError}>{truncate(item.resultText, 300)}</Text>
        </Box>
      );

    case "tool_parse_error":
      return (
        <Box paddingLeft={2}>
          <Text color={theme.warn}>⚠ tool call parse error: {truncate(item.message, 300)}</Text>
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
