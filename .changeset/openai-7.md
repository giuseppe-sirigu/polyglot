---
"@usepolyglot/cli": patch
---

Internal: upgrade the `openai` SDK to 7.x. Only `providers/openai-compatible.ts` uses it, and the surface Polyglot touches - the client constructor, `chat.completions.create` with `stream: true` / `stream_options` / `response_format`, and iterating the stream - is unchanged across the three majors (which switched to native `fetch`, made the AWS/Bedrock and `zod` dependencies optional peers, and require Node 20+). Live-verified against a local Ollama endpoint: streaming, tool-call loop, usage chunks, structured output, mid-stream abort, and `--probe` all work. Drops the `pnpm` `peerDependencyRules` workaround added for zod 4 - `openai` 7 accepts zod 4 directly.
