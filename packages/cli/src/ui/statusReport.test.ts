import { describe, expect, it } from "vitest";
import {
  type StatusReportFields,
  describeEndpoint,
  formatHooksLine,
  formatStatusReport,
} from "./statusReport.js";

describe("formatHooksLine", () => {
  it("is 'none' with no hooks", () => {
    expect(formatHooksLine({ preToolUse: [], postToolUse: [], userPromptSubmit: [] })).toBe("none");
  });
  it("lists only the non-empty events with counts", () => {
    expect(formatHooksLine({ preToolUse: [1, 2], postToolUse: [], userPromptSubmit: [1] })).toBe(
      "preToolUse(2) userPromptSubmit(1)",
    );
  });
});

describe("describeEndpoint", () => {
  it("marks the Anthropic API as data-leaves-machine", () => {
    expect(describeEndpoint("anthropic", undefined)).toMatch(/api\.anthropic\.com/);
    expect(describeEndpoint("anthropic", undefined)).toMatch(/leaves this machine/);
  });

  it("marks a localhost base URL as local", () => {
    expect(describeEndpoint("openai-compatible", "http://localhost:11434/v1")).toMatch(
      /nothing leaves this machine/,
    );
    expect(describeEndpoint("openai-compatible", "http://127.0.0.1:1234/v1")).toMatch(
      /nothing leaves this machine/,
    );
  });

  it("marks a remote base URL as data-leaves-machine", () => {
    expect(describeEndpoint("openai-compatible", "https://api.example.com/v1")).toMatch(
      /leaves this machine/,
    );
  });
});

describe("formatStatusReport", () => {
  const base: StatusReportFields = {
    provider: "openai-compatible",
    model: "qwen2.5-coder",
    baseURL: "http://localhost:11434/v1",
    permissionMode: "manual",
    webSearchProvider: "duckduckgo",
    webSearchBaseURL: undefined,
    webSearchHasKey: false,
    transcriptPath: "~/.polyglot/sessions/abc.jsonl",
    retentionDays: undefined,
    autoUpdate: true,
    mcpServers: [],
    instructions: "none",
    agents: "none",
    skill: "none",
    scanning: "warn tool output",
    hooks: "none",
    sessionId: "abc",
    messageCount: 4,
    contextUsedPercent: 12,
    cost: "no usage yet",
    reliability: "no tool calls yet",
    cwd: "/proj",
  };

  it("shows the transcript path when persisting", () => {
    expect(formatStatusReport(base)).toMatch(/saved → ~\/\.polyglot\/sessions\/abc\.jsonl/);
  });

  it("says ephemeral when not persisting", () => {
    const out = formatStatusReport({ ...base, transcriptPath: null });
    expect(out).toMatch(/ephemeral - nothing written to disk/);
  });

  it("reports retention when set", () => {
    expect(formatStatusReport({ ...base, retentionDays: 30 })).toMatch(/after 30 days/);
    expect(formatStatusReport(base)).toMatch(/kept indefinitely/);
  });

  it("shows the web search backend", () => {
    expect(formatStatusReport(base)).toMatch(/web search:\s+duckduckgo/);
    const tavilyNoKey = formatStatusReport({ ...base, webSearchProvider: "tavily" });
    expect(tavilyNoKey).toMatch(/tavily - NO KEY/);
    const searxng = formatStatusReport({
      ...base,
      webSearchProvider: "searxng",
      webSearchBaseURL: "https://searx.example",
    });
    expect(searxng).toMatch(/searxng \(https:\/\/searx\.example\)/);
  });

  it("shows the cost line verbatim", () => {
    expect(
      formatStatusReport({ ...base, cost: "~$0.0123 estimated · 1,000 in / 200 out (see /cost)" }),
    ).toMatch(/cost:\s+~\$0\.0123 estimated/);
  });

  it("shows the project-instructions line", () => {
    expect(formatStatusReport(base)).toMatch(/instructions:\s+none/);
    expect(formatStatusReport({ ...base, agents: "@reviewer, @tester" })).toMatch(
      /agents:\s+@reviewer, @tester/,
    );
    expect(formatStatusReport({ ...base, instructions: "AGENTS.md + POLYGLOT.md (2 KB)" })).toMatch(
      /instructions:\s+AGENTS\.md \+ POLYGLOT\.md \(2 KB\)/,
    );
    expect(formatStatusReport({ ...base, skill: "haiku (3 available)" })).toMatch(
      /skill:\s+haiku \(3 available\)/,
    );
    expect(formatStatusReport({ ...base, scanning: "redact tool output + pii" })).toMatch(
      /scanning:\s+redact tool output \+ pii/,
    );
    expect(formatStatusReport({ ...base, scanning: "off" })).toMatch(/scanning:\s+off/);
    expect(formatStatusReport({ ...base, hooks: "preToolUse(1) userPromptSubmit(2)" })).toMatch(
      /hooks:\s+preToolUse\(1\) userPromptSubmit\(2\)/,
    );
  });

  it("shows the reliability line verbatim", () => {
    expect(
      formatStatusReport({ ...base, reliability: "qwen3-coder · 4/5 clean (80%) · 1 repaired" }),
    ).toMatch(/reliability:\s+qwen3-coder · 4\/5 clean/);
  });
});
