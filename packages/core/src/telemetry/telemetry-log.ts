import { mkdirSync } from "node:fs";
import { appendFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.js";

const DAY_MS = 86_400_000;

/**
 * One canonical record in the telemetry log. Deliberately much narrower than the audit log: no
 * tool names, no arguments (hashed or otherwise), no raw model output, no prompts - just which
 * provider/model/base-URL host polyglot ran against, and whether tool-call parsing needed
 * repair or failed outright. Local-only for now: this is written under ~/.polyglot/telemetry
 * and never sent anywhere over the network.
 */
export type TelemetryEvent =
  | {
      kind: "session_start";
      at: string;
      sessionId: string;
      provider: "anthropic" | "openai-compatible";
      model: string;
      /** Hostname only (e.g. "localhost:11434") - never the full URL, so no path, query
       * string, or embedded credential ever lands in the log. */
      baseURLHost?: string;
    }
  | { kind: "tool_call_parsed"; at: string; sessionId: string; model: string; repaired: boolean }
  | { kind: "tool_parse_error"; at: string; sessionId: string; model: string }
  | {
      kind: "agent_stop";
      at: string;
      sessionId: string;
      model: string;
      reason: "done" | "max_steps" | "unreliable_model";
    };

export interface TelemetrySink {
  record(event: TelemetryEvent): void;
  /** Resolves once every queued write has flushed. Safe to call more than once. */
  close(): Promise<void>;
}

export interface TelemetryEventContext {
  sessionId: string;
  model: string;
  at: string;
}

/** Projects one `AgentEvent` onto its `TelemetryEvent`, or null for events not worth recording. */
export function telemetryEventFromAgentEvent(
  event: AgentEvent,
  ctx: TelemetryEventContext,
): TelemetryEvent | null {
  const base = { at: ctx.at, sessionId: ctx.sessionId, model: ctx.model };
  switch (event.type) {
    case "tool_call":
      return { kind: "tool_call_parsed", ...base, repaired: Boolean(event.repaired) };
    case "tool_parse_error":
      return { kind: "tool_parse_error", ...base };
    case "agent_stop":
      return { kind: "agent_stop", ...base, reason: event.reason };
    default:
      return null;
  }
}

export function telemetryDir(configuredPath?: string): string {
  return configuredPath ?? join(homedir(), ".polyglot", "telemetry");
}

function telemetryFilePath(sessionId: string, configuredPath?: string): string {
  return join(telemetryDir(configuredPath), `${sessionId}.jsonl`);
}

const NOOP_SINK: TelemetrySink = {
  record() {},
  async close() {},
};

/**
 * A per-session JSONL telemetry sink. Mirrors `createAuditSink`: writes are serialized through a
 * promise chain so records land in order without blocking the caller, a write failure is
 * swallowed (telemetry must never crash a turn), and a no-op sink comes back when `enabled` is
 * false. Unlike the audit sink, this one writes a `session_start` record immediately on
 * creation - there's exactly one per session, so there's no separate call site to remember it.
 */
export function createTelemetrySink(opts: {
  enabled: boolean;
  sessionId: string;
  provider: "anthropic" | "openai-compatible";
  model: string;
  baseURLHost?: string;
  path?: string;
}): TelemetrySink {
  if (!opts.enabled) return NOOP_SINK;

  const file = telemetryFilePath(opts.sessionId, opts.path);
  mkdirSync(telemetryDir(opts.path), { recursive: true });

  let tail: Promise<void> = Promise.resolve();
  const sink: TelemetrySink = {
    record(event: TelemetryEvent) {
      const line = `${JSON.stringify(event)}\n`;
      tail = tail.then(() => appendFile(file, line, "utf8")).catch(() => {});
    },
    async close() {
      await tail;
    },
  };
  sink.record({
    kind: "session_start",
    at: new Date().toISOString(),
    sessionId: opts.sessionId,
    provider: opts.provider,
    model: opts.model,
    baseURLHost: opts.baseURLHost,
  });
  return sink;
}

/** Deletes telemetry-log files older than `maxAgeDays`; mirrors `pruneAuditLogs`. */
export async function pruneTelemetryLogs(
  maxAgeDays: number,
  opts: { path?: string; exceptId?: string } = {},
): Promise<number> {
  if (!(maxAgeDays > 0)) return 0;
  const dir = telemetryDir(opts.path);
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
