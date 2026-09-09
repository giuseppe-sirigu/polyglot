---
"@usepolyglot/cli": minor
---

Lifecycle hooks. Add a `hooks` block to settings.json to run your own shell commands at three points: `preToolUse` (inspect a tool call and block it), `postToolUse` (inspect a result and block it), and `userPromptSubmit` (block a prompt or add context to it). A hook gets a JSON payload on stdin and `POLYGLOT_HOOK_EVENT` in its env; exit 0 proceeds, exit 2 blocks (stderr becomes the reason the model sees), and an optional stdout JSON `{ "decision": "block", "reason": "…", "additionalContext": "…" }` gives structured control. `preToolUse` / `postToolUse` entries can be scoped to specific tools with a `tools` glob list. Hooks run for sub-agents too. Project-local hooks (`.polyglot/settings.json`) are ignored unless the global config sets `hooks.allowProjectHooks: true` — running polyglot in an untrusted repo must not execute its shell. A broken hook fails open with a warning; `POLYGLOT_NO_HOOKS=1` disables all. `/status` shows the hook counts.
