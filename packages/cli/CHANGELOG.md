# @usepolyglot/cli

## 0.1.0

Initial release.

Model-agnostic coding-agent CLI: a fault-tolerant text-parsing tool-call pipeline that works
the same against Claude, GPT, and open-weight models (Qwen, DeepSeek, GLM, Llama) via any
OpenAI-compatible server. Permission modes (`manual`/`auto`/`plan`) with allow/deny globs,
plan mode with a real approval flow, session persistence + `--resume` + `/rename`, MCP client
support, sub-agent (`task`) delegation, `-p`/`--print` non-interactive mode, a configurable
`web_search` tool (DuckDuckGo by default, no key), real provider token accounting, and
ephemeral/`retentionDays` data-handling controls.
