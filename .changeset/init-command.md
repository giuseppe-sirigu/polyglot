---
"@usepolyglot/cli": minor
---

New `polyglot init` command: an interactive first-run wizard that asks for a provider (local model or Anthropic), model, and base URL, and writes `~/.polyglot/settings.json`. Running `polyglot` in an interactive terminal with no config now launches this wizard automatically instead of exiting with "Provider not set". Non-interactive runs (`-p`, CI) keep the plain error.
