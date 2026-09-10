# @usepolyglot/cli

## 0.11.1

### Patch Changes

- aedc721: `grep` now searches a single file, not just a directory. Passing a file to `path`
  previously walked it as a directory, silently found nothing, and returned "No matches" -
  which reads as "the pattern isn't there" rather than "wrong kind of path", and sent
  weaker models down a dead end. A `path` that doesn't exist now returns a clear "Path not
  found" instead of an empty result, and a `path` pointing straight at a secret-looking
  file is refused rather than searched.

## 0.11.0

### Minor Changes

- b44ff5c: **Replay a saved session.** `polyglot replay <id|path>` re-runs a session against the current
  build and shows where it diverges. By default it's parse-level: every recorded model completion
  is re-resolved through today's tool-call parser and repair pipeline, and the report flags each
  tool call that now resolves differently, each repair that's newly needed, and any case a
  since-released fix would have handled — fully deterministic, no execution. `--execute --seed
  <dir>` replays the whole agent loop in a temp working directory and reports invariants plus the
  tool-call diff; `--output-format json` gives the machine-readable report; `--save <name>` turns
  the session into a committed regression test.

## 0.10.0

### Minor Changes

- 740476b: MCP servers can now be remote. Give a server a `url` instead of a `command` and Polyglot connects over HTTP:
  
  ```json
  {
    "mcpServers": {
      "github": {
        "url": "https://api.githubcopilot.com/mcp/",
        "headers": { "Authorization": "Bearer ${GITHUB_MCP_TOKEN}" }
      }
    }
  }
  ```
  
  It tries the current Streamable HTTP transport and falls back to legacy HTTP+SSE if the server only speaks that; pin `"transport": "http"` or `"sse"` to skip the negotiation. `${VAR}` in a header value is read from the environment so tokens stay out of `settings.json`.
  
  MCP servers now also connect **in parallel with a 10-second timeout**, so a slow or unreachable one no longer holds up startup - it's reported and skipped like any other connection failure. `/status` and the startup line show each server's transport (`github (http)`, `filesystem (stdio)`).

### Patch Changes

- 7cb790d: Internal: drop the `chalk` dependency. It was used in exactly one place - inverting the single character under the input cursor - and chalk 6 raised its Node requirement to 22 (Polyglot targets 20+). Replaced with the literal `\x1b[7m…\x1b[27m` reverse-video codes, which is what `chalk.inverse` emitted anyway. One fewer direct dependency; cursor rendering is unchanged (verified in a terminal).
- cd44fb8: Internal: upgrade `glob` to 13.x. The `glob` tool's behaviour is unchanged - same pattern matching, same `node_modules` / secret-path exclusions, same sorted output. No source changes were needed; the two majors dropped Node 18 support (Polyglot already requires Node 20+) and trimmed transitive dependencies.
- fdd5677: Internal: upgrade `ink` to 7.x and `react` to 19.x (ink 6+ requires React 19). The only source change is in the input box: ink 7's key parser now reports `home` / `end` / `backspace` / `delete` correctly and distinctly, so the previous workaround - a listener on ink's private `internal_eventEmitter` that read raw escape sequences for those keys - is gone, replaced by normal `useInput` handling. Home/End/Backspace/Forward-delete editing behaves the same; verified in a real terminal.
- a0b2a3f: Internal: upgrade the `openai` SDK to 7.x. Only `providers/openai-compatible.ts` uses it, and the surface Polyglot touches - the client constructor, `chat.completions.create` with `stream: true` / `stream_options` / `response_format`, and iterating the stream - is unchanged across the three majors (which switched to native `fetch`, made the AWS/Bedrock and `zod` dependencies optional peers, and require Node 20+). Live-verified against a local Ollama endpoint: streaming, tool-call loop, usage chunks, structured output, mid-stream abort, and `--probe` all work. Drops the `pnpm` `peerDependencyRules` workaround added for zod 4 - `openai` 7 accepts zod 4 directly.
- 6c6a8f9: Internal: upgrade `zod` to 4.x. Settings-file parsing behaves identically - defaults, unknown-key stripping, and validation are unchanged (`z.record` calls now take an explicit key type, and the `permissions` default uses `.prefault`). Error text for a malformed `settings.json` value may differ slightly. `openai`'s zod peer (still on 3.x) is allowed against 4.x until that dependency is bumped.

