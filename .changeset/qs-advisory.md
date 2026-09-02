---
"@usepolyglot/cli": patch
---

Force the transitive `qs` dependency (via `@modelcontextprotocol/sdk` → `express`) to `>=6.16.0`, clearing two moderate advisories (GHSA-x5fp-wj9c-mxmx array-limit bypass, GHSA-4mjr-xmp4-gh2g DoS). `qs` is only reachable through the optional MCP HTTP transport, but it ships in the published tarball.
