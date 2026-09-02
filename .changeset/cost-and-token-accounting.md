---
"@usepolyglot/cli": minor
---

Cost and token accounting for a session:

- **`/cost`** shows the running token total and estimated cost, broken down per model when a session has switched models.
- The **status bar** shows `· $0.0342` once a session has priced usage, and **`/status`** gains a `cost:` line.
- Anthropic models are priced from a built-in list-price table (with a `claude-<tier>-*` family fallback for point releases). Any other model — including local ones — is free unless you give it a price via the new **`pricing`** settings key (`{ "<model-id>": { "input": <USD/1M>, "output": <USD/1M>, "cachedInput"?: <USD/1M> } }`).
- Headless `-p --output-format json` output gains `cost_usd` and `tokens: { input, output }`.
- Per-turn usage is written to the session transcript, so `--resume` restores an accurate figure.
