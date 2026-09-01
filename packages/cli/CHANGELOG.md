# @usepolyglot/cli

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
