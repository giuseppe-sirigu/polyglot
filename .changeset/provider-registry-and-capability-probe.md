---
"@usepolyglot/cli": minor
---

Provider adapters are now looked up through a registration table instead of a hard-coded branch (`registerProvider` / `createProviderAdapter`), and `createProviderAdapter` accepts capability overrides. New opt-in `--probe` flag (and `probeCapabilities` setting / `POLYGLOT_PROBE` env): on startup, ping an openai-compatible endpoint once to detect its real context window and whether it actually honors structured output, caching the result in `~/.polyglot/capabilities.json`.
