---
"@usepolyglot/cli": minor
---

polyglot now reads a project instructions file and prepends it to the system prompt, like `CLAUDE.md` for Claude Code. It looks for, lowest priority first: `~/.polyglot/AGENTS.md`, `~/.polyglot/POLYGLOT.md`, `<project>/AGENTS.md`, `<project>/POLYGLOT.md` — all concatenated, `POLYGLOT.md` winning. `AGENTS.md` is the cross-tool standard, so a repo already set up for opencode / Codex / Cursor works with no extra file. Sub-agents get the same instructions. `/status` shows which files loaded; `POLYGLOT_NO_INSTRUCTIONS=1` skips loading. Files over 16 KB are truncated.
