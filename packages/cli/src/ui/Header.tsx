import { Box, Text } from "ink";
import { theme } from "./theme.js";

export interface HeaderProps {
  provider: string;
  model: string;
  sessionId: string;
  version: string;
  cwd: string;
}

export function Header({ provider, model, sessionId, version, cwd }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor={theme.signal} paddingX={2}>
        <Text color={theme.signal} bold>
          ◈ POLYGLOT ◈
        </Text>
      </Box>
      <Text dimColor> the model-agnostic coding agent · v{version}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {" "}
          {provider} / {model}
        </Text>
        <Text dimColor> {cwd}</Text>
        <Text dimColor> session {sessionId.slice(0, 8)}</Text>
      </Box>
    </Box>
  );
}
