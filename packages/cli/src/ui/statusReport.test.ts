import { describe, expect, it } from "vitest";
import { type StatusReportFields, describeEndpoint, formatStatusReport } from "./statusReport.js";

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
    sessionId: "abc",
    messageCount: 4,
    contextUsedPercent: 12,
    cost: "no usage yet",
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
});
