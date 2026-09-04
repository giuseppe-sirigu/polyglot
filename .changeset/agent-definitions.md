---
"@usepolyglot/cli": minor
---

Agent definitions. Drop a Markdown file at `.polyglot/agents/<name>.md` (or `~/.polyglot/agents/` for one available everywhere) with frontmatter — `description`, an optional `tools` allowlist, an optional `model` — and a body that becomes the agent's system prompt. Invoke it by starting a message with `@<name> <task>`: it runs as a one-shot sub-agent with just its allowed tools (and its own model, if pinned), streams its work into the transcript, and the result is recorded in the session so the main model and `--resume` see it. The model can also delegate to an agent on its own via the `agent_<name>` tool. `@` in the input now also suggests agents; `/agents` lists them and `/status` shows them. Set `POLYGLOT_NO_AGENTS=1` to disable. Works in `-p` mode too.
