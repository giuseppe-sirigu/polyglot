import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { MultilineTextInput } from "./MultilineTextInput.js";
import { renderMarkdown } from "./markdown.js";
import { theme } from "./theme.js";

export interface PlanApprovalPromptProps {
  plan: string;
  onRespond: (approved: boolean) => void;
  /** Fires instead of onRespond when the user picks "Comment" and types something - the caller
   * is expected to treat the plan as not approved and feed the text back in as the user's next
   * message, rather than resolving it with a plain yes/no. */
  onComment: (text: string) => void;
}

type Option =
  | { kind: "response"; label: string; approved: boolean; key: string }
  | { kind: "comment"; label: string; key: string };

const OPTIONS: Option[] = [
  { kind: "response", label: "Approve and start making changes", approved: true, key: "y" },
  { kind: "response", label: "Keep planning", approved: false, key: "n" },
  { kind: "comment", label: "Comment / give different instructions", key: "c" },
];
const DEFAULT_CURSOR = OPTIONS.findIndex((o) => o.kind === "response" && o.approved === false);

export function PlanApprovalPrompt({ plan, onRespond, onComment }: PlanApprovalPromptProps) {
  // Defaults to "Keep planning" so a bare Enter (no arrow navigation) behaves exactly like it
  // always has - a safe default, not an accidental approval.
  const [cursor, setCursor] = useState(DEFAULT_CURSOR);
  const [commenting, setCommenting] = useState(false);
  const [commentText, setCommentText] = useState("");

  useInput((input, key) => {
    // While commenting, MultilineTextInput below owns every keystroke except Escape, which
    // backs out of comment mode instead of being swallowed as a no-op by its own key handling.
    if (commenting) {
      if (key.escape) setCommenting(false);
      return;
    }
    if (key.escape) {
      onRespond(false);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + OPTIONS.length) % OPTIONS.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % OPTIONS.length);
      return;
    }
    if (key.return) {
      const option = OPTIONS[cursor];
      if (option?.kind === "comment") {
        setCommenting(true);
        return;
      }
      onRespond(option?.approved ?? false);
      return;
    }
    // Direct letter shortcuts still work regardless of where the cursor is, independent of
    // arrow navigation - this is on top of it, not a replacement.
    const lower = input.toLowerCase();
    if (lower === "c") {
      setCommenting(true);
      return;
    }
    const shortcut = OPTIONS.find((o) => o.kind === "response" && o.key === lower);
    if (shortcut?.kind === "response") onRespond(shortcut.approved);
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.signal}
      paddingX={1}
      marginTop={1}
    >
      <Text color={theme.signal} bold>
        Proposed plan
      </Text>
      <Box marginTop={1}>{renderMarkdown(plan)}</Box>
      {commenting ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            Type what you'd like changed - enter to send and stop planning, esc to go back:
          </Text>
          <Box borderStyle="round" borderColor={theme.signal} paddingX={1} marginTop={1}>
            <Text color={theme.signal}>› </Text>
            <MultilineTextInput
              value={commentText}
              onChange={setCommentText}
              onSubmit={(text) => {
                const trimmed = text.trim();
                if (trimmed) onComment(trimmed);
                else setCommenting(false);
              }}
            />
          </Box>
        </Box>
      ) : (
        <>
          <Box marginTop={1} flexDirection="column">
            {OPTIONS.map((option, idx) => {
              const isCursor = idx === cursor;
              return (
                <Text key={option.key} color={isCursor ? theme.signal : undefined} bold={isCursor}>
                  {isCursor ? "❯ " : "  "}
                  {option.label} <Text dimColor>({option.key})</Text>
                </Text>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↑↓ move · enter select</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
