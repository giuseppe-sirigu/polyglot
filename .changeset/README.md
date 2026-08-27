# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). Each file
here describes an intended change to a published package (`@usepolyglot/cli`) and how it should
bump the version.

## Adding a changeset

When your change affects what's published, run:

```bash
pnpm changeset
```

Pick the bump type (pre-1.0: `minor` for anything user-visible, `patch` for fixes) and write a
one- or two-line summary — that text becomes the changelog entry, so write it for a reader, not
as a commit message. Commit the generated `.changeset/*.md` file alongside your code.

Changes that don't touch the published CLI (docs, internal refactors, `packages/core`-only
plumbing that doesn't change behavior) don't need one.

## Cutting a release

See the "Releasing" section in [CONTRIBUTING.md](../CONTRIBUTING.md).
