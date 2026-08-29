---
"@usepolyglot/cli": patch
---

Keep structured tool-calling after a `/model` switch: the per-model config no longer drops a top-level `structuredOutput` setting when the chosen entry doesn't repeat it.
