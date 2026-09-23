import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type TelemetryEventContext,
  createTelemetrySink,
  pruneTelemetryLogs,
  telemetryEventFromAgentEvent,
} from "./telemetry-log.js";

const ctx: TelemetryEventContext = {
  sessionId: "s1",
  model: "qwen3-coder",
  at: "2026-08-31T00:00:00Z",
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "polyglot-telemetry-"));
}

describe("telemetryEventFromAgentEvent", () => {
  it("drops events outside the small tracked set", () => {
    expect(telemetryEventFromAgentEvent({ type: "text_delta", delta: "x" }, ctx)).toBeNull();
    expect(
      telemetryEventFromAgentEvent({ type: "turn_end", stopReason: "end_turn" }, ctx),
    ).toBeNull();
    expect(
      telemetryEventFromAgentEvent(
        {
          type: "tool_result",
          toolCallId: "tc1",
          name: "read_file",
          resultText: "hello",
          isError: false,
        },
        ctx,
      ),
    ).toBeNull();
  });

  it("records whether a tool call needed repair, with no tool name or arguments", () => {
    const event = telemetryEventFromAgentEvent(
      {
        type: "tool_call",
        toolCallId: "tc1",
        name: "edit_file",
        input: { path: "a.ts", old_string: "secret" },
        repaired: true,
      },
      ctx,
    );
    expect(event).toMatchObject({
      kind: "tool_call_parsed",
      at: "2026-08-31T00:00:00Z",
      sessionId: "s1",
      model: "qwen3-coder",
      repaired: true,
    });
    expect(JSON.stringify(event)).not.toMatch(/edit_file|secret/);
  });

  it("maps a parse error and an agent stop", () => {
    expect(
      telemetryEventFromAgentEvent(
        { type: "tool_parse_error", toolCallId: "tc2", attemptedName: null, message: "bad json" },
        ctx,
      ),
    ).toMatchObject({ kind: "tool_parse_error", sessionId: "s1", model: "qwen3-coder" });
    expect(
      telemetryEventFromAgentEvent({ type: "agent_stop", reason: "unreliable_model" }, ctx),
    ).toMatchObject({ kind: "agent_stop", reason: "unreliable_model" });
  });
});

describe("createTelemetrySink", () => {
  it("is a no-op when disabled - writes nothing", async () => {
    const dir = tmp();
    const sink = createTelemetrySink({
      enabled: false,
      sessionId: "s1",
      provider: "anthropic",
      model: "m",
      path: dir,
    });
    sink.record({ kind: "agent_stop", at: "t", sessionId: "s1", model: "m", reason: "done" });
    await sink.close();
    expect(() => readFileSync(join(dir, "s1.jsonl"), "utf8")).toThrow();
  });

  it("writes a session_start record immediately, then appended records in order", async () => {
    const dir = tmp();
    const sink = createTelemetrySink({
      enabled: true,
      sessionId: "s1",
      provider: "openai-compatible",
      model: "qwen2.5-coder",
      baseURLHost: "localhost:11434",
      path: dir,
    });
    sink.record({ kind: "agent_stop", at: "t2", sessionId: "s1", model: "m", reason: "done" });
    await sink.close();
    const parsed = readFileSync(join(dir, "s1.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      kind: "session_start",
      provider: "openai-compatible",
      model: "qwen2.5-coder",
      baseURLHost: "localhost:11434",
    });
    expect(parsed[1]).toMatchObject({ kind: "agent_stop", at: "t2" });
  });
});

describe("pruneTelemetryLogs", () => {
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

    const removed = await pruneTelemetryLogs(30, { path: dir, exceptId: "active" });
    expect(removed).toBe(1);
    expect(readFileSync(fresh, "utf8")).toBe("{}\n");
    expect(readFileSync(active, "utf8")).toBe("{}\n");
    expect(() => readFileSync(old, "utf8")).toThrow();

    expect(await pruneTelemetryLogs(30, { path: join(dir, "nope") })).toBe(0);
    expect(await pruneTelemetryLogs(0, { path: dir })).toBe(0);
  });
});
