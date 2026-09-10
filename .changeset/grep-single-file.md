---
"@usepolyglot/cli": patch
---

`grep` now searches a single file, not just a directory. Passing a file to `path`
previously walked it as a directory, silently found nothing, and returned "No matches" -
which reads as "the pattern isn't there" rather than "wrong kind of path", and sent
weaker models down a dead end. A `path` that doesn't exist now returns a clear "Path not
found" instead of an empty result, and a `path` pointing straight at a secret-looking
file is refused rather than searched.
