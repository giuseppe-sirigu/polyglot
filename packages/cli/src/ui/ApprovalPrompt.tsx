import type { ApprovalResponse, DiffPreview, PermissionRequest } from "@polyglot/core";
import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { DiffView } from "./DiffView.js";
import { theme } from "./theme.js";

export interface ApprovalPromptProps {
  request: PermissionRequest;
  onRespond: (response: ApprovalResponse) => void;
}

export function ApprovalPrompt({ request, onRespond }: ApprovalPromptProps) {
  const [diff, setDiff] = useState<DiffPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    request.loadDiff?.().then((preview) => {
      if (!cancelled) setDiff(preview);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

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
        Allow {request.toolName}
        {diff ? "" : `(${JSON.stringify(request.input)})`}?
      </Text>
      {request.note ? <Text color={theme.warn}>{request.note}</Text> : null}
      {diff ? (
        <Box marginTop={1}>
          <DiffView label={diff.label} oldText={diff.oldText} newText={diff.newText} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>[y] allow once [a] allow for this session [n] deny</Text>
      </Box>
    </Box>
  );
}
