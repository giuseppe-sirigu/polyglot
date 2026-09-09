import type { PermissionGate } from "../permissions/gate.js";
import type { ContentFinding } from "../permissions/secret-patterns.js";
import type { ParsedToolCall } from "../tool-protocol/types.js";
import type { ToolRegistry } from "../tools/types.js";

export interface ExecutedToolCall {
  toolCallId: string;
  toolName: string;
  resultText: string;
  isError: boolean;
  /** The permission-gate outcome for this call (an unregistered tool is reported as a deny). */
  permission: { decision: "allow" | "deny"; reason?: string };
  /** Secret- / PII-looking values found in the result by `ctx.scanOutput`, if any. When
   * `redacted` is true, `resultText` above is already the scrubbed text. */
  findings?: ContentFinding[];
  redacted?: boolean;
}

/** Scans a tool result before it becomes `resultText` (→ the model's context, the transcript,
 * and the audit log). In warn mode `text` comes back unchanged (`redacted: false`); in redact
 * mode matches are replaced (`redacted: true`). Built from `redaction` settings in the
 * frontends - see App.tsx / headless.ts. */
export type ScanToolOutput = (input: {
  toolName: string;
  text: string;
  isError: boolean;
}) => { text: string; findings: ContentFinding[]; redacted: boolean };

export interface ExecuteToolCallContext {
  cwd: string;
  sessionId: string;
  signal: AbortSignal;
  scanOutput?: ScanToolOutput;
}

export async function executeToolCall(
  call: ParsedToolCall,
  registry: ToolRegistry,
  gate: PermissionGate,
  ctx: ExecuteToolCallContext,
): Promise<ExecutedToolCall> {
  const tool = registry.get(call.name);
  if (!tool) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      resultText: `Tool "${call.name}" is not registered.`,
      isError: true,
      permission: { decision: "deny", reason: "unknown tool" },
    };
  }

  const decision = await gate.evaluate({
    toolName: tool.name,
    category: tool.permission,
    input: call.input,
    cwd: ctx.cwd,
    loadDiff: tool.previewDiff
      ? () =>
          tool.previewDiff?.(call.input, {
            cwd: ctx.cwd,
            sessionId: ctx.sessionId,
            signal: ctx.signal,
          }) ?? Promise.resolve(null)
      : undefined,
  });
  const permission: ExecutedToolCall["permission"] = {
    decision: decision.decision,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };

  if (decision.decision === "deny") {
    return {
      toolCallId: call.id,
      toolName: tool.name,
      resultText: `Permission denied: ${decision.reason ?? "the user declined this action."}`,
      isError: true,
      permission,
    };
  }

  try {
    const result = await tool.execute(call.input, {
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    });
    const isError = Boolean(result.isError);
    return {
      toolCallId: call.id,
      toolName: tool.name,
      permission,
      ...scan(ctx, tool.name, result.toModelText(), isError),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolCallId: call.id,
      toolName: tool.name,
      permission,
      ...scan(ctx, tool.name, `Tool execution threw an error: ${message}`, true),
    };
  }
}

/** Runs `ctx.scanOutput` over a tool result, returning the (possibly redacted) text, the
 * error flag, and any findings. A no-op passthrough when no scanner is configured. */
function scan(
  ctx: ExecuteToolCallContext,
  toolName: string,
  text: string,
  isError: boolean,
): { resultText: string; isError: boolean; findings?: ContentFinding[]; redacted?: boolean } {
  if (!ctx.scanOutput) return { resultText: text, isError };
  const { text: scanned, findings, redacted } = ctx.scanOutput({ toolName, text, isError });
  if (findings.length === 0) return { resultText: scanned, isError };
  return { resultText: scanned, isError, findings, redacted };
}
