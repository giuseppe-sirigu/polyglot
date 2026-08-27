import { Box } from "ink";
import { TranscriptLine } from "./TranscriptLine.js";
import type { LiveTurnItem } from "./types.js";

export interface LiveToolLogProps {
  items: LiveTurnItem[];
}

/** Tool calls/results/parse-errors for the turn currently in progress — rendered exactly the
 * way they'll look once flushed into the permanent transcript, so nothing shifts visually when
 * that happens. Kept out of the Static block until then only because Ink's Static list is
 * append-only and this turn's items aren't final until the round completes. */
export function LiveToolLog({ items }: LiveToolLogProps) {
  if (items.length === 0) return null;

  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <TranscriptLine key={item.id} item={item} />
      ))}
    </Box>
  );
}
