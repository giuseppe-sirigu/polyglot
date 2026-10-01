---
"@usepolyglot/core": patch
"@usepolyglot/cli": patch
---

Recover tool calls in the forms current local models actually emit. Native `tool_calls` from an
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
