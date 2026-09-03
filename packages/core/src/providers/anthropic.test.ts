import { describe, expect, it } from "vitest";
import { buildAnthropicRequest } from "./anthropic.js";
import type { ChatRequest } from "./types.js";

const baseRequest: ChatRequest = {
  model: "claude-sonnet-5",
  messages: [{ role: "user", content: "hi" }],
};

describe("buildAnthropicRequest", () => {
  it("sends the system prompt as a single cache_control text block", () => {
    const body = buildAnthropicRequest({
      ...baseRequest,
      messages: [
        { role: "system", content: "you are a coding agent" },
        { role: "user", content: "hi" },
      ],
    });
    expect(body.system).toEqual([
      { type: "text", text: "you are a coding agent", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("joins multiple system messages with a blank line before caching", () => {
    const body = buildAnthropicRequest({
      ...baseRequest,
      messages: [
        { role: "system", content: "persona" },
        { role: "system", content: "project instructions" },
        { role: "user", content: "hi" },
      ],
    });
    expect(body.system).toEqual([
      {
        type: "text",
        text: "persona\n\nproject instructions",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("omits system when there is no system message", () => {
    expect(buildAnthropicRequest(baseRequest).system).toBeUndefined();
  });

  it("maps non-system messages to user/assistant roles and drops system from the turn list", () => {
    const body = buildAnthropicRequest({
      ...baseRequest,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    expect(body.messages).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });

  it("carries model, temperature, and max_tokens through, defaulting max_tokens", () => {
    const body = buildAnthropicRequest({ ...baseRequest, temperature: 0.3, maxOutputTokens: 200 });
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(200);
    expect(buildAnthropicRequest(baseRequest).max_tokens).toBe(4096);
  });
});
