import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWebSearchTool,
  formatResults,
  parseBraveJson,
  parseDuckDuckGoLite,
  parseSearxngJson,
  parseTavilyJson,
  unwrapDuckDuckGoRedirect,
} from "./web-search.js";

const ctx = { cwd: "/tmp", sessionId: "s", signal: new AbortController().signal };

describe("parseDuckDuckGoLite", () => {
  const html = `
    <table>
      <tr><td>1.</td><td>
        <a rel="nofollow" href="https://nodejs.org/en/about/releases" class="result-link">Node.js Releases</a>
      </td></tr>
      <tr><td></td><td class="result-snippet">Node.js has a release schedule with LTS lines.</td></tr>
      <tr><td>2.</td><td>
        <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FNode.js&rut=abc" class="result-link">Node.js - Wikipedia</a>
      </td></tr>
      <tr><td></td><td class="result-snippet">Node.js is a cross-platform runtime.</td></tr>
    </table>`;

  it("extracts title/url/snippet pairs in order", () => {
    const results = parseDuckDuckGoLite(html);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Node.js Releases",
      url: "https://nodejs.org/en/about/releases",
      snippet: "Node.js has a release schedule with LTS lines.",
    });
  });

  it("unwraps the uddg redirect href", () => {
    expect(parseDuckDuckGoLite(html)[1]?.url).toBe("https://en.wikipedia.org/wiki/Node.js");
  });
});

describe("unwrapDuckDuckGoRedirect", () => {
  it("returns a direct URL unchanged", () => {
    expect(unwrapDuckDuckGoRedirect("https://example.com/x")).toBe("https://example.com/x");
  });
  it("pulls the target out of a protocol-relative redirect", () => {
    expect(unwrapDuckDuckGoRedirect("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fy")).toBe(
      "https://example.com/y",
    );
  });
});

describe("JSON parsers", () => {
  it("parseSearxngJson maps results and drops incomplete rows", () => {
    const out = parseSearxngJson({
      results: [{ title: "A", url: "https://a.test", content: "snippet a" }, { title: "no url" }],
    });
    expect(out).toEqual([{ title: "A", url: "https://a.test", snippet: "snippet a" }]);
  });

  it("parseTavilyJson surfaces the answer and results", () => {
    const out = parseTavilyJson({
      answer: "Node 22 is current LTS.",
      results: [{ title: "T", url: "https://t.test", content: "c" }],
    });
    expect(out.answer).toBe("Node 22 is current LTS.");
    expect(out.results).toHaveLength(1);
  });

  it("parseBraveJson reads web.results with description as the snippet", () => {
    const out = parseBraveJson({
      web: { results: [{ title: "B", url: "https://b.test", description: "<b>desc</b>" }] },
    });
    expect(out).toEqual([{ title: "B", url: "https://b.test", snippet: "desc" }]);
  });
});

describe("formatResults", () => {
  it("numbers results and prepends an answer when present", () => {
    const text = formatResults([{ title: "T", url: "https://t.test", snippet: "s" }], "the answer");
    expect(text).toContain("Answer: the answer");
    expect(text).toContain("1. T");
    expect(text).toContain("https://t.test");
  });
});

describe("createWebSearchTool.execute", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an empty query", async () => {
    const tool = createWebSearchTool({ provider: "duckduckgo" });
    const res = await tool.execute({ query: "  " }, ctx);
    expect(res.isError).toBe(true);
  });

  it("reports a missing API key for a keyed provider without hitting the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const tool = createWebSearchTool({ provider: "tavily" });
    const res = await tool.execute({ query: "anything" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.toModelText()).toMatch(/needs an API key/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("formats a happy-path DuckDuckGo response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<a href="https://ex.test/a" class="result-link">Result A</a><td class="result-snippet">about A</td>',
      }),
    );
    const tool = createWebSearchTool({ provider: "duckduckgo" });
    const res = await tool.execute({ query: "test" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.toModelText()).toContain("1. Result A");
    expect(res.toModelText()).toContain("https://ex.test/a");
  });

  it("surfaces a non-ok upstream status as a tool error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "" }),
    );
    const tool = createWebSearchTool({ provider: "duckduckgo" });
    const res = await tool.execute({ query: "test" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.toModelText()).toMatch(/HTTP 429/);
  });
});
