import { Text } from "ink";
import { useEffect, useState } from "react";
import { theme } from "./theme.js";

// A pulse between hollow, dotted, and filled diamond - a "rotating" take on the ◈ brand mark.
// Ink repaints its entire dynamic region on every state change anywhere in the tree, so this
// interval trades a bit of animation smoothness for meaningfully fewer full-terminal redraws.
const FRAMES = ["◇", "◈", "◆", "◈"];
const INTERVAL_MS = 220;

export function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return <Text color={theme.signal}>{FRAMES[frame]}</Text>;
}
