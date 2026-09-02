---
"@usepolyglot/cli": patch
---

The tool-call repair pass now strips a markdown code fence or an `<syntax>` / `<block>` / `<code>` tag that wraps the whole tool-call body before trying to parse it. Qwen and DeepSeek family models do this routinely (```` ```json ... ``` ````), and previously it produced a parse error plus a corrective message a small model won't reliably follow mid-stream, so the same call failed repeatedly and the turn gave up. Stripping the wrapper is deterministic and lossless, so a fenced `edit_file` call from `qwen2.5-coder:7b` now parses and applies on the first attempt.
