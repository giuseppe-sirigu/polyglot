# @usepolyglot/cli

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
