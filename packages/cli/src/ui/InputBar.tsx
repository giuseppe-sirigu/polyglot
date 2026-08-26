import { Box, Text } from "ink";
import { MultilineTextInput } from "./MultilineTextInput.js";
import { theme } from "./theme.js";

export interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
}

export function InputBar({ value, onChange, onSubmit, disabled }: InputBarProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={disabled ? "gray" : theme.signal}
      paddingX={1}
      marginTop={1}
    >
      <Text color={theme.signal}>› </Text>
      {disabled ? (
        <Text dimColor>working…</Text>
      ) : (
        <MultilineTextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      )}
    </Box>
  );
}
