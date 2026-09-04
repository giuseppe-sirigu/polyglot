import { Box, Text } from "ink";
import { useState } from "react";
import { AtMentionMenu } from "./AtMentionMenu.js";
import { MultilineTextInput } from "./MultilineTextInput.js";
import { SlashCommandMenu } from "./SlashCommandMenu.js";
import { type AtCandidate, rankMentions } from "./atMentions.js";
import { matchSlashCommands } from "./slashCommands.js";
import { theme } from "./theme.js";

export interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** True while a turn is in progress. Input stays fully typable either way - submitting while
   * busy queues the message instead of starting a second turn - this only affects styling and
   * the hint line below the box. */
  disabled: boolean;
  queuedCount: number;
  /** Candidates for the `@`-mention picker: project files (cwd-relative) plus any configured
   * agents / skills. */
  mentionFiles?: string[];
  mentionExtras?: AtCandidate[];
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  queuedCount,
  mentionFiles = [],
  mentionExtras = [],
}: InputBarProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const suggestions = matchSlashCommands(value);
  const clampedIndex =
    suggestions.length === 0 ? 0 : Math.min(highlightedIndex, suggestions.length - 1);

  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const mentionCandidates = mentionQuery
    ? rankMentions(mentionQuery.query, [
        ...mentionFiles.map<AtCandidate>((p) => ({ kind: "file", value: p, label: p })),
        ...mentionExtras,
      ])
    : [];
  const clampedMention =
    mentionCandidates.length === 0 ? 0 : Math.min(mentionHighlight, mentionCandidates.length - 1);

  return (
    <Box flexDirection="column">
      <SlashCommandMenu commands={suggestions} highlightedIndex={clampedIndex} />
      <AtMentionMenu candidates={mentionCandidates} highlightedIndex={clampedMention} />
      <Box
        borderStyle="round"
        borderColor={disabled ? "gray" : theme.signal}
        paddingX={1}
        marginTop={1}
      >
        <Text color={disabled ? "gray" : theme.signal}>› </Text>
        <MultilineTextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          suggestions={suggestions}
          highlightedSuggestionIndex={clampedIndex}
          onNavigateSuggestions={(direction) =>
            setHighlightedIndex((i) =>
              suggestions.length === 0
                ? 0
                : Math.max(0, Math.min(suggestions.length - 1, i + direction)),
            )
          }
          mentionCandidates={mentionCandidates}
          highlightedMentionIndex={clampedMention}
          onMentionQuery={(q) => {
            setMentionQuery(q);
            setMentionHighlight(0);
          }}
          onNavigateMentions={(direction) =>
            setMentionHighlight((i) =>
              mentionCandidates.length === 0
                ? 0
                : Math.max(0, Math.min(mentionCandidates.length - 1, i + direction)),
            )
          }
          onCloseMentions={() => setMentionQuery(null)}
        />
      </Box>
      {disabled ? (
        <Text dimColor>
          {queuedCount > 0
            ? `working… (Esc stops, then runs queue) · ${queuedCount} queued`
            : "working… (Esc to stop) · type to queue a message"}
        </Text>
      ) : null}
    </Box>
  );
}
