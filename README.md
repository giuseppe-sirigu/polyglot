<p align="center">
  <img src="branding/logo.svg" width="120" alt="Polyglot logo" />
</p>

<h1 align="center">Polyglot</h1>

<p align="center">
  <a href="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/ci.yml"><img src="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/codeql.yml"><img src="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/codeql.yml/badge.svg" alt="CodeQL status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue" alt="License: FSL-1.1-ALv2" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >= 20" />
</p>

A coding-agent CLI that works the same way regardless of which model is answering - Claude, GPT, or an open-weight model like Qwen, DeepSeek, GLM, or Llama running locally via Ollama, vLLM, LM Studio, or any other OpenAI-compatible server.

## Why

Most agent CLIs lean on a provider's *native* function-calling API and assume near-perfect adherence to its exact tool-call JSON schema. Open-weight models frequently emit malformed, incomplete, or off-format tool calls against that API, so the whole agent loop breaks.

Polyglot treats tool invocation as a **text-parsing problem** instead: tools are described to the model in the system prompt, and a fault-tolerant streaming parser extracts and repairs tool calls from the model's raw output - trailing commas, single quotes, near-miss tool names, models that default to OpenAI-style `{"name":..., "arguments":...}` JSON instead of the taught XML envelope, all handled the same way. The same parser and executor run underneath every provider, so behavior doesn't silently diverge between "well-behaved" and "flaky" models.

## Requirements

- Node.js >= 20
- [pnpm](https://pnpm.io/) 10.x
- Either an Anthropic API key, or a local/remote OpenAI-compatible inference server (Ollama, vLLM, LM Studio, llama.cpp server, TGI, etc.)

## Install

```bash
git clone https://github.com/giuseppe-sirigu/polyglot.git
cd polyglot
pnpm install
pnpm build
```

This builds `@polyglot/core` (the provider-agnostic engine) and `@polyglot/cli` (the terminal frontend).

## Running the CLI

Configuration is resolved from, in increasing precedence: `~/.polyglot/settings.json` (global) → `.polyglot/settings.json` in the current project (project-local) → environment variables.

### Quick start with a local model (Ollama)

```bash
export POLYGLOT_PROVIDER=openai-compatible
export POLYGLOT_MODEL=qwen2.5-coder      # any model you've pulled
export POLYGLOT_BASE_URL=http://localhost:11434/v1   # default if unset

node packages/cli/dist/main.js
```

### Quick start with Claude

```bash
export POLYGLOT_PROVIDER=anthropic
export POLYGLOT_MODEL=claude-sonnet-4-5
export ANTHROPIC_API_KEY=sk-ant-...

node packages/cli/dist/main.js
```

### Using `settings.json` instead of env vars

Create `.polyglot/settings.json` in a project (or `~/.polyglot/settings.json` globally):

```json
{
  "provider": "openai-compatible",
  "model": "qwen2.5-coder",
  "baseURL": "http://localhost:11434/v1",
  "permissions": {
    "mode": "auto",
    "allow": [],
    "deny": ["bash:rm -rf *"]
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/REPLACE/WITH/A/REAL/DIRECTORY"]
    }
  }
}
```

`mcpServers` is optional - omit it entirely if you don't need an MCP server yet. If a configured server fails to start (e.g. the directory above doesn't exist), Polyglot logs the error and continues without it rather than blocking startup; the rest of the CLI still works normally.

#### Optional: run it as a bare `polyglot` command

By default nothing puts `polyglot` on your `PATH` - `node packages/cli/dist/main.js` (above) always works with zero setup. To get the short command instead:

```bash
pnpm setup                          # one-time: registers pnpm's global bin dir on PATH
source ~/.bashrc                    # or ~/.zshrc - reload your shell profile
cd packages/cli && pnpm link --global
```

Then `polyglot` (with your env vars or `settings.json` still applying) works from any directory.

### CLI commands and shortcuts

Polyglot's terminal frontend is a full TUI (built with [Ink](https://github.com/vadimdemedes/ink)), not a plain line-by-line prompt - assistant text streams live, tool calls render as cards (`⏺ tool_name(args)` → `⎿ result`), and approval prompts appear inline.

- Type a message and press enter to chat.
- **Shift+Tab** - cycle permission mode (`manual` → `auto` → `plan` → …) mid-session. The status bar at the bottom always shows the current mode. (Not Ctrl+Tab - that combination is intercepted by most terminal emulators for tab-switching and never reaches the program.)
- `/compact` - summarize older conversation history to free up context.
- `/exit` or `/quit` - exit cleanly.
- `--resume [session-id]` - resume the most recent session, or a specific one by ID (`polyglot --resume`, or `polyglot --resume <id>`). Sessions are persisted as JSONL under `~/.polyglot/sessions/`.
- Ctrl+C exits immediately.

