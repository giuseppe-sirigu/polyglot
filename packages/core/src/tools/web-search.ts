import { stripTags } from "./html.js";
import { type ToolDefinition, textResult } from "./types.js";

export type WebSearchProvider = "duckduckgo" | "searxng" | "tavily" | "brave";

export interface WebSearchConfig {
  provider: WebSearchProvider;
  apiKey?: string;
  /** SearXNG instance base URL. */
  baseURL?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchInput {
  query: string;
}

const TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;
const MAX_SNIPPET_CHARS = 300;
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

class WebSearchError extends Error {}

// --- Pure parsers (exported for tests) ---------------------------------------

/** Parses the DuckDuckGo "lite" results page. Each result is an <a class="result-link">
 * followed, in document order, by a <td class="result-snippet">. */
export function parseDuckDuckGoLite(html: string): WebSearchResult[] {
  // Match every <a>…</a>, keep the ones whose attributes mention result-link — the attribute
  // order (rel / href / class) varies, so pull href out of the attribute blob rather than
  // assuming a fixed layout.
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter((m) =>
    /class=["'][^"']*\bresult-link\b/i.test(m[1] ?? ""),
  );
  const snippets = [
    ...html.matchAll(
      /<td\b[^>]*class=["'][^"']*\bresult-snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi,
    ),
  ];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < links.length; i++) {
    const href = /href=["']([^"']+)["']/i.exec(links[i]?.[1] ?? "")?.[1] ?? "";
    const title = stripTags(links[i]?.[2] ?? "");
    const url = unwrapDuckDuckGoRedirect(href);
    if (!url || !title) continue;
    results.push({ title, url, snippet: stripTags(snippets[i]?.[1] ?? "") });
  }
  return results;
}

/** DDG sometimes returns `//duckduckgo.com/l/?uddg=<encoded-target>` instead of a direct link. */
export function unwrapDuckDuckGoRedirect(href: string): string {
  let normalized = href.trim();
  if (normalized.startsWith("//")) normalized = `https:${normalized}`;
  try {
    const u = new URL(normalized);
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname === "/l/") {
      const target = u.searchParams.get("uddg");
      if (target) return target;
    }
    return u.toString();
  } catch {
    return normalized;
  }
}

export function parseSearxngJson(body: unknown): WebSearchResult[] {
  const results = (body as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => {
      const row = r as { title?: unknown; url?: unknown; content?: unknown };
      return {
        title: typeof row.title === "string" ? row.title : "",
        url: typeof row.url === "string" ? row.url : "",
        snippet: typeof row.content === "string" ? row.content : "",
      };
    })
    .filter((r) => r.url && r.title);
}

export function parseTavilyJson(body: unknown): { answer?: string; results: WebSearchResult[] } {
  const b = body as { answer?: unknown; results?: unknown[] };
  const results = Array.isArray(b?.results)
    ? b.results
        .map((r) => {
          const row = r as { title?: unknown; url?: unknown; content?: unknown };
          return {
            title: typeof row.title === "string" ? row.title : "",
            url: typeof row.url === "string" ? row.url : "",
            snippet: typeof row.content === "string" ? row.content : "",
          };
        })
        .filter((r) => r.url && r.title)
    : [];
  return { answer: typeof b?.answer === "string" ? b.answer : undefined, results };
}

export function parseBraveJson(body: unknown): WebSearchResult[] {
  const results = (body as { web?: { results?: unknown[] } })?.web?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => {
      const row = r as { title?: unknown; url?: unknown; description?: unknown };
      return {
        title: typeof row.title === "string" ? stripTags(row.title) : "",
        url: typeof row.url === "string" ? row.url : "",
        snippet: typeof row.description === "string" ? stripTags(row.description) : "",
      };
    })
    .filter((r) => r.url && r.title);
}

// --- Backends ---------------------------------------------------------------

async function fetchText(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(url, { ...init, signal, redirect: "follow" });
}

async function searchDuckDuckGo(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
  const res = await fetchText(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } },
    signal,
  );
  if (!res.ok) {
    throw new WebSearchError(
      `DuckDuckGo returned HTTP ${res.status}. It rate-limits automated requests — retry shortly, or configure a different webSearch.provider.`,
    );
  }
  return parseDuckDuckGoLite(await res.text());
}

