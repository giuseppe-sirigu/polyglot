---
"@usepolyglot/cli": minor
---

`@`-mention a file to attach it to your message. Type `@` in the input for a fuzzy-search popup of the project's files (arrow keys, tab or enter to insert), or type the path directly. On send, each `@<path>` is replaced with the file's contents in a `<file>` block — so the model gets it without a `read_file` round-trip. The file list respects `.gitignore`; secret files (`.env`, keys, `.ssh/…`) are never inlined and get a note instead. Works in `-p` mode too.
