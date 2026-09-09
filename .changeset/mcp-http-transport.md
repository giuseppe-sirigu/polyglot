---
"@usepolyglot/cli": minor
---

MCP servers can now be remote. Give a server a `url` instead of a `command` and Polyglot connects over HTTP:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_MCP_TOKEN}" }
    }
  }
}
```

It tries the current Streamable HTTP transport and falls back to legacy HTTP+SSE if the server only speaks that; pin `"transport": "http"` or `"sse"` to skip the negotiation. `${VAR}` in a header value is read from the environment so tokens stay out of `settings.json`.

MCP servers now also connect **in parallel with a 10-second timeout**, so a slow or unreachable one no longer holds up startup - it's reported and skipped like any other connection failure. `/status` and the startup line show each server's transport (`github (http)`, `filesystem (stdio)`).
