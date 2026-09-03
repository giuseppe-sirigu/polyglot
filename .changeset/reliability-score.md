---
"@usepolyglot/cli": minor
---

New per-model reliability tally for the session: how many tool calls a model made, how many needed repair, how many failed to parse, and how many times it gave up. Surfaced in three places — a `reliability:` line in `/status`, a new `/reliability` command with the per-model breakdown, and a note next to each model in the `/model` picker (e.g. "92% clean this session" / "3 parse errors this session"). The status bar shows a `⚠N` / `NN% ok` segment once something's worth flagging. Headless `-p --output-format json` gains a `reliability` object. Memory-only — not persisted across `--resume`.
