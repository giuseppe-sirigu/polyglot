---
"@usepolyglot/cli": minor
---

Tool-call repairs are now visible and auditable, so a parser fix can't quietly mask a model producing more malformed output.

- A repaired tool call (malformed JSON, a stripped wrapper, args pulled out by parameter name, or a fuzzy-matched tool name) shows a dim `↺ repaired` marker on its card.
- **Ctrl+R** toggles the model's verbatim raw block under every repaired card.
- **`/raw`** prints the raw output next to the resolved call for every repair this session.
- The **audit log** (`audit.enabled`) records the verbatim raw call on every repair - regardless of `hashArgs` - as new `repaired` / `rawCall` fields on the `tool_call` record.

The default view is unchanged apart from the small marker.
