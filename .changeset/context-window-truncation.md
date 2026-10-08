---
"@usepolyglot/core": minor
"@usepolyglot/cli": minor
---

Warn when a local model server is silently cutting off the prompt. A server with a small context
window (Ollama at its default, for one) drops the start of a long prompt - the agent's instructions
and tool docs - instead of refusing it. Each turn, the agent loop now compares the prompt it sent with
the prompt tokens the server reports reading, and when the server read clearly less, warns once with
how to raise the window (in headless runs, on stderr). The capability probe (`--probe`) now reads
Ollama's real context window from its own API, since its OpenAI-compatible endpoint doesn't report it.
