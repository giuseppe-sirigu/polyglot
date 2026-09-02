import { Box } from "ink";
import { TranscriptGroupView, groupKey } from "./TranscriptGroupView.js";
import { groupTranscript } from "./toolPairing.js";
import type { LiveTurnItem } from "./types.js";

export interface LiveToolLogProps {
  items: LiveTurnItem[];
}

/** Tool calls/results/parse-errors for the turn currently in progress - rendered exactly the
 * way they'll look once flushed into the permanent transcript, so nothing shifts visually when
 * that happens. Grouped so each result sits under its own call (results from a concurrent step
 * arrive interleaved). Kept out of the Static block until the round completes because Ink's
 * Static list is append-only. */
export function LiveToolLog({ items }: LiveToolLogProps) {
  if (items.length === 0) return null;

  return (
    <Box flexDirection="column">
      {groupTranscript(items).map((group) => (
        <TranscriptGroupView key={groupKey(group)} group={group} />
      ))}
    </Box>
  );
}
