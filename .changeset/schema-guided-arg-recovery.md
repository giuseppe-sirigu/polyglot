---
"@usepolyglot/cli": patch
---

When a tool call's JSON body can't be parsed - a string argument with raw (unescaped) newlines and `"`, the way capable models routinely write file content into `edit_file` / `write_file`, or arguments split across two back-to-back `{...}` objects - the arguments are now pulled out by the tool's own parameter names as anchors: each `"<param>":` marker is found in order and its value taken up to the next marker. This tolerates raw newlines, unescaped quotes, split bodies and trailing-brace typos, and only applies when every required parameter is recovered, so a clean call is untouched and a genuinely malformed one still errors.

On the todo-demo "add a count command" task, `qwen3-coder` went from 1-3 parse errors per run to zero.
