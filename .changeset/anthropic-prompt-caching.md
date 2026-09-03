---
"@usepolyglot/cli": minor
---

Anthropic prompt caching. The system prompt (persona + project instructions + tool docs) is now sent as a cached block, so from the second turn of a session on it's a cache read (~0.1x input cost and lower latency) instead of being re-billed in full. `/cost` reflects the discount automatically. Requires `@anthropic-ai/sdk` ^0.122.0 (bumped from 0.32).
