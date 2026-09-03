---
"@usepolyglot/cli": minor
---

Configurable sub-agent model. Set `subAgentModel` in settings.json (or `POLYGLOT_SUB_AGENT_MODEL`) to a model id/label and `task` sub-agents run on it instead of inheriting the parent's model — an easy cost win for delegated grunt work. Sub-agent token usage now rolls up into the session totals, so `/cost` and the `-p --output-format json` envelope show the sub-agent model as its own per-model row. Unset = sub-agents use the parent model, as before.
