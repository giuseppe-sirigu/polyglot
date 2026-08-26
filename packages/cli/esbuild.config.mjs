import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const corePkg = JSON.parse(readFileSync(new URL("../core/package.json", import.meta.url), "utf8"));

// Bundle first-party workspace code (@polyglot/core's source) into one file, but
// leave every real npm package external — including @polyglot/core's own runtime
// dependencies, which get pulled in transitively when its source is bundled — so
// npm's own resolution installs them normally instead of esbuild trying to inline
// CJS packages that don't tolerate that (native requires, etc). This means every
// one of these must also be a real dependency in this package's package.json.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(corePkg.dependencies ?? {}),
].filter((name) => name !== "@polyglot/core");

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __PACKAGE_NAME__: JSON.stringify("polyglot-agent"),
  },
  logLevel: "info",
});
