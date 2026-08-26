import type { ApprovalResponse, PermissionRequest } from "@polyglot/core";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

export interface ApprovalPromptProps {
  request: PermissionRequest;
  onRespond: (response: ApprovalResponse) => void;
}

export function ApprovalPrompt({ request, onRespond }: ApprovalPromptProps) {
  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === "a") onRespond("allow_always");
    else if (lower === "y") onRespond("allow_once");
    else if (lower === "n" || key.return || key.escape) onRespond("deny");
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warn}
      paddingX={1}
      marginTop={1}
    >
      <Text color={theme.warn} bold>
        Allow {request.toolName}({JSON.stringify(request.input)})?
      </Text>
      <Text dimColor>[y] allow once [a] allow for this session [n] deny</Text>
    </Box>
  );
}
