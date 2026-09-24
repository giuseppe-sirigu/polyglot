import { randomUUID } from "node:crypto";
import type { AuditEvent } from "./audit-log.js";

export interface CentralAuditReporter {
  record(event: AuditEvent): void;
  /** Flushes any queued events and stops the background timer. Safe to call more than once. */
  close(): Promise<void>;
}

interface CentralAuditWireEvent {
  source: "cli";
  source_event_id: string;
  session_id: string;
  at: string;
  model: string | null;
  kind: string;
  tool_name: string | null;
  is_error: boolean | null;
  args_hash: string | null;
  repaired: boolean | null;
  raw_call?: string;
}

const NOOP_REPORTER: CentralAuditReporter = {
  record() {},
  async close() {},
};

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Projects the same `AuditEvent` the local sink writes onto the control plane's wire shape.
 * `argsHash` is always present on a `tool_call` event regardless of the local `hashArgs`
 * setting (see audit-log.ts), so it's always safe to forward - only the verbatim `rawCall`
 * (present on every repaired tool_call, also regardless of local hashArgs) is gated by
 * `includeRawCalls`, the same trust-boundary dial the Gateway's own push uses.
 */
function toWireEvent(event: AuditEvent, includeRawCalls: boolean): CentralAuditWireEvent {
  const base = {
    source: "cli" as const,
    source_event_id: randomUUID(),
    session_id: event.sessionId,
    at: event.at,
    model: event.model,
  };
  switch (event.kind) {
    case "tool_call":
      return {
        ...base,
        kind: event.kind,
        tool_name: event.toolName,
        is_error: false,
        args_hash: event.argsHash,
        repaired: event.repaired ?? false,
        ...(includeRawCalls && event.rawCall ? { raw_call: event.rawCall } : {}),
      };
    case "tool_result":
      return {
        ...base,
        kind: event.kind,
        tool_name: event.toolName,
        is_error: event.isError,
        args_hash: null,
        repaired: null,
      };
    case "tool_parse_error":
      return {
        ...base,
        kind: event.kind,
        tool_name: event.attemptedName,
        is_error: true,
        args_hash: null,
        repaired: false,
      };
    case "permission_decision":
      return {
        ...base,
        kind: event.kind,
        tool_name: event.toolName,
        is_error: event.decision === "deny",
        args_hash: null,
        repaired: null,
      };
    case "hook_blocked":
      return {
        ...base,
        kind: event.kind,
        tool_name: null,
        is_error: true,
        args_hash: null,
        repaired: null,
      };
    default:
      // turn_start / content_findings / usage / agent_stop - no tool-call-shaped fields, but
      // still worth a row for a session's full drill-down trail (e.g. "agent stopped because
      // the model wasn't reliably producing valid tool calls").
      return {
        ...base,
        kind: event.kind,
        tool_name: null,
        is_error: null,
        args_hash: null,
        repaired: null,
      };
  }
}

/**
 * The CLI-side half of the pulled-forward-from-B3 visibility work (see the gateway MVP
 * plan's "Pulling forward action-level visibility" section) - opt-in, reports to a
 * customer's own control plane over `POLYGLOT_CONTROL_PLANE_URL`/`_TOKEN`, independent of
 * whether this session's traffic ever touches a Gateway at all. Same shape as
 * `createAuditSink`/`createTelemetrySink` so it wires into the same `onEvent` callback
 * without a separate call site. Batches (flushes at `BATCH_SIZE` events or every
 * `FLUSH_INTERVAL_MS`, whichever first) and fails static on any network error - a CLI run is
 * short-lived with nowhere durable to retry from, so a failed flush drops that batch rather
 * than blocking the turn or crashing the process, matching every other control-plane call in
 * this codebase.
 */
export function createCentralAuditReporter(opts: {
  enabled: boolean;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  includeRawCalls?: boolean;
}): CentralAuditReporter {
  if (!opts.enabled || !opts.controlPlaneUrl || !opts.controlPlaneToken) return NOOP_REPORTER;
  const url = opts.controlPlaneUrl;
  const token = opts.controlPlaneToken;
  const includeRawCalls = opts.includeRawCalls ?? false;

  let queue: CentralAuditWireEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = setInterval(
    () => void flush(),
    FLUSH_INTERVAL_MS,
  );
  timer.unref?.();

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      await fetch(`${url}/v1/audit/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Fail static - see the doc comment above.
    }
  }

  return {
    record(event: AuditEvent) {
      queue.push(toWireEvent(event, includeRawCalls));
      if (queue.length >= BATCH_SIZE) void flush();
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = null;
      await flush();
    },
  };
}
