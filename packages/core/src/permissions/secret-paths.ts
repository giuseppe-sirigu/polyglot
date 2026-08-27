import { basename } from "node:path";
import { minimatch } from "minimatch";

/**
 * Files that typically hold credentials or private keys. Two uses:
 *   1. `glob`/`grep` skip them during ordinary exploration (so a broad search
 *      doesn't pull secrets into the model's context).
 *   2. `read_file`/`write_file`/`edit_file` against one prompts for approval in
 *      every permission mode (see permissions/policy.ts).
 * This is deliberately conservative - a false positive is one extra prompt, or a
 * file omitted from a listing that `read_file` can still fetch explicitly.
 */
export const SECRET_FILE_GLOBS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.pfx",
  "*.p12",
  "*.key",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".pgpass",
  ".htpasswd",
  "*.keystore",
  "*.jks",
  "credentials",
  "credentials.json",
];

/** Directory names that hold secrets wholesale - matched against any path segment. */
export const SECRET_DIR_NAMES = new Set([".ssh", ".aws", ".gnupg", ".gpg", "secrets"]);

/** minimatch patterns for glob's `ignore` option - the file globs plus the secret dirs. */
export const SECRET_IGNORE_GLOBS = [
  ...SECRET_FILE_GLOBS.map((g) => `**/${g}`),
  ...[...SECRET_DIR_NAMES].map((d) => `**/${d}/**`),
];

export function isSecretFilename(name: string): boolean {
  return SECRET_FILE_GLOBS.some((g) => minimatch(name, g, { dot: true, nocase: true }));
}

/** True if a resolved path is, or lives inside, something that typically holds secrets. */
export function matchesSecretPath(filePath: string): boolean {
  const segments = filePath.split(/[/\\]+/).filter(Boolean);
  if (segments.some((s) => SECRET_DIR_NAMES.has(s))) return true;
  return isSecretFilename(basename(filePath));
}