async function searchSearxng(
  query: string,
  cfg: WebSearchConfig,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  if (!cfg.baseURL) {
    throw new WebSearchError(
      "The 'searxng' backend needs webSearch.baseURL (or POLYGLOT_WEBSEARCH_BASE_URL) set to your SearXNG instance.",
    );
  }
  const base = cfg.baseURL.replace(/\/+$/, "");
  const res = await fetchText(
    `${base}/search?q=${encodeURIComponent(query)}&format=json`,
    { headers: { Accept: "application/json" } },
    signal,
  );
  if (!res.ok) {
    throw new WebSearchError(`SearXNG instance returned HTTP ${res.status} for ${base}.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new WebSearchError(
      `SearXNG instance ${base} did not return JSON. Enable it in the instance's settings.yml: 'search: { formats: [html, json] }'.`,
    );
  }
  return parseSearxngJson(body);
}

async function searchTavily(
  query: string,
  cfg: WebSearchConfig,
  signal: AbortSignal,
): Promise<{ answer?: string; results: WebSearchResult[] }> {
  requireKey(cfg);
  const res = await fetchText(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: cfg.apiKey,
        query,
        max_results: MAX_RESULTS,
        include_answer: true,
      }),
    },
    signal,
  );
  if (!res.ok) {
    throw new WebSearchError(`Tavily returned HTTP ${res.status} (check your API key and quota).`);
  }
  return parseTavilyJson(await res.json());
}

async function searchBrave(
  query: string,
  cfg: WebSearchConfig,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  requireKey(cfg);
  const res = await fetchText(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": cfg.apiKey ?? "" } },
    signal,
  );
  if (!res.ok) {
    throw new WebSearchError(
      `Brave Search returned HTTP ${res.status} (check your API key and quota).`,
    );
  }
  return parseBraveJson(await res.json());
}

function requireKey(cfg: WebSearchConfig): void {
  if (!cfg.apiKey) {
    throw new WebSearchError(
      `The '${cfg.provider}' backend needs an API key. Set webSearch.apiKey in settings.json or POLYGLOT_WEBSEARCH_API_KEY.`,
    );
  }
}

// --- Formatting ------------------------------------------------------------

function truncateSnippet(s: string): string {
  return s.length > MAX_SNIPPET_CHARS ? `${s.slice(0, MAX_SNIPPET_CHARS)}…` : s;
}

export function formatResults(results: WebSearchResult[], answer?: string): string {
  const head = answer ? `Answer: ${answer}\n\n` : "";
  const body = results
    .slice(0, MAX_RESULTS)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${truncateSnippet(r.snippet)}`)
    .join("\n\n");
  return `${head}${body}`;
}

// --- Tool -----------------------------------------------------------------

/**
 * A query-based web search tool. Provider-pluggable, mirroring the model config: zero-config
 * DuckDuckGo by default, SearXNG for self-hosters, Tavily/Brave with an API key. Returns a
 * ranked list of title/URL/snippet — the model uses web_fetch to read any result in full.
 */
export function createWebSearchTool(config: WebSearchConfig): ToolDefinition<WebSearchInput> {
  return {
    name: "web_search",
    description: `Search the web for a query and get back a ranked list of results (title, URL, snippet). Backed by ${config.provider}. Follow up with web_fetch on a result URL to read the full page.`,
    permission: "network",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const query = input.query?.trim();
      if (!query) return textResult("web_search: query must not be empty.", false);

      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      try {
        let results: WebSearchResult[];
        let answer: string | undefined;
        switch (config.provider) {
          case "searxng":
            results = await searchSearxng(query, config, signal);
            break;
          case "tavily": {
            const t = await searchTavily(query, config, signal);
            results = t.results;
            answer = t.answer;
            break;
          }
          case "brave":
            results = await searchBrave(query, config, signal);
            break;
          default:
            results = await searchDuckDuckGo(query, signal);
        }
        if (results.length === 0) {
          return textResult(`No results for "${query}" (via ${config.provider}).`);
        }
        return textResult(formatResults(results, answer));
      } catch (err) {
        if (err instanceof WebSearchError) return textResult(err.message, false);
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`web_search failed (${config.provider}): ${message}`, false);
      }
    },
  };
}
