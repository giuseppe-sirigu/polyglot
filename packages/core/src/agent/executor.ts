import type { PermissionGate } from "../permissions/gate.js";
import type { ParsedToolCall } from "../tool-protocol/types.js";
import type { ToolRegistry } from "../tools/types.js";

export interface ExecutedToolCall {
  toolCallId: string;
  toolName: string;
  resultText: string;
  isError: boolean;
  /** The permission-gate outcome for this call (an unregistered tool is reported as a deny). */
  permission: { decision: "allow" | "deny"; reason?: string };
}

export interface ExecuteToolCallContext {
  cwd: string;
  sessionId: string;
  signal: AbortSignal;
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
    return {
      toolCallId: call.id,
      toolName: tool.name,
      resultText: result.toModelText(),
      isError: Boolean(result.isError),
      permission,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolCallId: call.id,
      toolName: tool.name,
      resultText: `Tool execution threw an error: ${message}`,
      isError: true,
      permission,
    };
  }
}
