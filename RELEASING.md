# Polyglot release checklist

The step-by-step runbook for cutting a release. `CONTRIBUTING.md` has the narrative
and the one-time npm trusted-publishing setup; this is the print-and-tick version.

Two packages publish independently: `@usepolyglot/cli` (this runbook) and
`@usepolyglot/core` (its own, separate process below - added 2026-09-23 so
first-party services outside this repo, e.g. the Gateway, can depend on core as a
normal npm package instead of needing workspace access to this monorepo).
`packages/cli/package.json`'s `version` is the one that matters for the CLI - it's
baked into the binary as `--version` and drives the auto-update check. Nothing
publishes on merge to `main`; a pushed `vX.Y.Z` tag is the only trigger for cli.

`X.Y.Z` = the new version throughout. Order matters.

## 1. Dependency hygiene (skipping this is what broke 0.4.0)

- [ ] Review open Dependabot PRs **one at a time** - never merge them as a batch.
- [ ] Patch / minor -> OK to merge once its own CI is green.
      Major -> its own branch + migration + green CI, **not** this release.
- [ ] On `main` after any dependency merge: `pnpm install --frozen-lockfile` succeeds
      with no "lockfile is not up to date" error. (This is what CI runs; a passing
      local `pnpm install` is not the same check.)
- [ ] On `main`: `pnpm build && pnpm typecheck && pnpm lint && pnpm test` all green.
- [ ] Latest Actions run on `main` is green.

## 2. Assemble the release

- [ ] Every feature / fix PR for this release is **merged to `main`**, each carrying
      its own `.changeset/*.md`.
- [ ] `git checkout main && git pull`
- [ ] `ls .changeset/*.md` - the changesets you expect are present (ignore `README.md`).
- [ ] If user-facing behavior changed, the `polyglot-website` docs PR is ready to
      merge alongside this one.
- [ ] `git checkout -b release/X.Y.Z`

## 3. Scenario matrix (reliability gate)

- [ ] Ollama running, with the models in
      `packages/core/src/testing/scenario-models.ts` pulled (`ollama list`).
- [ ] `pnpm scenario:live` - at the end it prints (and writes to `scenario-matrix.md`)
      a ready-to-paste markdown table plus a diff against the previous run.
- [ ] Read the verdict line:
      - "**No invariant regressed**" -> good, paste the table into the release PR.
      - "**⚠️ N invariant(s) regressed**" -> **stop**, investigate before releasing
        (weak-model `taskDone` misses are fine; a `✓ -> ✗` invariant flip is not).
      - **`llama3.2:3b` specifically is an exception worth knowing before you panic**
        (observed 2026-09-23): with `taskDone` already at 0-1/6 for this model, a
        *different* invariant flips almost every run - confirmed across three
        consecutive `SCENARIO_MODELS=llama3.2 pnpm scenario:live` runs, each one
        flagging a different invariant on a different scenario, with no code change
        in between. That's sampling noise on the weakest model in the panel, not a
        reproducible regression - re-run 2-3 times narrowed to just that model
        (`SCENARIO_MODELS=llama3.2`) before treating a llama3.2:3b-only flag as a
        real blocker. A flip on a **stronger** model is a different story - treat
        that as the real signal it's meant to be.

## 4. Version bump

- [ ] `pnpm changeset:version` - consumes `.changeset/*.md`, bumps
      `packages/cli/package.json`, writes `CHANGELOG.md`. It does **not** print the
      new version.
- [ ] Read the new version - **don't assume it**:
      `node -p "require('./packages/cli/package.json').version"`
      Pre-1.0, a `minor` changeset bumps the middle digit: `0.4.4` -> `0.5.0`, not
      `0.4.5`. Use this number for the branch name, commit message, and tag below.
- [ ] `git diff` - the bump matches what the changesets asked for (patch = fixes,
      minor = anything user-facing pre-1.0), the `CHANGELOG.md` entry reads
      cleanly, changeset files are deleted.
- [ ] `pnpm install --frozen-lockfile` (a version change can touch the lockfile),
      then `pnpm build && pnpm typecheck && pnpm lint && pnpm test` - all green.
