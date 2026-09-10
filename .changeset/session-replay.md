---
"@usepolyglot/cli": minor
---

**Replay a saved session.** `polyglot replay <id|path>` re-runs a session against the current
build and shows where it diverges. By default it's parse-level: every recorded model completion
is re-resolved through today's tool-call parser and repair pipeline, and the report flags each
tool call that now resolves differently, each repair that's newly needed, and any case a
since-released fix would have handled — fully deterministic, no execution. `--execute --seed
<dir>` replays the whole agent loop in a temp working directory and reports invariants plus the
tool-call diff; `--output-format json` gives the machine-readable report; `--save <name>` turns
the session into a committed regression test.
