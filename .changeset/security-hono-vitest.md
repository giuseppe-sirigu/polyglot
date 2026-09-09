---
"@usepolyglot/cli": patch
---

Security: bump the transitive `hono` dependency (via `@modelcontextprotocol/sdk`) to `4.13.7`, clearing three moderate advisories (`toSSG` path traversal, `parseBody` memory exhaustion, query-parser fragment handling) — none of which polyglot exercises, but they showed up in `pnpm audit`. Also moves the dev-only `vitest` to `4.1.11` for GHSA-82fw-gwwq-j7x9 (path traversal via `@vitest/mocker` redirect mocks; polyglot's tests use none). No runtime behaviour change.
