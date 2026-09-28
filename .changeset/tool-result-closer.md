---
"@usepolyglot/core": patch
---

Fixed `ToolCallStreamParser` failing to close a tool-call envelope when a model closes with
`</tool_result>` instead of `</tool_call>` (some models blend their own natively-trained
closing tag with the prompted convention). Previously this left the envelope unterminated,
causing the parser to buffer everything after it - including subsequent, correctly formed
tool calls - as one unparseable body. Now tolerated the same way `</tool>` already is.
