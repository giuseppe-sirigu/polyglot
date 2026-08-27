import type { ApprovalResponse, DiffPreview, PermissionRequest } from "@usepolyglot/core";
import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { DiffView } from "./DiffView.js";
import { MultilineTextInput } from "./MultilineTextInput.js";
import { theme } from "./theme.js";

export interface ApprovalPromptProps {
  request: PermissionRequest;
  onRespond: (response: ApprovalResponse) => void;
  /** Fires instead of onRespond when the user picks "Comment" and types something - the caller
   * is expected to treat the pending request as denied and feed the text back in as the user's
   * next message, rather than resolving it with a plain yes/no. */
  onComment: (text: string) => void;
}

type Option =
  | { kind: "response"; label: string; response: ApprovalResponse; key: string }
  | { kind: "comment"; label: string; key: string };

const OPTIONS: Option[] = [
  { kind: "response", label: "Allow once", response: "allow_once", key: "y" },
  { kind: "response", label: "Allow for this session", response: "allow_always", key: "a" },
  { kind: "response", label: "Deny", response: "deny", key: "n" },
  { kind: "comment", label: "Comment / give different instructions", key: "c" },
];
const DEFAULT_CURSOR = OPTIONS.findIndex((o) => o.kind === "response" && o.response === "deny");

export function ApprovalPrompt({ request, onRespond, onComment }: ApprovalPromptProps) {
  const [diff, setDiff] = useState<DiffPreview | null>(null);
  // Defaults to "Deny" so a bare Enter (no arrow navigation) behaves exactly like it always
  // has - a safe default, not an accidental allow.
  const [cursor, setCursor] = useState(DEFAULT_CURSOR);
  const [commenting, setCommenting] = useState(false);
  const [commentText, setCommentText] = useState("");

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
    // While commenting, MultilineTextInput below owns every keystroke except Escape, which
    // backs out of comment mode instead of being swallowed as a no-op by its own key handling.
    if (commenting) {
      if (key.escape) setCommenting(false);
      return;
    }
    if (key.escape) {
      onRespond("deny");
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
      onRespond(option?.response ?? "deny");
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
    if (shortcut?.kind === "response") onRespond(shortcut.response);
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
      {commenting ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            Type what you'd rather it do instead - enter to send and stop this action, esc to go
            back:
          </Text>
          <Box borderStyle="round" borderColor={theme.warn} paddingX={1} marginTop={1}>
            <Text color={theme.warn}>› </Text>
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
                <Text key={option.key} color={isCursor ? theme.warn : undefined} bold={isCursor}>
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
