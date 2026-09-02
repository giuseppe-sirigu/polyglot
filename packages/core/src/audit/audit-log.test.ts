import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../agent/events.js";
import {
  type AuditEventContext,
  auditEventFromAgentEvent,
  createAuditSink,
  hashToolInput,
  pruneAuditLogs,
} from "./audit-log.js";

const ctx: AuditEventContext = {
  sessionId: "s1",
  model: "qwen3-coder",
  at: "2026-08-31T00:00:00Z",
  hashArgs: true,
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "polyglot-audit-"));
}

describe("hashToolInput", () => {
  it("is stable and independent of key order", () => {
    expect(hashToolInput({ a: 1, b: 2 })).toBe(hashToolInput({ b: 2, a: 1 }));
    expect(hashToolInput({ a: { x: 1, y: 2 } })).toBe(hashToolInput({ a: { y: 2, x: 1 } }));
  });

  it("distinguishes different values and handles nullish input", () => {
    expect(hashToolInput({ a: 1 })).not.toBe(hashToolInput({ a: 2 }));
    expect(hashToolInput(undefined)).toBe(hashToolInput(null));
    expect(hashToolInput(undefined)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("auditEventFromAgentEvent", () => {
  it("drops per-token and redundant events", () => {
    expect(auditEventFromAgentEvent({ type: "text_delta", delta: "x" }, ctx)).toBeNull();
    expect(auditEventFromAgentEvent({ type: "turn_end", stopReason: "end_turn" }, ctx)).toBeNull();
  });

  it("hashes tool-call args by default and stamps the envelope", () => {
    const event = auditEventFromAgentEvent(
      {
        type: "tool_call",
        toolCallId: "tc1",
        name: "edit_file",
        input: { path: "a.ts", old_string: "secret" },
      },
      ctx,
    );
    expect(event).toMatchObject({
      kind: "tool_call",
      at: "2026-08-31T00:00:00Z",
      sessionId: "s1",
      model: "qwen3-coder",
      toolName: "edit_file",
      argsHash: expect.stringMatching(/^sha256:/),
    });
    expect(event && "args" in event).toBe(false);
  });

  it("keeps raw args when hashArgs is false", () => {
    const event = auditEventFromAgentEvent(
      {
        type: "tool_call",
        toolCallId: "tc2",
        name: "bash",
        input: { command: "ls" },
        correctedFromName: "bahs",
      },
      { ...ctx, hashArgs: false },
    );
    expect(event).toMatchObject({ args: { command: "ls" }, correctedFromName: "bahs" });
  });

  it("records byte length and a hash for tool results", () => {
    const event = auditEventFromAgentEvent(
      {
        type: "tool_result",
        toolCallId: "tc3",
        name: "read_file",
        resultText: "hello",
        isError: false,
      },
      ctx,
    );
    expect(event).toMatchObject({
      kind: "tool_result",
      resultBytes: 5,
      resultHash: expect.stringMatching(/^sha256:/),
      isError: false,
    });
  });

  it("maps permission decisions, usage, stops and parse errors", () => {
    expect(
      auditEventFromAgentEvent(
        {
          type: "permission_decision",
          toolCallId: "tc4",
          toolName: "bash",
          decision: "deny",
          reason: "blocked",
        },
        ctx,
      ),
    ).toMatchObject({ kind: "permission_decision", decision: "deny", reason: "blocked" });
    expect(
      auditEventFromAgentEvent({ type: "usage", inputTokens: 10, outputTokens: 3 }, ctx),
    ).toMatchObject({ kind: "usage", inputTokens: 10, outputTokens: 3 });
    expect(
      auditEventFromAgentEvent({ type: "agent_stop", reason: "unreliable_model" }, ctx),
    ).toMatchObject({ kind: "agent_stop", reason: "unreliable_model" });
    expect(
      auditEventFromAgentEvent(
        { type: "tool_parse_error", toolCallId: "tc5", attemptedName: null, message: "bad json" },
        ctx,
      ),
    ).toMatchObject({ kind: "tool_parse_error", attemptedName: null, message: "bad json" });
  });
});

describe("createAuditSink", () => {
  it("is a no-op when disabled - writes nothing", async () => {
    const dir = tmp();
    const sink = createAuditSink({ enabled: false, sessionId: "s1", path: dir });
    sink.record({ kind: "turn_start", at: "t", sessionId: "s1", model: "m" });
    await sink.close();
    expect(() => readFileSync(join(dir, "s1.jsonl"), "utf8")).toThrow();
  });

  it("appends one JSON object per line, in order, flushed by close()", async () => {
    const dir = tmp();
    const sink = createAuditSink({ enabled: true, sessionId: "s1", path: dir });
    sink.record({ kind: "turn_start", at: "t1", sessionId: "s1", model: "m" });
    sink.record({ kind: "agent_stop", at: "t2", sessionId: "s1", model: "m", reason: "done" });
    await sink.close();
    const parsed = readFileSync(join(dir, "s1.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ kind: "turn_start", at: "t1" });
    expect(parsed[1]).toMatchObject({ kind: "agent_stop", at: "t2" });
  });
});

describe("pruneAuditLogs", () => {
  it("removes files older than the cutoff, spares exceptId, and no-ops on a missing dir", async () => {
    const dir = tmp();
    const old = join(dir, "old.jsonl");
    const fresh = join(dir, "fresh.jsonl");
    const active = join(dir, "active.jsonl");
    for (const f of [old, fresh, active]) writeFileSync(f, "{}\n");
    const past = Date.now() - 40 * 86_400_000;
    const { utimesSync } = await import("node:fs");
    utimesSync(old, past / 1000, past / 1000);
    utimesSync(active, past / 1000, past / 1000);

    const removed = await pruneAuditLogs(30, { path: dir, exceptId: "active" });
    expect(removed).toBe(1);
    expect(readFileSync(fresh, "utf8")).toBe("{}\n");
    expect(readFileSync(active, "utf8")).toBe("{}\n");
    expect(() => readFileSync(old, "utf8")).toThrow();

    expect(await pruneAuditLogs(30, { path: join(dir, "nope") })).toBe(0);
    expect(await pruneAuditLogs(0, { path: dir })).toBe(0);
  });
});
