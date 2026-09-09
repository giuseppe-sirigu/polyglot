---
"@usepolyglot/cli": patch
---

Internal: upgrade `zod` to 4.x. Settings-file parsing behaves identically - defaults, unknown-key stripping, and validation are unchanged (`z.record` calls now take an explicit key type, and the `permissions` default uses `.prefault`). Error text for a malformed `settings.json` value may differ slightly. `openai`'s zod peer (still on 3.x) is allowed against 4.x until that dependency is bumped.
