---
"@usepolyglot/cli": patch
---

Internal: drop the `chalk` dependency. It was used in exactly one place - inverting the single character under the input cursor - and chalk 6 raised its Node requirement to 22 (Polyglot targets 20+). Replaced with the literal `\x1b[7m…\x1b[27m` reverse-video codes, which is what `chalk.inverse` emitted anyway. One fewer direct dependency; cursor rendering is unchanged (verified in a terminal).
