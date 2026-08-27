<p align="center">
  <img src="branding/logo.svg" width="120" alt="Polyglot logo" />
</p>

<h1 align="center">Polyglot</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@usepolyglot/cli"><img src="https://img.shields.io/npm/v/@usepolyglot/cli?color=blue" alt="npm version" /></a>
  <a href="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/ci.yml"><img src="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/codeql.yml"><img src="https://github.com/giuseppe-sirigu/polyglot/actions/workflows/codeql.yml/badge.svg" alt="CodeQL status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue" alt="License: FSL-1.1-ALv2" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >= 20" />
</p>

A coding-agent CLI that works the same way regardless of which model is answering - Claude, GPT, or an open-weight model like Qwen, DeepSeek, GLM, or Llama running locally via Ollama, vLLM, LM Studio, or any other OpenAI-compatible server.

## Why

Most agent CLIs lean on a provider's *native* function-calling API and assume near-perfect adherence to its exact tool-call JSON schema. Open-weight models frequently emit malformed, incomplete, or off-format tool calls against that API, so the whole agent loop breaks.

Polyglot treats tool invocation as a **text-parsing problem** instead: tools are described to the model in the system prompt, and a fault-tolerant streaming parser extracts and repairs tool calls from the model's raw output - trailing commas, single quotes, near-miss tool names, models that default to OpenAI-style `{"name":..., "arguments":...}` JSON instead of the taught envelope, all handled the same way. The same parser and executor run underneath every provider, so behavior doesn't silently diverge between "well-behaved" and "flaky" models.

## Install

```bash
npm install -g @usepolyglot/cli
```

Or build from source - see [the install guide](https://usepolyglot.dev/docs/start/install).

## Quick start

Point it at a local model (Ollama):

```bash
export POLYGLOT_PROVIDER=openai-compatible
export POLYGLOT_MODEL=qwen2.5-coder                # any model you've pulled
export POLYGLOT_BASE_URL=http://localhost:11434/v1 # default if unset
polyglot
```

Or Claude:

```bash
export POLYGLOT_PROVIDER=anthropic
export POLYGLOT_MODEL=claude-sonnet-4-5
export ANTHROPIC_API_KEY=sk-ant-...
polyglot
```

## Documentation

**Full documentation is at [usepolyglot.dev/docs](https://usepolyglot.dev/docs)** - first-run walkthroughs, the settings/env reference, permission modes, web search, MCP, scripting, running offline, and the model/server compatibility matrix.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) - dev setup, code style, the changeset/release flow, and what kinds of contributions are most useful right now (fixture tests from real messy model output, Windows testing, and additional OpenAI-compatible provider quirks especially).

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability. How Polyglot handles your data is documented at [usepolyglot.dev/docs/concepts/data-handling](https://usepolyglot.dev/docs/concepts/data-handling).

## License

[Functional Source License, Version 1.1, ALv2 Future License](https://fsl.software) - see [LICENSE](LICENSE).

Source is fully visible; you can read it, modify it, self-host it, and use it for your own internal purposes freely. The one thing it restricts is launching a competing commercial product or service built on this code. Two years after each version is published, that version automatically converts to the Apache License, Version 2.0.