- [ ] `git add packages/cli/package.json packages/cli/CHANGELOG.md .changeset/`
- [ ] `git commit -m "chore: release vX.Y.Z"`

## 5. Merge (tag ONLY after this)

- [ ] `git push -u origin release/X.Y.Z`
- [ ] Open the PR. Paste the scenario matrix table into the description.
- [ ] PR CI is green.
- [ ] **Merge the PR.**
- [ ] Merge the `polyglot-website` docs PR, if there is one.

## 6. Tag and publish

- [ ] `git checkout main && git pull`
- [ ] `git log --oneline -1` shows the release commit.
- [ ] Tag straight from `package.json` so the tag can't disagree with the version
      (the Release workflow hard-fails on a mismatch):
      ```bash
      V="v$(node -p "require('./packages/cli/package.json').version")"
      git tag "$V" && git push origin "$V"
      ```
- [ ] Actions -> **Release** workflow (tag-triggered) pauses on the `release`
      environment -> **approve it**.
- [ ] Workflow goes green: it re-runs the check suite, verifies tag == package
      version, packs the tarball with pnpm, and runs `npm publish --provenance`
      (OIDC, no secret on the runner).

## 7. Verify

- [ ] `npm view @usepolyglot/cli version` -> `X.Y.Z` (can lag a minute).
- [ ] `npm view @usepolyglot/cli dist-tags` -> `latest: X.Y.Z`.
- [ ] `npx @usepolyglot/cli@X.Y.Z --version` -> `X.Y.Z`.
- [ ] The npm package page shows the provenance attestation for this version.
- [ ] Delete the merged `release/X.Y.Z` branch.

## If something goes wrong

- **Tagged before merge, or tagged the wrong commit** (and the workflow has not
  published yet): `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`, fix,
  re-tag.
- **Tag doesn't match the package version** (usually: tagged `vX.Y.(Z+1)` but a
  `minor` changeset made it `vX.(Y+1).0`): the workflow fails its "Verify the tag
  matches" step by design - nothing was published. `package.json` and `CHANGELOG.md`
  are already correct; just move the tag:
  ```bash
  git checkout main && git pull
  git tag -d vWRONG && git push origin :refs/tags/vWRONG
  V="v$(node -p "require('./packages/cli/package.json').version")"
  git tag "$V" && git push origin "$V"
  ```
- **A broken version got published:** you can't unpublish after 72h or once anything
  depends on it. `npm deprecate "@usepolyglot/cli@X.Y.Z" "broken - use X.Y.(Z+1)"`
  and ship a patch.
- **`frozen-lockfile` fails in CI but not locally:** your local `node_modules` is
  stale. `rm -rf node_modules && pnpm install --frozen-lockfile` to see what CI sees.

## Releasing `@usepolyglot/core`

Mechanically identical to steps 1-7 above, with three differences: everything is
scoped to `packages/core` instead of `packages/cli`, the tag prefix is `core-v`
instead of plain `v` (so the two release trains can never collide or misfire each
other's workflow), and the triggered workflow is `.github/workflows/release-core.yml`
instead of `release.yml`. Concretely:

- Changesets for core-only changes still go in `.changeset/*.md` as usual;
  `pnpm changeset:version` bumps whichever packages have pending changesets, cli and
  core independently.
- Version bump commit: `git add packages/core/package.json packages/core/CHANGELOG.md .changeset/`
  (plus cli's files too if both had pending changesets in the same batch - they can
  ship in the same PR/commit even though they tag and publish separately).
- Tag: `V="core-v$(node -p "require('./packages/core/package.json').version")"`,
  then `git tag "$V" && git push origin "$V"`.
- **First publish is manual, same as cli was**: `@usepolyglot/core` has to already
  exist on npm before a Trusted Publisher can be configured for it (repo
  `giuseppe-sirigu/polyglot`, workflow `release-core.yml`, environment `release` -
  see CONTRIBUTING.md's npm trusted-publishing section for the cli-equivalent
  one-time setup). Until that first manual `npm publish` happens, `release-core.yml`
  has nothing to authenticate against and any tag push will just fail at the OIDC
  exchange step - expected, not a bug, the first time through.
- Verify with `npm view @usepolyglot/core version` / `dist-tags` the same way as cli.
