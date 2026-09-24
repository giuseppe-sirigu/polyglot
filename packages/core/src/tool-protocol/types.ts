import type { RepairStrategy } from "./json-repair.js";

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
  /** Which repair path resolved this call - "clean" for a bare `JSON.parse`, otherwise which
   * fallback fired. Present whenever `repairJson` itself produced the value (both free-text
   * paths); absent for the schema-extraction fallback (`extractBySchema`) and structured-output
   * mode, neither of which goes through `repairJson` per call. Feeds the reliability
   * digest's "flag low-confidence repairs for review" logic (`report/generate.ts`). */
  strategy?: RepairStrategy;
}

export interface ToolCallParseError {
  raw: string;
  message: string;
  attemptedName: string | null;
}
