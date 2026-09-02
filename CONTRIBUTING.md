# Contributing

Thanks for considering a contribution - this is a small, early-stage project, so contributions genuinely move things forward.

## Setup

```bash
pnpm install
pnpm build
```

Requires Node.js >= 20 and pnpm 10.x (`corepack enable` will pick up the pinned version from `package.json`).

## Repository layout

```
packages/
  core/    # @usepolyglot/core - provider-agnostic engine, no TTY/UI assumptions
    src/
      agent/           # turn loop, tool executor, event types
      providers/       # Anthropic + OpenAI-compatible adapters
      tool-protocol/   # the grammar, streaming parser, repair pipeline - the core differentiator
      tools/           # built-in tools + task/exit-plan-mode
      mcp/             # MCP client + multi-server manager
      permissions/     # manual/auto/plan permission gate
      session/         # session types, JSONL persistence, context compaction
      config/          # settings.json schema + global/project/env merge
      testing/         # scenario harness (runScenario), invariants, scenario suite - test-only
  cli/     # @usepolyglot/cli - Ink-based terminal UI frontend
branding/  # logo assets
```

`packages/core` is UI-agnostic by design - a future VS Code extension or desktop app would be a new frontend against the same engine, not a rewrite. `@usepolyglot/core` is bundled into `@usepolyglot/cli` at build time by esbuild and is not published separately.

