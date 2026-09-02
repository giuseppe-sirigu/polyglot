import { createContext, useContext } from "react";

/** When true, a repaired tool call renders the model's verbatim malformed block under its
 * card. Toggled with Ctrl+R; the `<Static>` transcript is re-keyed so historical cards pick
 * up the change too. */
export const RepairViewContext = createContext(false);

export function useShowRawRepairs(): boolean {
  return useContext(RepairViewContext);
}
