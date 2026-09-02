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
  /** True when the call needed more than a bare JSON.parse to resolve - a repaired body,
   * a stripped wrapper, args pulled out by parameter name, or a fuzzy-matched tool name.
   * The frontend flags these and keeps `raw` available so a repair can't silently mask a
   * model getting worse. */
  repaired?: boolean;
}

export interface ToolCallParseError {
  raw: string;
  message: string;
  attemptedName: string | null;
}
