export type DisplayItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  // `toolCallId` correlates a call with its result so the renderer can pair them even when a
  // step's calls ran concurrently and their results arrived interleaved. Absent on items
  // reconstructed from very old resumed sessions.
  | {
      kind: "tool_call";
      id: string;
      toolCallId?: string;
      name: string;
      input: unknown;
      correctedFromName?: string;
      /** The model's output needed repair to produce this call; `rawCall` is the verbatim
       * malformed block, shown under the card when raw view is toggled on (Ctrl+R). */
      repaired?: boolean;
      rawCall?: string;
    }
  | {
      kind: "tool_result";
      id: string;
      toolCallId?: string;
      name: string;
      resultText: string;
      isError: boolean;
    }
  | { kind: "tool_parse_error"; id: string; toolCallId?: string; message: string }
  | { kind: "system"; id: string; text: string; tone: "info" | "warn" | "error" };

/** Plain `Omit` doesn't distribute over a union - it keeps only fields common to every
 * member - so pushItem() needs this distributive version to accept each variant's own
 * fields minus "id". */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewDisplayItem = DistributiveOmit<DisplayItem, "id">;

/** Tool-call-related items belonging to the turn currently in progress - kept in local state,
 * collapsed by default with a keyboard toggle to expand, until the round they belong to
 * finishes and they're flushed into the permanent (Static) transcript. */
export type LiveTurnItem = Extract<
  DisplayItem,
  { kind: "tool_call" | "tool_result" | "tool_parse_error" }
>;
