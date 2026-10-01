---
"@usepolyglot/core": patch
"@usepolyglot/cli": patch
---

Harden a few edges flagged by CodeQL. Self-update runs the package manager without a shell and
refuses a package name that isn't a plain npm name. `web_fetch` / `web_search` decode HTML
entities in one pass (no double-decoding) and drop `<script>` / `<style>` blocks whose end tag
carries whitespace or attributes; DuckDuckGo redirects are unwrapped only on duckduckgo.com itself.
`grep` size-checks the open file it reads rather than the path.
