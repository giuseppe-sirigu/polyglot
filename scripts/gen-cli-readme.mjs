// Generates packages/cli/README.md from the repo-root README.md, rewriting
// repo-relative links and images to absolute GitHub URLs so they resolve on
// npmjs.com. Run automatically by @usepolyglot/cli's `prepack` (so `pnpm pack`
// and `npm publish` always ship an up-to-date copy); the generated file is
// git-ignored - the root README is the single source of truth.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const sourcePath = fileURLToPath(new URL("README.md", repoRoot));
const targetPath = fileURLToPath(new URL("packages/cli/README.md", repoRoot));

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("packages/cli/package.json", repoRoot)), "utf8"),
);

// "git+https://github.com/owner/repo.git" -> "owner/repo"
const slug = pkg.repository.url
  .replace(/^git\+/, "")
  .replace(/\.git$/, "")
  .replace(/^https?:\/\/github\.com\//, "");
const branch = "main";

const blobBase = `https://github.com/${slug}/blob/${branch}/`;
const rawBase = `https://raw.githubusercontent.com/${slug}/${branch}/`;

const isAbsolute = (url) =>
  /^(https?:)?\/\//.test(url) || url.startsWith("#") || url.startsWith("mailto:");

const toAbsolute = (path, { raw }) => {
  if (isAbsolute(path)) return path;
  return (raw ? rawBase : blobBase) + path.replace(/^\.?\//, "");
};

const source = readFileSync(sourcePath, "utf8");

const rewritten = source
  // HTML: <img src="...">  ->  raw.githubusercontent.com
  .replace(
    /(\ssrc=")([^"]+)(")/g,
    (_m, pre, url, post) => pre + toAbsolute(url, { raw: true }) + post,
  )
  // HTML: href="..."  ->  github.com/blob
  .replace(
    /(\shref=")([^"]+)(")/g,
    (_m, pre, url, post) => pre + toAbsolute(url, { raw: false }) + post,
  )
  // Markdown images: ![alt](path)  ->  raw
  .replace(
    /(!\[[^\]]*\]\()([^)]+)(\))/g,
    (_m, pre, url, post) => pre + toAbsolute(url, { raw: true }) + post,
  )
  // Markdown links: [text](path)  ->  blob
  .replace(
    /(\[[^\]]*\]\()([^)]+)(\))/g,
    (_m, pre, url, post) => pre + toAbsolute(url, { raw: false }) + post,
  );

const header =
  "<!-- Generated from the repo-root README.md by scripts/gen-cli-readme.mjs. Do not edit. -->\n\n";

writeFileSync(targetPath, header + rewritten);
console.log(`Wrote ${targetPath} from ${sourcePath}`);
