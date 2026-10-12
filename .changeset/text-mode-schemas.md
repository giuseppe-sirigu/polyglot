---
"@usepolyglot/core": minor
"@usepolyglot/cli": minor
---

Text tool-calling mode now shows the model each tool's full schema: allowed values, item types, nested
objects with their required keys, and patterns, formats and limits. Before, an enum read as `string`, a
list as `unknown[]` and a nested object as `object`, so a model was refused for breaking rules it was
never shown; MCP tools, whose schemas are often richer, gain the most. The example call in the prompt
now fits the schema too. A tool's own parameter called `name`, `tool` or `function` is no longer dropped
as if it restated the tool's name, and a nested object or list in a call with broken JSON is read as one
instead of as text.

A reply that announces a next step ("Let me start by reading the file.") but makes no tool call no
longer ends the turn: the model is asked to make the call, at most twice per message, as an empty reply
already was. New agent event: `intent_nudged`.

A reply cut off by the output length limit is no longer taken as finished or acted on blindly. A tool
call the limit cut off isn't run (repairing its arguments would close the open string, so write_file
wrote a truncated file); the model is told to make it again in smaller pieces. An answer cut off before
any call, or a reply left empty because reasoning used up the limit, gets a request to continue, at most
twice per message. New agent event: `length_nudged`.

With Claude, a reply may now be up to 16,384 tokens instead of 4,096, so writing a large file in one
call no longer runs into the limit. Claude 3 and 3.5 models keep their own lower maximum.
