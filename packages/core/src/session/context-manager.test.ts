import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "../providers/types.js";
import { sessionContextTokens, shouldCompact } from "./context-manager.js";
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
