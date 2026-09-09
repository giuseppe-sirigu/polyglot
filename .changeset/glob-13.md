---
"@usepolyglot/cli": patch
---

Internal: upgrade `glob` to 13.x. The `glob` tool's behaviour is unchanged - same pattern matching, same `node_modules` / secret-path exclusions, same sorted output. No source changes were needed; the two majors dropped Node 18 support (Polyglot already requires Node 20+) and trimmed transitive dependencies.
