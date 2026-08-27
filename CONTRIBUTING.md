# Contributing

Thanks for considering a contribution — this is a small, early-stage project, so contributions genuinely move things forward.

## Setup

```bash
pnpm install
pnpm build
```

Requires Node.js >= 20 and pnpm 10.x (`corepack enable` will pick up the pinned version from `package.json`).

## Repository layout

```
packages/
  core/    # @usepolyglot/core — provider-agnostic engine, no TTY/UI assumptions
    src/
      agent/           # turn loop, tool executor, event types
      providers/       # Anthropic + OpenAI-compatible adapters
      tool-protocol/   # the grammar, streaming parser, repair pipeline — the core differentiator
      tools/           # built-in tools + task/exit-plan-mode
      mcp/             # MCP client + multi-server manager
      permissions/     # manual/auto/plan permission gate
      session/         # session types, JSONL persistence, context compaction
      config/          # settings.json schema + global/project/env merge
  cli/     # @usepolyglot/cli — Ink-based terminal UI frontend
branding/  # logo assets
```

`packages/core` is UI-agnostic by design — a future VS Code extension or desktop app would be a new frontend against the same engine, not a rewrite. `@usepolyglot/core` is bundled into `@usepolyglot/cli` at build time by esbuild and is not published separately.

End-user documentation lives in a separate repo, [`giuseppe-sirigu/polyglot-website`](https://github.com/giuseppe-sirigu/polyglot-website) (`src/content/docs/`), and is published to [usepolyglot.dev/docs](https://usepolyglot.dev/docs). **A change that alters user-facing behavior — a flag, a setting, a command, a default — should ship a companion PR to that repo.**

## Before opening a PR

```bash
pnpm build       # build all packages
pnpm typecheck   # typecheck all packages
pnpm lint        # biome check
pnpm test        # vitest
```

All four run in CI on every PR; please make sure they pass locally first. `pnpm format` (biome format --write) will fix most style issues automatically.

If your change affects what the published CLI does, add a changeset:

```bash
pnpm changeset
```

Pick a bump type (pre-1.0: `minor` for anything user-visible, `patch` for fixes) and write a
short reader-facing summary — it becomes the changelog entry. Commit the generated
`.changeset/*.md` file with your code. Docs-only changes and internal refactors that don't
change behavior don't need one.

If you're touching `packages/core/src/tool-protocol/` (the streaming parser or the repair pipeline), please add a fixture test — that directory's test files are the thing keeping this project honest about actually working against messy real-model output, not just clean happy-path input. A captured real transcript from a model producing malformed or unusual tool calls is the most valuable kind of test case here.

The most load-bearing tests are in `packages/core/src/tool-protocol/*.test.ts`: the streaming-parser tests assert identical results no matter how the model's output is chunked across packets, and the resolver tests cover jsonrepair fallbacks, fuzzy tool-name correction, and both tool-call grammars (the taught XML envelope and the tolerated OpenAI-style fenced-JSON fallback). Coverage elsewhere in `packages/core` is pure-logic (config merging, session persistence, the agent loop, provider request-shaping); `packages/cli`'s Ink components have no automated coverage today and are verified by hand.

## Code style

- Biome handles formatting and linting (`pnpm format`, `pnpm lint`) — don't hand-format against it.
- No speculative abstractions: prefer three similar lines over a premature helper.
- Comments explain *why*, not *what* — skip comments that just restate the code.
- Keep `packages/core` free of any TTY/UI-specific code (no `console.log`, no Ink imports) — it's meant to be usable by frontends other than the CLI.

## Releasing (maintainers)

Only `@usepolyglot/cli` is published — `@usepolyglot/core` is bundled into it at build time by
esbuild and is not a separate package. `packages/cli/package.json`'s `version` is the only one
that matters; it's baked into the binary as `--version` and drives the auto-update check.

Publishing is manual and tag-triggered — nothing publishes on merge to `main`:

1. Merge the PRs you want in the release (each carrying its changeset).
2. `pnpm changeset:version` — consumes the pending `.changeset/*.md`, bumps
   `packages/cli/package.json`, and updates `CHANGELOG.md`. Review the diff.
3. Commit it (`chore: release vX.Y.Z`) and push to `main` (via PR).
4. Tag that commit and push the tag:
   ```bash
   git tag v$(node -p "require('./packages/cli/package.json').version")
   git push origin --tags
   ```
5. The `Release` workflow (`.github/workflows/release.yml`) re-runs build/typecheck/lint/test,
   checks the tag matches the package version, and runs `changeset publish` to npm (with
   provenance). It needs the `NPM_TOKEN` repository secret.

## Versioning

Semantic versioning, and pre-1.0: expect breaking changes between minor versions until 1.0.0. Each published version is licensed under FSL as of its own release date — the two-year conversion to Apache 2.0 is tracked per-version, not from the project's original release.

## Reporting bugs

Open an issue with: your OS, the model/provider you were using (this project cares a lot about behavior against different open-weight models specifically), and — if it's a tool-call parsing issue — the raw model output that triggered it, if you can capture it. That raw transcript is usually the single most useful thing you can include.

## What contributions are especially welcome

- Fixture tests from real messy model output (see above)
- Support for additional OpenAI-compatible providers/quirks
- Windows testing and fixes — most development so far has been on Linux/macOS
- MCP server compatibility reports

## License

By contributing, you agree your contribution is licensed under this project's license (see [LICENSE](LICENSE) — the Functional Source License, converting to Apache 2.0 after two years per release).
