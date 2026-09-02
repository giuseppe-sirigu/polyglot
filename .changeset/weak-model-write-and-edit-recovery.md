---
"@usepolyglot/cli": patch
---

Two deterministic recoveries for the ways weaker models mangle file-writing tool calls, so a near-miss applies instead of looping to a give-up:

- **`edit_file`** now retries a failed exact match with doubled escapes collapsed (`\\n`, `\\"`, `\\$`, `` \\` ``) and again matching line-by-line ignoring leading/trailing whitespace, re-anchoring `new_string` to the file's own indentation. A looser match is used only when it is still unique; exact matching always wins first.
- **`write_file`** now recovers a body where the model wrote a whole file into `content` without escaping its quotes and newlines (or wrapped it in backticks or a ```` ``` ```` fence) - the dominant `write_file` parse failure. The fields before the blob are parsed normally and the blob is taken verbatim; a `"key":`-shaped run inside the unescaped content no longer fools it, and it declines rather than fabricate when the shape is ambiguous.

Against `qwen2.5-coder:7b` on a simple "add a command" task this moves the success rate from roughly 0/8 to about half; `qwen3-coder` and Claude are unaffected except when their whitespace/escaping genuinely drifts.
