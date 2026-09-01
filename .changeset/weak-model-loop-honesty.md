---
"@usepolyglot/cli": patch
---

Fail fast and honestly on a model that can't hold the tool-call format. When a model bails to prose after unrecovered parse errors, the turn now ends with the "isn't reliably producing valid tool calls — try a larger model" warning instead of silently reporting success. A step that only produces parse errors plus denied/errored calls now counts toward the give-up limit (previously any dispatched call, even a denied one, masked it). A `task` sub-agent whose model goes unreliable returns a one-line error instead of dumping its garbage transcript into the parent's context, and any sub-agent report is capped at 4000 chars. Unparseable tool-call bodies get a sharper hint (escape embedded quotes/newlines; don't wrap content in `<syntax>`/`<block>`/fences).
