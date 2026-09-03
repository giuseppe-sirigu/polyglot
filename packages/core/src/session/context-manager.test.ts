import { describe, expect, it } from "vitest";
import type { ChatRequest, ProviderAdapter, ProviderStreamEvent } from "../providers/types.js";
import { compactSession, sessionContextTokens, shouldCompact } from "./context-manager.js";
import { type Session, createSession } from "./types.js";

function sessionWith(overrides: Partial<Session> = {}): Session {
  return {
    ...createSession({ cwd: "/tmp", provider: "openai-compatible", model: "m" }),
    ...overrides,
  };
}

const adapter = {
  capabilities: { nativeToolCalling: "none", maxContextTokens: 1000, structuredOutput: false },
} as ProviderAdapter;

describe("sessionContextTokens", () => {
  it("falls back to the char estimate when no turn has reported usage", () => {
    const session = sessionWith({
      messages: [{ id: "1", role: "user", content: "x".repeat(400), createdAt: 0 }],
    });
    expect(sessionContextTokens(session)).toBe(100); // 400 chars / 4
  });

  it("prefers the provider-measured count when present", () => {
    const session = sessionWith({
      messages: [{ id: "1", role: "user", content: "x".repeat(400), createdAt: 0 }],
      lastContextTokens: 730,
    });
    expect(sessionContextTokens(session)).toBe(730);
  });
});

describe("shouldCompact", () => {
  it("uses the measured count against the context window", () => {
    expect(shouldCompact(sessionWith({ lastContextTokens: 760 }), adapter)).toBe(true);
    expect(shouldCompact(sessionWith({ lastContextTokens: 740 }), adapter)).toBe(false);
  });
});

describe("compactSession", () => {
  function recordingAdapter(): ProviderAdapter & { models: string[] } {
    const models: string[] = [];
    return {
      id: "rec",
      models,
      capabilities: { nativeToolCalling: "none", maxContextTokens: 1000, structuredOutput: false },
      async *chat(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
        models.push(request.model);
        yield { type: "text_delta", delta: "summary" };
        yield { type: "message_stop", stopReason: "end_turn" };
      },
    };
  }

  const longSession = () =>
    sessionWith({
      messages: Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `message ${i}`,
        createdAt: i,
      })),
    });

  it("summarises on the session's own model by default", async () => {
    const a = recordingAdapter();
    await compactSession(longSession(), a);
    expect(a.models).toEqual(["m"]);
  });

  it("summarises on opts.model when given", async () => {
    const a = recordingAdapter();
    await compactSession(longSession(), a, { model: "cheap-summariser" });
    expect(a.models).toEqual(["cheap-summariser"]);
  });
});
