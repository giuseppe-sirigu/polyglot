import type { ModelReliabilityTotals, PermissionMode } from "@usepolyglot/core";
import { Box, Text } from "ink";
import { fmtUSD } from "./costReport.js";
import { theme } from "./theme.js";

const MODE_LABEL: Record<PermissionMode, string> = {
  manual: "manual",
  auto: "auto",
  plan: "plan",
};

export interface StatusBarProps {
  mode: PermissionMode;
  model: string;
  /** 0-100 share of the model's context window (see sessionContextTokens) - undefined hides the
   * segment entirely rather than showing a misleading 0%. */
  contextUsedPercent: number | undefined;
  /** Estimated cumulative session cost in USD - shown only when > 0. */
  sessionCostUSD: number | undefined;
  /** The active model's tool-call reliability this session - shown only when it's worth
   * flagging (a parse error, a give-up, or a sub-100% clean rate). */
  reliability: ModelReliabilityTotals | undefined;
  sessionLabel: string | undefined;
}

/** `⚠2` for parse errors, `⚠give-up` for a give-up, `92% ok` for repairs-only, or null when
 * everything's been clean. */
function reliabilitySegment(
  r: ModelReliabilityTotals | undefined,
): { text: string; warn: boolean } | null {
  if (!r) return null;
  if (r.gaveUp > 0) return { text: "⚠ gave up", warn: true };
  if (r.parseErrors > 0) return { text: `⚠${r.parseErrors}`, warn: true };
  const attempts = r.toolCalls + r.parseErrors;
  if (r.repaired > 0 && attempts > 0) {
    return {
      text: `${Math.round(((r.toolCalls - r.repaired) / attempts) * 100)}% ok`,
      warn: false,
    };
  }
  return null;
}

export function StatusBar({
  mode,
  model,
  contextUsedPercent,
  sessionCostUSD,
  reliability,
  sessionLabel,
}: StatusBarProps) {
  const contextColor =
    contextUsedPercent === undefined
      ? undefined
      : contextUsedPercent >= 90
        ? theme.error
        : contextUsedPercent >= 75
          ? theme.warn
          : undefined;
  const rel = reliabilitySegment(reliability);

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
        {sessionCostUSD !== undefined && sessionCostUSD > 0 ? (
          <>
            {" "}
            · <Text>{fmtUSD(sessionCostUSD)}</Text>
          </>
        ) : null}
        {rel ? (
          <>
            {" "}
            · <Text color={rel.warn ? theme.warn : undefined}>{rel.text}</Text>
          </>
        ) : null}
        {sessionLabel === undefined ? null : (
          <>
            {" "}
            · session: <Text color={theme.signal}>{sessionLabel}</Text>
          </>
        )}
      </Text>
      <Text dimColor>
        Shift+Tab mode · /model · /rename · /resume · /reliability · /compact · /reset · Ctrl+C exit
      </Text>
    </Box>
  );
}
