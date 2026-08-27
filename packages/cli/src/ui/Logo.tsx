import { Box, Text } from "ink";

// Mirrors branding/logo.svg: a hexagon holding the ">_" prompt, ringed by five colored
// nodes wired back to the center - orange at top, green/teal as the wide upper pair
// (left/right), blue/purple as the lower pair (left/right).
const NODE = {
  orange: "#F97316",
  teal: "#14B8A6",
  purple: "#8B5CF6",
  blue: "#4C6FFF",
  green: "#22C55E",
} as const;

// Plain ASCII "/" and "\" rather than the Unicode box-drawing diagonals (╱ ╲) - those aren't
// guaranteed truly monospace in every terminal font, which is exactly what broke this the last
// two times; ASCII slashes carry no such risk. Columns are hand-aligned so every diagonal
// terminates on the hexagon border or a node dot.
export function Logo() {
  return (
    <Box flexDirection="column">
      <Box>
        <Text>{"          "}</Text>
        <Text color={NODE.orange}>●</Text>
      </Box>
      <Text dimColor>{"          |"}</Text>
      <Text dimColor>{"         /\\"}</Text>
      <Text dimColor>{"        /  \\"}</Text>
      <Box>
        <Text>{"   "}</Text>
        <Text color={NODE.green}>●</Text>
        <Text dimColor>{"───┤ "}</Text>
        <Text bold color="#F4F5F7">
          {">_"}
        </Text>
        <Text dimColor>{" ├───"}</Text>
        <Text color={NODE.teal}>●</Text>
      </Box>
      <Text dimColor>{"        \\  /"}</Text>
      <Text dimColor>{"         \\/"}</Text>
      <Text dimColor>{"       /    \\"}</Text>
      <Box>
        <Text>{"      "}</Text>
        <Text color={NODE.blue}>●</Text>
        <Text>{"      "}</Text>
        <Text color={NODE.purple}>●</Text>
      </Box>
    </Box>
  );
}
