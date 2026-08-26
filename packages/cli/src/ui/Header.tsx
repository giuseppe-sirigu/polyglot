import { Box, Text } from "ink";
import { theme } from "./theme.js";

export interface HeaderProps {
  provider: string;
  model: string;
  sessionId: string;
}

export function Header({ provider, model, sessionId }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.signal} bold>
          ◈ polyglot
        </Text>
        <Text dimColor>
          {" "}
          — {provider} / {model}
        </Text>
      </Box>
      <Text dimColor>session {sessionId.slice(0, 8)}</Text>
    </Box>
  );
}
