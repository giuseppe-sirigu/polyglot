---
"@usepolyglot/cli": minor
---

Three fixes from dogfooding v0.3.0 on a weak local model:

- **bash pipelines** now run with `pipefail`, so a failed early stage (`count | wc -l` where `count` doesn't exist) is reported as an error instead of the last stage's exit 0 masking it.
- **tool results** render directly under their own call, even when a step's calls ran concurrently and their results arrived interleaved (previously `edit_file`'s result could appear under `read_file`'s call). Result lines also show the tool name.
- **the `task` sub-agent** is off by default for models without reliable native tool-calling (openai-compatible) — a weak model that delegates to itself mostly burns turns — settable via `"subAgents": true/false` or `POLYGLOT_SUB_AGENTS`. A hard cap of 3 sub-agent spawns per user turn bounds cost for any model.
