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

This builds `@usepolyglot/core` (the provider-agnostic engine) and `@usepolyglot/cli` (the terminal frontend).

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

### Structured output (experimental, `openai-compatible` only)

By default, tool calls are extracted from free-text tags (`<tool_call name="...">{...}</tool_call>`) the model emits inline - this works with any model on any provider, but a weak or small local model can still get the syntax wrong.

If your local server supports `response_format: {type: "json_schema", ...}` (grammar/schema-constrained decoding - known to work with recent versions of Ollama, and with llama.cpp server, vLLM, and LM Studio), you can opt into forcing every completion to match a strict JSON envelope instead, which makes malformed tool-call syntax structurally impossible for that turn:

```json
{
  "provider": "openai-compatible",
  "model": "qwen2.5-coder",
  "baseURL": "http://localhost:11434/v1",
  "structuredOutput": true
}
```

or `export POLYGLOT_STRUCTURED_OUTPUT=true`. Off by default - `openai-compatible` covers many different backends with inconsistent schema support, so this is opt-in rather than automatic. It's ignored (has no effect) when `provider` is `anthropic`, which already has reliable native tool use. When enabled, replies are shown once the full response arrives rather than streamed token-by-token, since the whole completion is one JSON object. Pointing this at the real hosted OpenAI API is not supported: OpenAI's strict structured-output mode requires every schema property to be listed as required, which this project's tool schemas (which have legitimately optional properties) don't satisfy.

### Multiple models (`/model`)

List alternative models under `models` in `settings.json` and switch between them mid-session with `/model`, without restarting:

```json
{
  "provider": "openai-compatible",
  "model": "qwen2.5-coder",
  "baseURL": "http://localhost:11434/v1",
  "models": [
    { "provider": "openai-compatible", "model": "qwen3-coder", "label": "Qwen 3 Coder" },
    { "provider": "anthropic", "model": "claude-sonnet-4-5", "label": "Claude Sonnet" }
  ]
}
```

Each entry is a complete, independent engine config - its own `provider`, `baseURL`, `apiKey`, and `structuredOutput`, not just a different model name on the same connection - so the list can mix local Ollama models with a real Claude model. `label` is optional and falls back to the model id. An entry's `apiKey` is optional too: if omitted, it's resolved from the same environment variable `loadConfig` would use for that entry's own provider (`ANTHROPIC_API_KEY` or `POLYGLOT_API_KEY`), independent of whichever provider is active at startup.

- `/model` - opens an **↑↓**-navigable picker of every available model (the current one marked, cursor starting there), including whatever you started the session with even if it isn't itself in `models[]`. Enter switches, Esc cancels.
- `/model <name>` - switches directly from the command line, no picker. Matches an exact model id first, then a case-insensitive substring of the id or label.

