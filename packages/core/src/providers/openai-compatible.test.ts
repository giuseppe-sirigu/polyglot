import { describe, expect, it } from "vitest";
import { buildOpenAIRequestBody } from "./openai-compatible.js";
import type { ChatRequest } from "./types.js";

const baseRequest: ChatRequest = {
  model: "qwen2.5-coder-24k",
  messages: [{ role: "user", content: "hi" }],
};

describe("buildOpenAIRequestBody", () => {
  it("omits response_format when no responseSchema is set", () => {
    const body = buildOpenAIRequestBody(baseRequest);
    expect(body.response_format).toBeUndefined();
  });

  it("sends a json_schema response_format when responseSchema is set", () => {
    const schema = { type: "object", properties: {} };
    const body = buildOpenAIRequestBody({ ...baseRequest, responseSchema: schema });
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "polyglot_tool_envelope",
        schema,
        strict: true,
      },
    });
  });

  it("carries model, messages, temperature, and max_tokens through unchanged", () => {
    const body = buildOpenAIRequestBody({ ...baseRequest, temperature: 0.5, maxOutputTokens: 100 });
    expect(body.model).toBe("qwen2.5-coder-24k");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
    expect(body.stream).toBe(true);
  });
});
