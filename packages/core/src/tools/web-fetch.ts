import { htmlToText } from "./html.js";
import { type ToolDefinition, textResult } from "./types.js";

interface WebFetchInput {
  url: string;
}

const MAX_CHARS = 50_000;
const TIMEOUT_MS = 20_000;

export const webFetchTool: ToolDefinition<WebFetchInput> = {
  name: "web_fetch",
  description: "Fetch a URL over HTTP(S) and return its text content, stripped of HTML markup.",
  permission: "network",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return textResult(`"${input.url}" is not a valid URL.`, false);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return textResult(
        `Unsupported URL scheme "${url.protocol}"; only http/https are allowed.`,
        false,
      );
    }

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = AbortSignal.any([ctx.signal, timeout]);

    try {
      const response = await fetch(url, { signal, redirect: "follow" });
      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const text = contentType.includes("html") ? htmlToText(raw) : raw;
      const body = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]` : text;
      if (!response.ok) {
        return textResult(`HTTP ${response.status} ${response.statusText}\n\n${body}`, false);
      }
      return textResult(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error fetching ${input.url}: ${message}`, false);
    }
  },
};
