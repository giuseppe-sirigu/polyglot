export interface StatusReportFields {
  provider: string;
  model: string;
  /** anthropic → undefined (hosted API); openai-compatible → the configured baseURL. */
  baseURL: string | undefined;
  permissionMode: string;
  webSearchProvider: string;
  /** SearXNG instance URL, when the provider is searxng. */
  webSearchBaseURL: string | undefined;
  /** Whether an API key is configured (tavily/brave need one). */
  webSearchHasKey: boolean;
  /** Absolute path the transcript is written to, or null when the session is ephemeral. */
  transcriptPath: string | null;
  retentionDays: number | undefined;
  autoUpdate: boolean | undefined;
  mcpServers: string[];
  /** `AGENTS.md` / `POLYGLOT.md` sources loaded, or "none". */
  instructions: string;
  sessionId: string;
  messageCount: number;
  contextUsedPercent: number | undefined;
  /** One-line cost summary (see costReport.formatCostLine). */
  cost: string;
  cwd: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Human description of where conversation data is sent, and whether that leaves the machine. */
export function describeEndpoint(provider: string, baseURL: string | undefined): string {
  if (provider === "anthropic") {
    return "https://api.anthropic.com - hosted (conversation data leaves this machine)";
  }
  if (!baseURL) return "(unknown)";
  let host = baseURL;
  try {
    host = new URL(baseURL).hostname;
  } catch {
    // fall back to the raw string
  }
  const local = LOCAL_HOSTS.has(host);
  return `${baseURL} - ${local ? "local (nothing leaves this machine)" : "remote (conversation data leaves this machine)"}`;
}

function describeWebSearch(f: StatusReportFields): string {
  if (f.webSearchProvider === "searxng") {
    return `searxng${f.webSearchBaseURL ? ` (${f.webSearchBaseURL})` : " - no baseURL set"}`;
  }
  if (f.webSearchProvider === "tavily" || f.webSearchProvider === "brave") {
    return `${f.webSearchProvider}${f.webSearchHasKey ? " (key set)" : " - NO KEY: set webSearch.apiKey"}`;
  }
  return `${f.webSearchProvider} (no key needed; sends queries to the backend)`;
}

export function formatStatusReport(f: StatusReportFields): string {
  const lines = [
    "Session status",
    `  model:        ${f.provider} / ${f.model}`,
    `  endpoint:     ${describeEndpoint(f.provider, f.baseURL)}`,
    `  permissions:  ${f.permissionMode}`,
    `  web search:   ${describeWebSearch(f)}`,
    "  secret files: read/write of .env, keys, .ssh/… always prompts for approval",
    `  transcript:   ${
      f.transcriptPath ? `saved → ${f.transcriptPath}` : "ephemeral - nothing written to disk"
    }`,
    `  retention:    ${
      f.retentionDays
        ? `prune transcripts/plans after ${f.retentionDays} days`
        : "kept indefinitely"
    }`,
    `  auto-update:  ${
      f.autoUpdate === undefined ? "not set" : f.autoUpdate ? "on" : "notify only"
    } (checks npm on startup)`,
    `  mcp servers:  ${f.mcpServers.length > 0 ? f.mcpServers.join(", ") : "none"}`,
    `  instructions: ${f.instructions}`,
    `  cost:         ${f.cost}`,
    `  cwd:          ${f.cwd}`,
    `  session:      ${f.sessionId} · ${f.messageCount} message(s)${
      f.contextUsedPercent === undefined ? "" : ` · context ~${f.contextUsedPercent}%`
    }`,
  ];
  return lines.join("\n");
}
