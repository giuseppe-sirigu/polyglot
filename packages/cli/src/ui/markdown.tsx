import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme.js";

interface Block {
  type: "heading" | "code" | "list" | "paragraph";
  level?: number;
  lang?: string;
  ordered?: boolean;
  lines: string[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^\s*([-*]|\d+\.)\s+(.*)$/;
const FENCE_RE = /^```/;

/** Splits markdown source into a small set of block types. Not a full CommonMark parser -
 * scoped to what the model actually produces (headings, fences, lists, paragraphs). An
 * unclosed trailing fence (the model is still mid-code-block while streaming) is rendered as
 * an open code block containing whatever content has arrived so far, rather than erroring or
 * falling back to a paragraph - this is what keeps live streaming from glitching mid-fence. */
function splitBlocks(text: string): Block[] {
  const rawLines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i] ?? "";

    if (FENCE_RE.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !FENCE_RE.test(rawLines[i] ?? "")) {
        codeLines.push(rawLines[i] ?? "");
        i++;
      }
      if (i < rawLines.length) i++; // consume closing fence, if present
      // A fence that ends up with no real content is almost always the empty shell left behind
      // after a <tool_call> block nested inside it got sliced out by the tool-call parser (the
      // model put a call inside a code fence despite being told not to) - skip it rather than
      // rendering a bordered box with nothing but a language label in it.
      if (codeLines.some((l) => l.trim().length > 0)) {
        blocks.push({ type: "code", lang, lines: codeLines });
      }
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: (heading[1] ?? "").length, lines: [heading[2] ?? ""] });
      i++;
      continue;
    }

    const listItem = LIST_RE.exec(line);
    if (listItem) {
      blocks.push({
        type: "list",
        ordered: /\d+\./.test(listItem[1] ?? ""),
        lines: [listItem[2] ?? ""],
      });
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const paraLines = [line];
    i++;
    while (
      i < rawLines.length &&
      (rawLines[i] ?? "").trim() !== "" &&
      !FENCE_RE.test(rawLines[i] ?? "") &&
      !HEADING_RE.test(rawLines[i] ?? "") &&
      !LIST_RE.test(rawLines[i] ?? "")
    ) {
      paraLines.push(rawLines[i] ?? "");
      i++;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }

  return blocks;
}

/** Left-to-right scan for bold, italic, and inline code spans. A marker with no matching
 * close (e.g. text ends mid "**bo" while streaming) simply never matches, so it falls
 * through as literal text instead of leaving an open, unclosed styled span. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const spanRe = /\*\*(.+?)\*\*|`([^`]+?)`|\*([^*]+?)\*|_([^_]+?)_/;
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const match = spanRe.exec(remaining);
    if (!match) {
      nodes.push(<Text key={`${keyPrefix}-${key++}`}>{remaining}</Text>);
      break;
    }
    if (match.index > 0) {
      nodes.push(<Text key={`${keyPrefix}-${key++}`}>{remaining.slice(0, match.index)}</Text>);
    }
    if (match[1] !== undefined) {
      nodes.push(
        <Text key={`${keyPrefix}-${key++}`} bold>
          {match[1]}
        </Text>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <Text key={`${keyPrefix}-${key++}`} color={theme.toolName}>
          {match[2]}
        </Text>,
      );
    } else {
      const italic = match[3] ?? match[4] ?? "";
      nodes.push(
        <Text key={`${keyPrefix}-${key++}`} italic>
          {italic}
        </Text>,
      );
    }
    remaining = remaining.slice(match.index + match[0].length);
  }

  return nodes;
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <Text key={key} bold color={theme.signal}>
          {renderInline(block.lines.join(" "), key)}
        </Text>
      );

    case "code":
      return (
        <Box
          key={key}
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.dim}
          paddingX={1}
        >
          {block.lang ? <Text dimColor>{block.lang}</Text> : null}
          {block.lines.map((line, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static per render, lines never reorder
            <Text key={idx}>{line.length > 0 ? line : " "}</Text>
          ))}
        </Box>
      );

    case "list":
      return (
        <Box key={key}>
          <Text dimColor>{block.ordered ? "1. " : "• "}</Text>
          <Text>{renderInline(block.lines.join(" "), key)}</Text>
        </Box>
      );
    default:
      return <Text key={key}>{renderInline(block.lines.join(" "), key)}</Text>;
  }
}

export function renderMarkdown(text: string): ReactNode {
  if (!text) return null;
  const blocks = splitBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are re-derived fresh every render, no stable id
        <Box key={idx} marginTop={idx > 0 ? 1 : 0}>
          {renderBlock(block, String(idx))}
        </Box>
      ))}
    </Box>
  );
}