## 0.9.0

### Minor Changes

- 58ea1a4: Lifecycle hooks. Add a `hooks` block to settings.json to run your own shell commands at three points: `preToolUse` (inspect a tool call and block it), `postToolUse` (inspect a result and block it), and `userPromptSubmit` (block a prompt or add context to it). A hook gets a JSON payload on stdin and `POLYGLOT_HOOK_EVENT` in its env; exit 0 proceeds, exit 2 blocks (stderr becomes the reason the model sees), and an optional stdout JSON `{ "decision": "block", "reason": "…", "additionalContext": "…" }` gives structured control. `preToolUse` / `postToolUse` entries can be scoped to specific tools with a `tools` glob list. Hooks run for sub-agents too. Project-local hooks (`.polyglot/settings.json`) are ignored unless the global config sets `hooks.allowProjectHooks: true` — running polyglot in an untrusted repo must not execute its shell. A broken hook fails open with a warning; `POLYGLOT_NO_HOOKS=1` disables all. `/status` shows the hook counts.
- ec42c02: Polyglot now scans the output of every tool call — shell commands, file reads, web fetches, MCP tools — for secret-looking values (API keys, tokens, private keys, `KEY=…` assignments) before it reaches the model, and flags what it finds in the transcript and the audit log. It's on by default in warn mode: the text the model sees is unchanged, you just get a `⚠ 1 secret-looking value in bash output (aws-key)` line. Set `redaction.mode: "redact"` (or `POLYGLOT_REDACT_OUTPUT=1`) to replace matches with `[redacted:<label>]` before they enter context; `redaction.pii: true` adds email / SSN / card / phone detection; `redaction.extraPatterns` adds your own; `POLYGLOT_NO_OUTPUT_SCAN=1` turns it off. `/status` shows the current mode. This is content-based and complements the existing path-based protection (a secret-*named* file still prompts for approval first).

### Patch Changes

