export type ToolCallEnvelopeVariant = "xml" | "fenced";

export interface RawToolCallEnvelope {
  variant: ToolCallEnvelopeVariant;
  declaredName: string | null;
  body: string;
  raw: string;
}

export type ParserEvent =
  | { type: "text"; text: string }
  | { type: "envelope"; envelope: RawToolCallEnvelope };

export interface ParsedToolCall {
  id: string;
  name: string;
  input: unknown;
  raw: string;
  correctedFromName?: string;
}

export interface ToolCallParseError {
  raw: string;
  message: string;
  attemptedName: string | null;
}
