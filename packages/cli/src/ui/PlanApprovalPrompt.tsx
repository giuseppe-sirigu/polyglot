import { Box, Text, useInput } from "ink";
import { renderMarkdown } from "./markdown.js";
import { theme } from "./theme.js";

export interface PlanApprovalPromptProps {
  plan: string;
  onRespond: (approved: boolean) => void;
}

export function PlanApprovalPrompt({ plan, onRespond }: PlanApprovalPromptProps) {
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
        Proposed plan
      </Text>
      <Box marginTop={1}>{renderMarkdown(plan)}</Box>
      <Box marginTop={1}>
        <Text dimColor>[y] approve and start making changes [n] keep planning</Text>
      </Box>
    </Box>
  );
}