Switching is session-local only - it never rewrites `settings.json`, so resuming a session later (`--resume`) always starts back on whichever model that session originally began with.

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
- Type `/` to see a live-filtering popup of available commands - keep typing to narrow it, **↑↓** to move, **Tab** to fill in the highlighted command without running it. **Enter** runs the highlighted command immediately, except for one that needs more typed after it (like `/rename <name>`) - there it fills the input instead, same as Tab, so you get a chance to type the argument first. It disappears as soon as you type a space or newline (you've moved on to an argument, e.g. `/model qwen3-coder`).
- You can keep typing and submitting while a turn is already running - each message queues (shown dimmed above the input box, and as a count next to "working…" in the status area) and runs automatically, in order, once the current one finishes. Nothing you type is ever blocked or dropped.
- **Shift+Tab** - cycle permission mode (`manual` → `auto` → `plan` → …) mid-session. The status bar at the bottom always shows the current mode. (Not Ctrl+Tab - that combination is intercepted by most terminal emulators for tab-switching and never reaches the program.)
- **Esc** - stop the turn currently in progress (model call and/or a running tool) without exiting the app. Also discards anything currently queued (see above) - it's an explicit stop, not a "run everything anyway" pause.
- `/model` / `/model <name>` - open a picker to switch, or switch directly by name - see [Multiple models](#multiple-models-model) above.
- `/rename <name>` - give the current session a name (shown in the status bar and in `/resume`'s picker instead of a raw session ID). Session names are separate from any file/branch naming - purely a label to help you find it again later.
- `/resume` - pick a previous session from an **↑↓**-navigable list (most recently updated first, current session excluded, capped at the 15 most recent) and switch to it in place, replacing the visible transcript with that session's own history - re-rendered from its saved messages, tool calls and results included, not just a blank screen with a note that it resumed. If that session was on a model no longer in your `models[]`, it stays on whichever model is currently active instead and says so.
- `/compact` - summarize older conversation history to free up context.
- `/reset` or `/newsession` - start a fresh session in the same terminal (clears the visible transcript and conversation history) without exiting. The prior session's transcript is untouched on disk and remains resumable via `/resume` or `--resume`; the new session keeps whichever model was currently active.
- `/exit` or `/quit` - exit cleanly.
- `--resume [session-id]` - resume the most recent session, or a specific one by ID, from the command line (`polyglot --resume`, or `polyglot --resume <id>`) - same transcript restoration as `/resume` above. Sessions are persisted as JSONL under `~/.polyglot/sessions/`.
- Ctrl+C exits immediately.

The status bar also shows a rough **context** indicator (`context: NN%`) - an estimate of how much of the model's context window the current conversation is using (turns yellow past 75%, red past 90%), the same heuristic `/compact` and the automatic-compaction trigger already use internally. It's a token-count estimate (~4 chars/token), not an exact count from the provider.

## Permission modes

Set via `permissions.mode` in `settings.json` or `POLYGLOT_PERMISSION_MODE`:

| Mode | Behavior |
|---|---|
| `manual` (default) | Every write/execute/network tool call prompts for approval. |
| `auto` | Tool calls run without prompting, unless they match a `deny` rule. |
| `plan` | Only read-only tools run automatically; everything else is hard-denied until the model calls `exit_plan_mode` with a plan and you approve it - at which point the session drops into `manual` mode for the rest of the conversation. |

`allow`/`deny` rules are strings like `"read_file"` (matches the tool regardless of arguments) or `"bash:git *"` (matches only when the tool's primary argument - `command` for bash, `path` for file tools, `url` for `web_fetch` - matches the glob pattern).

Both the tool-approval and plan-approval prompts are a **↑↓**-navigable list (Enter to select) with direct letter shortcuts (`y`/`a`/`n`) alongside it, plus a **Comment** option (`c`): instead of a plain yes/no, type free text explaining what you'd rather it do - it stops the current action and immediately sends what you typed as your next message, so you can redirect without a separate deny-then-retype step. Esc denies outright (or, while typing a comment, backs out of it).

## Built-in tools

`read_file`, `write_file`, `edit_file` (exact-match search/replace, fails closed if the match isn't unique), `bash`, `grep`, `glob`, `web_fetch`, plus `task` (delegate a sub-task to a nested sub-agent - see below) and, only in plan mode, `exit_plan_mode`.

Every plan the model proposes via `exit_plan_mode` is also saved to `~/.polyglot/plans/<timestamp>-<session-id>.md`, independent of whether you approve or reject it - a durable record of what was proposed, the same role Claude Code's own `~/.claude/plans` serves.

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
  core/    # @usepolyglot/core - provider-agnostic engine, no TTY/UI assumptions
    src/
      agent/           # turn loop, tool executor, event types
      providers/       # Anthropic + OpenAI-compatible adapters
      tool-protocol/    # the grammar, streaming parser, repair pipeline - the core differentiator
      tools/           # built-in tools + task/exit-plan-mode
      mcp/             # MCP client + multi-server manager
      permissions/     # manual/auto/plan permission gate
      session/         # session types, JSONL persistence, context compaction
      config/          # settings.json schema + global/project/env merge
  cli/     # @usepolyglot/cli - Ink-based terminal UI frontend
branding/  # logo assets
```

`packages/core` is UI-agnostic by design - a future VS Code extension or desktop app would be a new frontend against the same engine, not a rewrite.

## Development

```bash
pnpm build       # build all packages
pnpm typecheck   # typecheck all packages
pnpm lint        # biome check
pnpm format      # biome format --write
pnpm test        # vitest
```

The most load-bearing tests live in `packages/core/src/tool-protocol/*.test.ts` - the streaming parser tests assert identical results no matter how the model's output happens to be chunked across network packets, and the resolver tests cover jsonrepair fallbacks, fuzzy tool-name correction, and both supported tool-call grammars (the taught XML envelope and the tolerated OpenAI-style fenced-JSON fallback). Coverage elsewhere in `packages/core` is pure-logic (config merging, session persistence, the agent loop, provider request-shaping) - `packages/cli`'s Ink components have no automated test coverage today and are verified by hand.

## Versioning

Semantic versioning, and pre-1.0: expect breaking changes between minor versions until 1.0.0. Each published version is licensed under FSL as of its own release date - the two-year conversion to Apache 2.0 (see below) is tracked per-version, not from the project's original release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) - dev setup, code style, and what kinds of contributions are most useful right now (fixture tests from real messy model output, Windows testing, and additional OpenAI-compatible provider quirks, especially).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

[Functional Source License, Version 1.1, ALv2 Future License](https://fsl.software) - see [LICENSE](LICENSE).

Source is fully visible; you can read it, modify it, self-host it, and use it for your own internal purposes freely. The one thing it restricts is launching a competing commercial product or service built on this code. Two years after each version is published, that version automatically converts to the Apache License, Version 2.0.