End-user documentation lives at [usepolyglot.dev/docs](https://usepolyglot.dev/docs) (source in a separate, private website repo). **If your change alters user-facing behavior - a flag, a setting, a command, a default - call that out in the PR description so the docs get updated alongside it.**

The repo-root `README.md` is the only one to edit. `packages/cli/README.md` (what npmjs.com shows) is generated from it at pack time by `scripts/gen-cli-readme.mjs` - which rewrites repo-relative links to absolute GitHub URLs - and is git-ignored.

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
short reader-facing summary - it becomes the changelog entry. Commit the generated
`.changeset/*.md` file with your code. Docs-only changes and internal refactors that don't
change behavior don't need one.

If you're touching `packages/core/src/tool-protocol/` (the streaming parser or the repair pipeline), please add a fixture test - that directory's test files are the thing keeping this project honest about actually working against messy real-model output, not just clean happy-path input. A captured real transcript from a model producing malformed or unusual tool calls is the most valuable kind of test case here.

The most load-bearing tests are in `packages/core/src/tool-protocol/*.test.ts`: the streaming-parser tests assert identical results no matter how the model's output is chunked across packets, and the resolver tests cover jsonrepair fallbacks, fuzzy tool-name correction, and both tool-call grammars (the taught XML envelope and the tolerated OpenAI-style fenced-JSON fallback). Coverage elsewhere in `packages/core` is pure-logic (config merging, session persistence, the agent loop, provider request-shaping); `packages/cli`'s Ink components have no automated coverage today and are verified by hand.

### Scenario harness and the live model matrix

`packages/core/src/testing/` runs a whole user turn end-to-end against a real temp working directory with the real tools:

- `runScenario()` / `runScenarioAgainst()` - drive `runAgentTurn` with either a *scripted* model (`string[]` of completions) or a real `ProviderAdapter`. Model-call and wall-clock budgets abort a runaway instead of letting a test hang.
- `invariants.ts` - properties that should hold for **any** model on **any** task (`shellFailuresSurfaced`, `resultsPairedToCalls`, `honestCompletion`, `subAgentSpawnsBounded`, `noRunaway`). Each throws a descriptive error on violation.
- `scenarios.ts` - the reusable scenario suite; each carries a declared invariant list, a `taskDone` check, and a scripted `goldenTurns` transcript of a competent model doing the task.
- `scenario-models.ts` - the model list `pnpm scenario:live` runs against.
- `scenario-matrix.test.ts` (runs in normal CI) - every scenario against its `goldenTurns`, asserting `taskDone` and every invariant. This is the regression gate; it needs no inference server.

**`pnpm scenario:live`** runs the same scenario suite against real models from `packages/core/src/testing/scenario-models.ts` (local Ollama tags by default; override with `SCENARIO_MODELS`, `SCENARIO_BASE_URL`, or `SCENARIO_INCLUDE_ANTHROPIC=1`). It prints a `model x invariant` table per scenario, then a ready-to-paste markdown summary (also written to `scenario-matrix.md`) with a diff against the previous run - "no invariant regressed" or a flagged list of `✓ -> ✗` flips. It writes a JSON transcript for every invariant failure to `packages/core/src/testing/captured-failures/` (git-ignored, ready to promote into a scripted `tool-protocol` fixture), and appends one summary line to `scenario-results.jsonl`.

This is a **discovery tool, not a gate** - a weak model failing `taskDone`, or even an invariant, on a hard task is expected. Watch the *diff from the last run*: a previously-passing (model, invariant) that now fails is a real regression. Run it when you touch the agent loop, the tool-call parser, or a built-in tool.

## Code style

- Biome handles formatting and linting (`pnpm format`, `pnpm lint`) - don't hand-format against it.
- No speculative abstractions: prefer three similar lines over a premature helper.
- Comments explain *why*, not *what* - skip comments that just restate the code.
- Keep `packages/core` free of any TTY/UI-specific code (no `console.log`, no Ink imports) - it's meant to be usable by frontends other than the CLI.

## Releasing (maintainers)

Only `@usepolyglot/cli` is published - `@usepolyglot/core` is bundled into it at build time by
esbuild and is not a separate package. `packages/cli/package.json`'s `version` is the only one
that matters; it's baked into the binary as `--version` and drives the auto-update check.

Publishing is manual and tag-triggered - nothing publishes on merge to `main`.

### One-time setup: npm trusted publishing

CI publishes with **npm trusted publishing (OIDC)** - no token, no repository secret.
It needs a *Trusted Publisher* configured on the npm package, which requires the
package to already exist, so:

1. Authenticate the CLI once: `npm login` (uses the browser flow, so a security key /
   2FA works). Check with `npm whoami`.
2. Do the **first publish by hand**:
   ```bash
   pnpm install
   pnpm publish:manual
   ```
   (`publish:manual` builds, `pnpm pack`s a tarball - which resolves the `workspace:`
   devDependency - and `npm publish`es it, so the 2FA prompt is handled by npm.)
3. Configure the Trusted Publisher on the **package page** (not account settings):
   `npmjs.com/package/@usepolyglot/cli/access` → **Trusted Publisher → GitHub
   Actions** → organization `giuseppe-sirigu`, repository `polyglot`, workflow
   `release.yml`, environment blank. Then set **Publishing access** to require a
   trusted publisher or 2FA.

From then on, every release goes through CI with no credentials on the runner.

### Cutting a release

[`RELEASING.md`](RELEASING.md) is the print-and-tick checklist. The short version:

1. Merge the PRs you want in the release (each carrying its changeset).
2. Run `pnpm scenario:live` against your local models. Paste its markdown summary
   into the release PR. If its verdict line flags a regression (an invariant that
   flipped ✓ → ✗ vs the previous run), stop and investigate; weak-model `taskDone`
   misses are fine.
3. `pnpm changeset:version` - consumes the pending `.changeset/*.md`, bumps
   `packages/cli/package.json`, and updates `CHANGELOG.md`. Review the diff.
4. Commit it (`chore: release vX.Y.Z`) and get it onto `main` via PR.
5. Tag that commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag v$(node -p "require('./packages/cli/package.json').version")
   git push origin --tags
   ```
6. The `Release` workflow re-runs build/typecheck/lint/test, checks the tag matches
   the package version, packs the tarball with pnpm (which resolves the `workspace:`
   devDependency), and publishes it with `npm publish --provenance` - authenticating
   via OIDC, with a signed provenance attestation. No secret on the runner.

## Versioning

Semantic versioning, and pre-1.0: expect breaking changes between minor versions until 1.0.0. Each published version is licensed under FSL as of its own release date - the two-year conversion to Apache 2.0 is tracked per-version, not from the project's original release.

## Reporting bugs

Open an issue with: your OS, the model/provider you were using (this project cares a lot about behavior against different open-weight models specifically), and - if it's a tool-call parsing issue - the raw model output that triggered it, if you can capture it. That raw transcript is usually the single most useful thing you can include.

## What contributions are especially welcome

- Fixture tests from real messy model output (see above)
- Support for additional OpenAI-compatible providers/quirks
- Windows testing and fixes - most development so far has been on Linux/macOS
- MCP server compatibility reports

## License

By contributing, you agree your contribution is licensed under this project's license (see [LICENSE](LICENSE) - the Functional Source License, converting to Apache 2.0 after two years per release).
