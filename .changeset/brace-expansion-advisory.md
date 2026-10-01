---
"@usepolyglot/core": patch
"@usepolyglot/cli": patch
---

Patch brace-expansion (pulled in through minimatch for the glob tool) against three denial-of-service
advisories, where a crafted brace pattern - which a model can pass to glob - could hang or crash the CLI.