## Permission modes

Set via `permissions.mode` in `settings.json` or `POLYGLOT_PERMISSION_MODE`:

| Mode | Behavior |
|---|---|
| `manual` (default) | Every write/execute/network tool call prompts for approval: `[y/N/a=always]`. `a` allows that tool for the rest of the session. |
| `auto` | Tool calls run without prompting, unless they match a `deny` rule. |
| `plan` | Only read-only tools run automatically; everything else is hard-denied until the model calls `exit_plan_mode` with a plan and you approve it - at which point the session drops into `manual` mode for the rest of the conversation. |

`allow`/`deny` rules are strings like `"read_file"` (matches the tool regardless of arguments) or `"bash:git *"` (matches only when the tool's primary argument - `command` for bash, `path` for file tools, `url` for `web_fetch` - matches the glob pattern).

## Built-in tools

`read_file`, `write_file`, `edit_file` (exact-match search/replace, fails closed if the match isn't unique), `bash`, `grep`, `glob`, `web_fetch`, plus `task` (delegate a sub-task to a nested sub-agent - see below) and, only in plan mode, `exit_plan_mode`.

## MCP servers

Any server listed under `mcpServers` in `settings.json` is connected over stdio at startup. Its tools are exposed to the model as `mcp__<server>__<tool>` and go through the exact same text-parsed grammar as the built-in tools - an MCP tool is just as usable by a local model with unreliable native tool-calling as by Claude or GPT.

## Multi-agent (`task` tool)

The model can call `task({ description, prompt })` to spin up a fresh sub-agent with its own tool registry and conversation, which runs to completion and reports a summary back. Sub-agents can themselves delegate further, up to a hard depth limit (3 by default) - at the limit, the `task` tool simply isn't offered to that sub-agent, so recursion can't run away. Multiple `task` calls emitted in a single model turn run concurrently.

## Auto-update

On first run, polyglot asks whether it should update itself automatically when a new version is published, and remembers the answer in `~/.polyglot/settings.json` (`"autoUpdate": true | false`) - it won't ask again. From then on, every startup does a quick, non-blocking check against the npm registry:

- If you said yes, and a newer version exists, it runs the appropriate global reinstall in the background (`npm`/`pnpm`/`yarn`/`bun`, auto-detected from how polyglot was installed) and tells you to restart.
- If you said no, it just prints a notice with the manual update command.
- Offline or registry hiccup: fails silently, never blocks startup.

Change your mind anytime by editing `"autoUpdate"` in `~/.polyglot/settings.json` directly.

## Project structure

```
packages/
  core/    # @polyglot/core - provider-agnostic engine, no TTY/UI assumptions
    src/
      agent/           # turn loop, tool executor, event types
      providers/       # Anthropic + OpenAI-compatible adapters
      tool-protocol/    # the grammar, streaming parser, repair pipeline - the core differentiator
      tools/           # built-in tools + task/exit-plan-mode
      mcp/             # MCP client + multi-server manager
      permissions/     # manual/auto/plan permission gate
      session/         # session types, JSONL persistence, context compaction
      config/          # settings.json schema + global/project/env merge
  cli/     # @polyglot/cli - Ink-based terminal UI frontend
branding/  # logo assets
```

`packages/core` is UI-agnostic by design - a future VS Code extension or desktop app would be a new frontend against the same engine, not a rewrite.

## Development

```bash
pnpm build       # build all packages
pnpm typecheck   # typecheck all packages
pnpm lint        # biome check
pnpm format      # biome format --write
pnpm test        # vitest (parser + resolver fixture tests)
```

The most load-bearing tests live in `packages/core/src/tool-protocol/*.test.ts` - the streaming parser tests assert identical results no matter how the model's output happens to be chunked across network packets, and the resolver tests cover jsonrepair fallbacks, fuzzy tool-name correction, and both supported tool-call grammars (the taught XML envelope and the tolerated OpenAI-style fenced-JSON fallback).

## Versioning

Semantic versioning, and pre-1.0: expect breaking changes between minor versions until 1.0.0. Each published version is licensed under FSL as of its own release date - the two-year conversion to Apache 2.0 (see below) is tracked per-version, not from the project's original release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) - dev setup, code style, and what kinds of contributions are most useful right now (fixture tests from real messy model output, Windows testing, and additional OpenAI-compatible provider quirks, especially).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

[Functional Source License, Version 1.1, ALv2 Future License](https://fsl.software) - see [LICENSE](LICENSE).

Source is fully visible; you can read it, modify it, self-host it, and use it for your own internal purposes freely. The one thing it restricts is launching a competing commercial product or service built on this code. Two years after each version is published, that version automatically converts to the Apache License, Version 2.0.
