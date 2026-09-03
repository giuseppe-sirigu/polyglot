---
"@usepolyglot/cli": minor
---

Model failover. When the active model errors out (network / 5xx / auth) or stops producing valid tool calls mid-turn, the turn now continues on the next model in a configured `routing.failover` list (or `POLYGLOT_ROUTING_FAILOVER`) instead of stopping. The switch is sticky for the rest of the session and shown in the transcript; `polyglot -p --output-format json` gains a `fell_back_to` array.

Two opt-in routing knobs alongside it: `routing.summaryModel` runs `/compact` and automatic compaction on a (typically cheaper) model, and `routing.planModel` runs plan-mode turns on a dedicated model — disabled for the session once you switch models manually with `/model`.
