---
"@usepolyglot/cli": patch
---

A tool call whose arguments the model split across several back-to-back JSON objects - `{"path": ..., "old_string": ...}` then `{"new_string": ...}` in one `<tool_call>` block, a common `qwen3-coder` slip on `edit_file` - is now merged into the single object it meant, instead of failing schema validation ("must have required property 'path'") and bouncing the turn. A genuine JSON array value is left untouched.
