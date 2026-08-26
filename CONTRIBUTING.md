# Contributing

Thanks for considering a contribution — this is a small, early-stage project, so contributions genuinely move things forward.

## Setup

```bash
pnpm install
pnpm build
```

Requires Node.js >= 20 and pnpm 10.x (`corepack enable` will pick up the pinned version from `package.json`).

## Before opening a PR

```bash
pnpm build       # build all packages
pnpm typecheck   # typecheck all packages
pnpm lint        # biome check
pnpm test        # vitest
```

All four run in CI on every PR; please make sure they pass locally first. `pnpm format` (biome format --write) will fix most style issues automatically.

If you're touching `packages/core/src/tool-protocol/` (the streaming parser or the repair pipeline), please add a fixture test — that directory's test files are the thing keeping this project honest about actually working against messy real-model output, not just clean happy-path input. A captured real transcript from a model producing malformed or unusual tool calls is the most valuable kind of test case here.

## Code style

- Biome handles formatting and linting (`pnpm format`, `pnpm lint`) — don't hand-format against it.
- No speculative abstractions: prefer three similar lines over a premature helper.
- Comments explain *why*, not *what* — skip comments that just restate the code.
- Keep `packages/core` free of any TTY/UI-specific code (no `console.log`, no Ink imports) — it's meant to be usable by frontends other than the CLI.

## Reporting bugs

Open an issue with: your OS, the model/provider you were using (this project cares a lot about behavior against different open-weight models specifically), and — if it's a tool-call parsing issue — the raw model output that triggered it, if you can capture it. That raw transcript is usually the single most useful thing you can include.

## What contributions are especially welcome

- Fixture tests from real messy model output (see above)
- Support for additional OpenAI-compatible providers/quirks
- Windows testing and fixes — most development so far has been on Linux/macOS
- MCP server compatibility reports

## License

By contributing, you agree your contribution is licensed under this project's license (see [LICENSE](LICENSE) — the Functional Source License, converting to Apache 2.0 after two years per release).
