# Polyglot release checklist

The step-by-step runbook for cutting a release. `CONTRIBUTING.md` has the narrative
and the one-time npm trusted-publishing setup; this is the print-and-tick version.

Only `@usepolyglot/cli` is published. `packages/cli/package.json`'s `version` is the
only one that matters - it's baked into the binary as `--version` and drives the
auto-update check. Nothing publishes on merge to `main`; a pushed `vX.Y.Z` tag is the
only trigger.

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

## 4. Version bump

- [ ] `pnpm changeset:version` - consumes `.changeset/*.md`, bumps
      `packages/cli/package.json`, writes `CHANGELOG.md`.
- [ ] `git diff` - version bump is what you expect (patch for fixes, minor for
      features pre-1.0), the `CHANGELOG.md` entry reads cleanly, changeset files
      are deleted.
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
- [ ] `git log --oneline -1` shows `chore: release vX.Y.Z`.
- [ ] `node -p "require('./packages/cli/package.json').version"` equals `X.Y.Z`.
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z`
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
- **Tag doesn't match the package version:** the workflow fails its "Verify the tag
  matches" step by design. Delete the tag, run `pnpm changeset:version` properly,
  re-tag.
- **A broken version got published:** you can't unpublish after 72h or once anything
  depends on it. `npm deprecate "@usepolyglot/cli@X.Y.Z" "broken - use X.Y.(Z+1)"`
  and ship a patch.
- **`frozen-lockfile` fails in CI but not locally:** your local `node_modules` is
  stale. `rm -rf node_modules && pnpm install --frozen-lockfile` to see what CI sees.
