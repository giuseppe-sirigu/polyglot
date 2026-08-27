import type { PermissionMode } from "@usepolyglot/core";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

const MODE_LABEL: Record<PermissionMode, string> = {
  manual: "manual",
  auto: "auto",
  plan: "plan",
};

export interface StatusBarProps {
  mode: PermissionMode;
  model: string;
  /** 0-100 share of the model's context window (see sessionContextTokens) — undefined hides the
   * segment entirely rather than showing a misleading 0%. */
  contextUsedPercent: number | undefined;
  sessionLabel: string | undefined;
}

export function StatusBar({ mode, model, contextUsedPercent, sessionLabel }: StatusBarProps) {
  const contextColor =
    contextUsedPercent === undefined
      ? undefined
      : contextUsedPercent >= 90
        ? theme.error
        : contextUsedPercent >= 75
          ? theme.warn
          : undefined;

  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>
        mode: <Text color={theme.signal}>{MODE_LABEL[mode]}</Text> · model:{" "}
        <Text color={theme.signal}>{model}</Text>
        {contextUsedPercent === undefined ? null : (
          <>
            {" "}
            · context: <Text color={contextColor}>{contextUsedPercent}%</Text>
          </>
        )}
        {sessionLabel === undefined ? null : (
          <>
            {" "}
            · session: <Text color={theme.signal}>{sessionLabel}</Text>
          </>
        )}
      </Text>
      <Text dimColor>
        Shift+Tab mode · /model · /rename · /resume · /compact · /reset · Ctrl+C exit
      </Text>
    </Box>
  );
}
