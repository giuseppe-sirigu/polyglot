# @usepolyglot/core

## 0.3.2

### Patch Changes

- d2d24a0: Patch brace-expansion (pulled in through minimatch for the glob tool) against three denial-of-service
  advisories, where a crafted brace pattern - which a model can pass to glob - could hang or crash the CLI.
- 1ea3498: Harden a few edges flagged by CodeQL. Self-update runs the package manager without a shell and
  refuses a package name that isn't a plain npm name. `web_fetch` / `web_search` decode HTML
  entities in one pass (no double-decoding) and drop `<script>` / `<style>` blocks whose end tag
  carries whitespace or attributes; DuckDuckGo redirects are unwrapped only on duckduckgo.com itself.
  `grep` size-checks the open file it reads rather than the path.
- 3ebaa98: Recover tool calls in the forms current local models actually emit. Native `tool_calls` from an
  OpenAI-compatible server (gpt-oss via Ollama) are now run instead of dropped; Devstral's
  `read_file{...}` / `[TOOL_CALLS]read_file[ARGS]{...}`, a tool name used as the tag
  (`<edit_file>...</edit_file>`), and a ```json fence naming a known tool are recognized. Repair no
  longer folds stray `"}` after a finished object into the last argument (which produced paths like
  `sum.mjs"}` that don't exist), and an empty reply mid-task is nudged instead of ending the turn.
  Also recovered: Qwen's native `<function=name><parameter=key>` body, a nameless `<tool_call>`
  stuttered before the named one, a `<tool_call>` glued onto the end of a sentence, `name.call({...})`,
  `glob_call name="glob">` with its `<` dropped, and a single-word string body (`<glob>**/*.json</glob>`).
  A call whose close tag is broken, or missing, no longer swallows the model's invented next turn into
  its arguments (which had written junk into files and broken shell quoting).

## 0.3.1

### Patch Changes

- 921da80: Fixed `ToolCallStreamParser` failing to close a tool-call envelope when a model closes with
  `</tool_result>` instead of `</tool_call>` (some models blend their own natively-trained
  closing tag with the prompted convention). Previously this left the envelope unterminated,
  causing the parser to buffer everything after it - including subsequent, correctly formed
  tool calls - as one unparseable body. Now tolerated the same way `</tool>` already is.

## 0.3.0

### Minor Changes

- Add the reliability digest report module (`generateReliabilityDigest`, `renderDigestMarkdown`,
  `buildRedactionPreview`, `repairRecordsFromAuditEvents`) and `readAuditEvents` for reading the
  local audit log back. Also adds a `strategy` field to `ParsedToolCall`/`AgentEvent`'s
  `tool_call` variant/`AuditEvent`'s `tool_call` variant (which repair path resolved a call,
  including "clean" for a non-repaired one) - previously only tracked internally by
  `repairJson`, now threaded through to the audit log so the digest can break down repairs by
  strategy, not just by model. All additive; no existing export's shape changed.

## 0.2.0

### Minor Changes

- c5de366: Split `repairJson` into `repairJsonFastPath` (wrapper-strip + one `JSON.parse`) and
  `repairJsonSlowPath` (`jsonrepair()` + regex fallbacks), both now exported alongside the
  existing `repairJson` (unchanged behavior - it composes the two). Lets a caller under
  concurrent load keep the cheap fast path inline and only dispatch the expensive slow path to
  a worker thread. Also exports `resolveEnvelopeFromRepair` (same dispatch as `resolveEnvelope`,
  taking an already-computed repair result) and adds an additive `strategy` field
  (`"clean" | "wrapper_stripped" | "jsonrepair" | "loose_kv" | "trailing_blob"`) to
  `RepairResult`'s `ok: true` branch, for repair-audit confidence tracking.
