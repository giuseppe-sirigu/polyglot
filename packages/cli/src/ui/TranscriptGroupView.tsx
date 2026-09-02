import { TranscriptLine } from "./TranscriptLine.js";
import type { TranscriptGroup } from "./toolPairing.js";

/** Renders one grouped transcript entry: a plain item, or a tool call with its result nested
 * directly beneath it (see groupTranscript). */
export function TranscriptGroupView({ group }: { group: TranscriptGroup }) {
  if (group.kind === "item") {
    return <TranscriptLine item={group.item} />;
  }
  return (
    <>
      <TranscriptLine item={group.call} />
      {group.result ? <TranscriptLine item={group.result} /> : null}
    </>
  );
}

export function groupKey(group: TranscriptGroup): string {
  return group.kind === "item" ? group.item.id : group.call.id;
}
