import { Text } from "ink";
import { useEffect, useState } from "react";
import { theme } from "./theme.js";

// A little branding wink at the name "polyglot" - cycles "thinking…" through a handful of the
// world's most widely spoken languages while a turn is in progress. Always starts on English:
// this component only exists while isRunning && !streamingText is true in App.tsx, so it fully
// unmounts between turns and remounts fresh (frame resets to 0) the next time one starts.
const WORDS = [
  " thinking…",
  " pensando…", // Spanish
  " sto pensando…", // Italian
  " 思考中…", // Mandarin
  " सोच रहा है…", // Hindi
  " je réfléchis…", // French
  " يفكر…", // Arabic
  " refletindo…", // Portuguese
  " думаю…", // Russian
  " 考え中…", // Japanese
  " denke nach…", // German
];
const INTERVAL_MS = 1500;

export function ThinkingLabel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % WORDS.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return <Text color={theme.dim}>{WORDS[index]}</Text>;
}
