import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

export interface CentralAuditConsentPromptProps {
  controlPlaneUrl: string;
  onRespond: (enabled: boolean) => void;
}

export function CentralAuditConsentPrompt({
  controlPlaneUrl,
  onRespond,
}: CentralAuditConsentPromptProps) {
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
        Report audit events to {controlPlaneUrl}?
      </Text>
      <Text dimColor>
        Your team has configured a control plane. If yes, polyglot reports tool calls, repairs, and
        parse errors from this session there - tool names, models, and argument hashes only, never
        raw arguments, file contents, or prompts, unless your team has separately turned on raw-call
        reporting. This is independent of local audit logging and telemetry. You can change this
        later in ~/.polyglot/settings.json ("centralAudit").
      </Text>
      <Box marginTop={1}>
        <Text dimColor>[y] yes [n] no</Text>
      </Box>
    </Box>
  );
}
