import type { PermissionMode } from "@polyglot/core";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

const MODE_LABEL: Record<PermissionMode, string> = {
  manual: "manual",
  auto: "auto",
  plan: "plan",
};

export function StatusBar({ mode }: { mode: PermissionMode }) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        mode: <Text color={theme.signal}>{MODE_LABEL[mode]}</Text> (Shift+Tab to cycle) · /compact ·
        Ctrl+C to exit
      </Text>
    </Box>
  );
}
