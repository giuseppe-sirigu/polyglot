import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

export interface TelemetryConsentPromptProps {
  onRespond: (enabled: boolean) => void;
}

export function TelemetryConsentPrompt({ onRespond }: TelemetryConsentPromptProps) {
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
        Record local usage telemetry?
      </Text>
      <Text dimColor>
        If yes, polyglot logs which provider/model/base URL you use and whether tool-call parsing
        needed repair or failed - never prompts, file contents, tool arguments, or model output.
        It's written locally to ~/.polyglot/telemetry and nothing is sent over the network. You can
        change this later in ~/.polyglot/settings.json ("telemetry").
      </Text>
      <Box marginTop={1}>
        <Text dimColor>[y] yes [n] no</Text>
      </Box>
    </Box>
  );
}
