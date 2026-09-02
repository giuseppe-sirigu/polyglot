---
"@usepolyglot/cli": patch
---

The background auto-updater no longer dumps the package manager's raw error output when it can't update. A registry propagation lag (the `latest` tag moved but the tarball isn't on the CDN yet - common in the minutes after a release) or a missing network connection now shows a single calm line ("polyglot will retry on the next start") instead of a red `npm error ETARGET` block. Only a genuine failure (e.g. a permissions error) shows a warning, with just the manual update command.
