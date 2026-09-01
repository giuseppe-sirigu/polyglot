---
"@usepolyglot/cli": minor
---

Opt-in audit log: set `"audit": { "enabled": true }` in settings (or `POLYGLOT_AUDIT=1`) to record every tool call, permission decision, tool result, token-usage report and stop reason as canonical JSONL under `~/.polyglot/audit/<session>.jsonl`, one file per session. Each record carries an ISO timestamp, the session id, and the model; tool-call arguments and tool results are stored as SHA-256 hashes by default (`"hashArgs": false` keeps raw args). Files respect `retentionDays`. Also adds a `permission_decision` agent event.
