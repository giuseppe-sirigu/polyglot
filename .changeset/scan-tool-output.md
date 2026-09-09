---
"@usepolyglot/cli": minor
---

Polyglot now scans the output of every tool call — shell commands, file reads, web fetches, MCP tools — for secret-looking values (API keys, tokens, private keys, `KEY=…` assignments) before it reaches the model, and flags what it finds in the transcript and the audit log. It's on by default in warn mode: the text the model sees is unchanged, you just get a `⚠ 1 secret-looking value in bash output (aws-key)` line. Set `redaction.mode: "redact"` (or `POLYGLOT_REDACT_OUTPUT=1`) to replace matches with `[redacted:<label>]` before they enter context; `redaction.pii: true` adds email / SSN / card / phone detection; `redaction.extraPatterns` adds your own; `POLYGLOT_NO_OUTPUT_SCAN=1` turns it off. `/status` shows the current mode. This is content-based and complements the existing path-based protection (a secret-*named* file still prompts for approval first).