- a111dfc: Security: bump the transitive `hono` dependency (via `@modelcontextprotocol/sdk`) to `4.13.7`, clearing three moderate advisories (`toSSG` path traversal, `parseBody` memory exhaustion, query-parser fragment handling) — none of which polyglot exercises, but they showed up in `pnpm audit`. Also moves the dev-only `vitest` to `4.1.11` for GHSA-82fw-gwwq-j7x9 (path traversal via `@vitest/mocker` redirect mocks; polyglot's tests use none). No runtime behaviour change.

## 0.8.0

### Minor Changes

- 5706ea3: Agent definitions. Drop a Markdown file at `.polyglot/agents/<name>.md` (or `~/.polyglot/agents/` for one available everywhere) with frontmatter — `description`, an optional `tools` allowlist, an optional `model` — and a body that becomes the agent's system prompt. Invoke it by starting a message with `@<name> <task>`: it runs as a one-shot sub-agent with just its allowed tools (and its own model, if pinned), streams its work into the transcript, and the result is recorded in the session so the main model and `--resume` see it. The model can also delegate to an agent on its own via the `agent_<name>` tool. `@` in the input now also suggests agents; `/agents` lists them and `/status` shows them. Set `POLYGLOT_NO_AGENTS=1` to disable. Works in `-p` mode too.
- ee270cd: `@`-mention a file to attach it to your message. Type `@` in the input for a fuzzy-search popup of the project's files (arrow keys, tab or enter to insert), or type the path directly. On send, each `@<path>` is replaced with the file's contents in a `<file>` block — so the model gets it without a `read_file` round-trip. The file list respects `.gitignore`; secret files (`.env`, keys, `.ssh/…`) are never inlined and get a note instead. Works in `-p` mode too.
- e0b3a8a: Skills. Put a focused instruction bundle at `.polyglot/skills/<name>/SKILL.md` (or `~/.polyglot/skills/` for one available everywhere) — frontmatter `description`, body is the guidance — and activate it for the session by typing `@<name>` in a message. Its instructions are added to the system prompt from the next turn until `/skill off`. Bundled resource files sit alongside `SKILL.md` and the model reads them by relative path. `@` suggestions now include skills; `/skills` lists them and shows which is active; `/status` has a skill line. Same `SKILL.md` layout as Claude Code, so skills are portable. `POLYGLOT_NO_SKILLS=1` disables. In `-p` mode, a `@<name>` token in the prompt activates the skill for that run.

## 0.7.0

### Minor Changes

- c9c79f6: Anthropic prompt caching. The system prompt (persona + project instructions + tool docs) is now sent as a cached block, so from the second turn of a session on it's a cache read (~0.1x input cost and lower latency) instead of being re-billed in full. `/cost` reflects the discount automatically. Requires `@anthropic-ai/sdk` ^0.122.0 (bumped from 0.32).
- 08329b0: Model failover. When the active model errors out (network / 5xx / auth) or stops producing valid tool calls mid-turn, the turn now continues on the next model in a configured `routing.failover` list (or `POLYGLOT_ROUTING_FAILOVER`) instead of stopping. The switch is sticky for the rest of the session and shown in the transcript; `polyglot -p --output-format json` gains a `fell_back_to` array.
  
  Two opt-in routing knobs alongside it: `routing.summaryModel` runs `/compact` and automatic compaction on a (typically cheaper) model, and `routing.planModel` runs plan-mode turns on a dedicated model — disabled for the session once you switch models manually with `/model`.
- 4e60218: New per-model reliability tally for the session: how many tool calls a model made, how many needed repair, how many failed to parse, and how many times it gave up. Surfaced in three places — a `reliability:` line in `/status`, a new `/reliability` command with the per-model breakdown, and a note next to each model in the `/model` picker (e.g. "92% clean this session" / "3 parse errors this session"). The status bar shows a `⚠N` / `NN% ok` segment once something's worth flagging. Headless `-p --output-format json` gains a `reliability` object. Memory-only — not persisted across `--resume`.
- 5cdec58: `polyglot share <id|path>` exports a session transcript to a Markdown or standalone-HTML file — for pasting into a PR, an issue, or a bug report. Secret-looking values (cloud keys, bearer tokens, private-key blocks, `KEY=...` assignments) are scrubbed by default; `--no-redact` keeps them, `--full` includes complete tool-call args and result bodies, `--format html` writes a self-contained page. The raw session file on disk is never modified. There's also a `/share` command in the TUI.
  
  `--resume` now also accepts a path to a `.jsonl` session file, so a teammate can hand you a session and you continue it.
- d1203db: Configurable sub-agent model. Set `subAgentModel` in settings.json (or `POLYGLOT_SUB_AGENT_MODEL`) to a model id/label and `task` sub-agents run on it instead of inheriting the parent's model — an easy cost win for delegated grunt work. Sub-agent token usage now rolls up into the session totals, so `/cost` and the `-p --output-format json` envelope show the sub-agent model as its own per-model row. Unset = sub-agents use the parent model, as before.

## 0.6.0

### Minor Changes

- 6224f69: New `polyglot init` command: an interactive first-run wizard that asks for a provider (local model or Anthropic), model, and base URL, and writes `~/.polyglot/settings.json`. Running `polyglot` in an interactive terminal with no config now launches this wizard automatically instead of exiting with "Provider not set". Non-interactive runs (`-p`, CI) keep the plain error.
- 18074c9: polyglot now reads a project instructions file and prepends it to the system prompt, like `CLAUDE.md` for Claude Code. It looks for, lowest priority first: `~/.polyglot/AGENTS.md`, `~/.polyglot/POLYGLOT.md`, `<project>/AGENTS.md`, `<project>/POLYGLOT.md` — all concatenated, `POLYGLOT.md` winning. `AGENTS.md` is the cross-tool standard, so a repo already set up for opencode / Codex / Cursor works with no extra file. Sub-agents get the same instructions. `/status` shows which files loaded; `POLYGLOT_NO_INSTRUCTIONS=1` skips loading. Files over 16 KB are truncated.

## 0.5.0

### Minor Changes

- 44cccfe: Tool-call repairs are now visible and auditable, so a parser fix can't quietly mask a model producing more malformed output.
  
  - A repaired tool call (malformed JSON, a stripped wrapper, args pulled out by parameter name, or a fuzzy-matched tool name) shows a dim `↺ repaired` marker on its card.
  - **Ctrl+R** toggles the model's verbatim raw block under every repaired card.
  - **`/raw`** prints the raw output next to the resolved call for every repair this session.
  - The **audit log** (`audit.enabled`) records the verbatim raw call on every repair - regardless of `hashArgs` - as new `repaired` / `rawCall` fields on the `tool_call` record.
  
  The default view is unchanged apart from the small marker.

### Patch Changes

- ee520ab: The background auto-updater no longer dumps the package manager's raw error output when it can't update. A registry propagation lag (the `latest` tag moved but the tarball isn't on the CDN yet - common in the minutes after a release) or a missing network connection now shows a single calm line ("polyglot will retry on the next start") instead of a red `npm error ETARGET` block. Only a genuine failure (e.g. a permissions error) shows a warning, with just the manual update command.

## 0.4.4

### Patch Changes

- 3df02d7: Force the transitive `qs` dependency (via `@modelcontextprotocol/sdk` → `express`) to `>=6.16.0`, clearing two moderate advisories (GHSA-x5fp-wj9c-mxmx array-limit bypass, GHSA-4mjr-xmp4-gh2g DoS). `qs` is only reachable through the optional MCP HTTP transport, but it ships in the published tarball.
- cf398e6: When a tool call's JSON body can't be parsed - a string argument with raw (unescaped) newlines and `"`, the way capable models routinely write file content into `edit_file` / `write_file`, or arguments split across two back-to-back `{...}` objects - the arguments are now pulled out by the tool's own parameter names as anchors: each `"<param>":` marker is found in order and its value taken up to the next marker. This tolerates raw newlines, unescaped quotes, split bodies and trailing-brace typos, and only applies when every required parameter is recovered, so a clean call is untouched and a genuinely malformed one still errors.
  
  On the todo-demo "add a count command" task, `qwen3-coder` went from 1-3 parse errors per run to zero.

## 0.4.3

### Patch Changes

- a333c34: A tool call whose arguments the model split across several back-to-back JSON objects - `{"path": ..., "old_string": ...}` then `{"new_string": ...}` in one `<tool_call>` block, a common `qwen3-coder` slip on `edit_file` - is now merged into the single object it meant, instead of failing schema validation ("must have required property 'path'") and bouncing the turn. A genuine JSON array value is left untouched.

## 0.4.2

### Patch Changes

- a41ca17: Two deterministic recoveries for the ways weaker models mangle file-writing tool calls, so a near-miss applies instead of looping to a give-up:
  
  - **`edit_file`** now retries a failed exact match with doubled escapes collapsed (`\\n`, `\\"`, `\\$`, `` \\` ``) and again matching line-by-line ignoring leading/trailing whitespace, re-anchoring `new_string` to the file's own indentation. A looser match is used only when it is still unique; exact matching always wins first.
  - **`write_file`** now recovers a body where the model wrote a whole file into `content` without escaping its quotes and newlines (or wrapped it in backticks or a ```` ``` ```` fence) - the dominant `write_file` parse failure. The fields before the blob are parsed normally and the blob is taken verbatim; a `"key":`-shaped run inside the unescaped content no longer fools it, and it declines rather than fabricate when the shape is ambiguous.
  
  Against `qwen2.5-coder:7b` on a simple "add a command" task this moves the success rate from roughly 0/8 to about half; `qwen3-coder` and Claude are unaffected except when their whitespace/escaping genuinely drifts.

## 0.4.1

### Patch Changes

- 1147f00: The tool-call repair pass now strips a markdown code fence or an `<syntax>` / `<block>` / `<code>` tag wrapping the whole tool-call body before parsing it. Qwen and DeepSeek family models add these routinely even when told not to; previously it caused a parse error plus a corrective message a small model won't reliably follow mid-stream, so the same call failed repeatedly until the turn gave up. Stripping an enclosing wrapper is deterministic and lossless, so the call now parses on the first attempt instead of failing the whole turn.

## 0.4.0

### Minor Changes

- a8786c8: Cost and token accounting for a session:
  
  - **`/cost`** shows the running token total and estimated cost, broken down per model when a session has switched models.
  - The **status bar** shows `· $0.0342` once a session has priced usage, and **`/status`** gains a `cost:` line.
  - Anthropic models are priced from a built-in list-price table (with a `claude-<tier>-*` family fallback for point releases). Any other model, including local ones, is free unless you give it a price via the new **`pricing`** settings key (`{ "<model-id>": { "input": <USD/1M>, "output": <USD/1M>, "cachedInput"?: <USD/1M> } }`).
  - Headless `-p --output-format json` output gains `cost_usd` and `tokens: { input, output }`.
  - Per-turn usage is written to the session transcript, so `--resume` restores an accurate figure.
- 7b4a771: Three fixes from dogfooding v0.3.0 on a weak local model:
  
  - **bash pipelines** now run with `pipefail`, so a failed early stage (`count | wc -l` where `count` doesn't exist) is reported as an error instead of the last stage's exit 0 masking it.
  - **tool results** render directly under their own call, even when a step's calls ran concurrently and their results arrived interleaved (previously `edit_file`'s result could appear under `read_file`'s call). Result lines also show the tool name.
  - **the `task` sub-agent** is off by default for models without reliable native tool-calling (openai-compatible), since a weak model that delegates to itself mostly burns turns; settable via `"subAgents": true/false` or `POLYGLOT_SUB_AGENTS`. A hard cap of 3 sub-agent spawns per user turn bounds cost for any model.

## 0.3.0

### Minor Changes

- 08f61ac: Opt-in audit log: set `"audit": { "enabled": true }` in settings (or `POLYGLOT_AUDIT=1`) to record every tool call, permission decision, tool result, token-usage report and stop reason as canonical JSONL under `~/.polyglot/audit/<session>.jsonl`, one file per session. Each record carries an ISO timestamp, the session id, and the model; tool-call arguments and tool results are stored as SHA-256 hashes by default (`"hashArgs": false` keeps raw args). Files respect `retentionDays`. Also adds a `permission_decision` agent event.
- 642732a: Provider adapters are now looked up through a registration table instead of a hard-coded branch (`registerProvider` / `createProviderAdapter`), and `createProviderAdapter` accepts capability overrides. New opt-in `--probe` flag (and `probeCapabilities` setting / `POLYGLOT_PROBE` env): on startup, ping an openai-compatible endpoint once to detect its real context window and whether it actually honors structured output, caching the result in `~/.polyglot/capabilities.json`.

### Patch Changes

- 3428fec: Fail fast and honestly on a model that can't hold the tool-call format. When a model bails to prose after unrecovered parse errors, the turn now ends with the "isn't reliably producing valid tool calls — try a larger model" warning instead of silently reporting success. A step that only produces parse errors plus denied/errored calls now counts toward the give-up limit (previously any dispatched call, even a denied one, masked it). A `task` sub-agent whose model goes unreliable returns a one-line error instead of dumping its garbage transcript into the parent's context, and any sub-agent report is capped at 4000 chars. Unparseable tool-call bodies get a sharper hint (escape embedded quotes/newlines; don't wrap content in `<syntax>`/`<block>`/fences).

## 0.2.0

### Minor Changes

- 2072d37: tell structured-mode models not to describe tool calls in prose
- f8d5c44: Flipping permission modes (Shift+Tab) or models (`/model`) several times in a row now overwrites a single "Switched to …" line instead of stacking one per flip. The thinking indicator stays pinned below the turn's streamed text and tool calls so new output no longer pushes it out of view.

### Patch Changes

- 64e4a6a: Keep structured tool-calling after a `/model` switch: the per-model config no longer drops a top-level `structuredOutput` setting when the chosen entry doesn't repeat it.
- adfba52: Pasting multi-line text into the input box no longer mangles the box border: carriage returns from the paste are converted to newlines instead of being inserted literally.

## 0.1.3

### Patch Changes

- Add a package README so npmjs.com shows install and quick-start docs instead of "This package does not have a README".

## 0.1.2

### Patch Changes

- updated logo in cli

## 0.1.1

### Patch Changes

- pnpm changeset

## 0.1.0

Initial release.

Model-agnostic coding-agent CLI: a fault-tolerant text-parsing tool-call pipeline that works
the same against Claude, GPT, and open-weight models (Qwen, DeepSeek, GLM, Llama) via any
OpenAI-compatible server. Permission modes (`manual`/`auto`/`plan`) with allow/deny globs,
plan mode with a real approval flow, session persistence + `--resume` + `/rename`, MCP client
support, sub-agent (`task`) delegation, `-p`/`--print` non-interactive mode, a configurable
`web_search` tool (DuckDuckGo by default, no key), real provider token accounting, and
ephemeral/`retentionDays` data-handling controls.
