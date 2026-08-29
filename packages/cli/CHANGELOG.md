# @usepolyglot/cli

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
