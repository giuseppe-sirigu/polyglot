import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

export interface AutoUpdateConsentPromptProps {
  onRespond: (enabled: boolean) => void;
}

export function AutoUpdateConsentPrompt({ onRespond }: AutoUpdateConsentPromptProps) {
  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === "y") onRespond(true);
    else if (lower === "n" || key.return || key.escape) onRespond(false);
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
        Keep polyglot up to date automatically?
      </Text>
      <Text dimColor>
        When a new version is available, polyglot can update itself in the background - you'll just
        see a note that it happened and to restart. You can change this later in{" "}
        ~/.polyglot/settings.json ("autoUpdate").
      </Text>
      <Box marginTop={1}>
        <Text dimColor>[y] yes, update automatically [n] no, just notify me</Text>
      </Box>
    </Box>
  );
}
