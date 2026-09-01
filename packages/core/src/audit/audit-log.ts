import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { appendFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.js";

const DAY_MS = 86_400_000;

/**
 * One canonical record in the audit log. Every variant carries the same envelope - an ISO
 * timestamp, the session id, and the model that was active - so a downstream reader (a future
 * Control Tower) never has to correlate across records to know when/where/on-what an action
 * happened. Tool-call arguments and tool results are recorded as SHA-256 hashes by default so
 * the log is safe to ship off the machine.
 */
export type AuditEvent =
  | { kind: "turn_start"; at: string; sessionId: string; model: string }
  | {
      kind: "tool_call";
      at: string;
      sessionId: string;
      model: string;
      toolName: string;
      argsHash: string;
      /** Raw arguments - only present when `hashArgs` is false (local debugging). */
      args?: unknown;
      correctedFromName?: string;
    }
  | {
      kind: "tool_result";
      at: string;
      sessionId: string;
      model: string;
      toolName: string;
      isError: boolean;
      resultBytes: number;
      resultHash: string;
    }
  | {
      kind: "permission_decision";
      at: string;
      sessionId: string;
      model: string;
      toolName: string;
      decision: "allow" | "deny";
      reason?: string;
    }
  | {
      kind: "usage";
      at: string;
      sessionId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      kind: "agent_stop";
      at: string;
      sessionId: string;
      model: string;
      reason: "done" | "max_steps" | "unreliable_model";
    }
  | {
      kind: "tool_parse_error";
      at: string;
      sessionId: string;
      model: string;
      attemptedName: string | null;
      message: string;
    };

export interface AuditSink {
  record(event: AuditEvent): void;
  /** Resolves once every queued write has flushed. Safe to call more than once. */
  close(): Promise<void>;
}

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** Recursively sorts object keys so the hash is independent of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable `"sha256:<hex>"` digest of a tool call's arguments, key-order independent. */
export function hashToolInput(input: unknown): string {
  return sha256(JSON.stringify(canonicalize(input) ?? null));
}

export interface AuditEventContext {
  sessionId: string;
  model: string;
  at: string;
  /** When false, tool-call `args` are recorded raw alongside their hash. */
  hashArgs: boolean;
}

/**
 * Projects one `AgentEvent` onto its `AuditEvent`, or null for events not worth recording
 * (`text_delta` - per token; `turn_end` - redundant with `agent_stop`).
 */
export function auditEventFromAgentEvent(
  event: AgentEvent,
  ctx: AuditEventContext,
): AuditEvent | null {
  const base = { at: ctx.at, sessionId: ctx.sessionId, model: ctx.model };
  switch (event.type) {
    case "turn_start":
      return { kind: "turn_start", ...base };
    case "tool_call":
      return {
        kind: "tool_call",
        ...base,
        toolName: event.name,
        argsHash: hashToolInput(event.input),
        ...(ctx.hashArgs ? {} : { args: event.input }),
        ...(event.correctedFromName ? { correctedFromName: event.correctedFromName } : {}),
      };
    case "tool_result":
      return {
        kind: "tool_result",
        ...base,
        toolName: event.name,
        isError: event.isError,
        resultBytes: Buffer.byteLength(event.resultText, "utf8"),
        resultHash: sha256(event.resultText),
      };
    case "permission_decision":
      return {
        kind: "permission_decision",
        ...base,
        toolName: event.toolName,
        decision: event.decision,
        ...(event.reason ? { reason: event.reason } : {}),
      };
    case "usage":
      return {
        kind: "usage",
        ...base,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };
    case "agent_stop":
      return { kind: "agent_stop", ...base, reason: event.reason };
    case "tool_parse_error":
      return {
        kind: "tool_parse_error",
        ...base,
        attemptedName: event.attemptedName,
        message: event.message,
      };
    default:
      return null;
  }
}

export function auditDir(configuredPath?: string): string {
  return configuredPath ?? join(homedir(), ".polyglot", "audit");
}

function auditFilePath(sessionId: string, configuredPath?: string): string {
  return join(auditDir(configuredPath), `${sessionId}.jsonl`);
}

const NOOP_SINK: AuditSink = {
  record() {},
  async close() {},
};

/**
 * A per-session JSONL audit sink. Writes are serialized through a promise chain so records land
 * in order without blocking the caller; `close()` awaits the tail. A write failure is swallowed
 * (an audit log must never crash a turn). Returns a no-op sink when `enabled` is false.
 */
export function createAuditSink(opts: {
  enabled: boolean;
  sessionId: string;
  path?: string;
  hashArgs?: boolean;
}): AuditSink {
  if (!opts.enabled) return NOOP_SINK;

  const file = auditFilePath(opts.sessionId, opts.path);
  mkdirSync(auditDir(opts.path), { recursive: true });

  let tail: Promise<void> = Promise.resolve();
  return {
    record(event: AuditEvent) {
      const line = `${JSON.stringify(event)}\n`;
      tail = tail.then(() => appendFile(file, line, "utf8")).catch(() => {});
    },
    async close() {
      await tail;
    },
  };
}

/** Deletes audit-log files older than `maxAgeDays`; mirrors `pruneSessions`. */
export async function pruneAuditLogs(
  maxAgeDays: number,
  opts: { path?: string; exceptId?: string } = {},
): Promise<number> {
  if (!(maxAgeDays > 0)) return 0;
  const dir = auditDir(opts.path);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  let removed = 0;
  for (const file of files) {
    if (opts.exceptId && file === `${opts.exceptId}.jsonl`) continue;
    try {
      const { mtimeMs } = await stat(join(dir, file));
      if (mtimeMs < cutoff) {
        await rm(join(dir, file), { force: true });
        removed++;
      }
    } catch {
      // skip
    }
  }
  return removed;
}
