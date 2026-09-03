---
"@usepolyglot/cli": minor
---

`polyglot share <id|path>` exports a session transcript to a Markdown or standalone-HTML file — for pasting into a PR, an issue, or a bug report. Secret-looking values (cloud keys, bearer tokens, private-key blocks, `KEY=...` assignments) are scrubbed by default; `--no-redact` keeps them, `--full` includes complete tool-call args and result bodies, `--format html` writes a self-contained page. The raw session file on disk is never modified. There's also a `/share` command in the TUI.

`--resume` now also accepts a path to a `.jsonl` session file, so a teammate can hand you a session and you continue it.
