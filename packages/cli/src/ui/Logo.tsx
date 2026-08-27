import { Box, Text } from "ink";

// Matches branding/logo.svg's five node colors, arranged the same way: orange at top,
// teal/purple on the right (upper/lower), blue/green on the left (lower/upper).
const NODE = {
  orange: "#F97316",
  teal: "#14B8A6",
  purple: "#8B5CF6",
  blue: "#4C6FFF",
  green: "#22C55E",
} as const;

// Column math (0-indexed), so every diagonal actually terminates on a dot instead of just
// trailing off into blank space: the bar row's inner brackets sit at col 4 ("┤") and col 9
// ("├"). Going up, each row converges the /\ pair by 1 column per row until they meet at a
// single point (the top dot). Going down, the same 1-column-per-row step diverges outward
// instead, landing on two separate dots (blue/purple) rather than one.
//
// Plain ASCII "/" and "\" rather than the Unicode box-drawing diagonals (╱ ╲) - those aren't
// guaranteed truly monospace in every terminal font, which is exactly what broke this the last
// two times; ASCII slashes carry no such risk.
export function Logo() {
  return (
    <Box flexDirection="column">
      <Box>
        <Text>{"      "}</Text>
        <Text color={NODE.orange}>●</Text>
      </Box>
      <Text>{"     /  \\"}</Text>
      <Text>{"    /    \\"}</Text>
      <Box>
        <Text color={NODE.green}>●</Text>
        <Text dimColor>{"───┤ "}</Text>
        <Text bold color="#F4F5F7">
          {">_"}
        </Text>
        <Text dimColor>{" ├───"}</Text>
        <Text color={NODE.teal}>●</Text>
      </Box>
      <Text>{"    \\    /"}</Text>
      <Text>{"   \\      /"}</Text>
      <Box>
        <Text>{"  "}</Text>
        <Text color={NODE.blue}>●</Text>
        <Text>{"        "}</Text>
        <Text color={NODE.purple}>●</Text>
      </Box>
    </Box>
  );
}
