import { describe, expect, it } from "vitest";
import { classifyUpdateFailure, detectPackageManager, runSelfUpdate } from "./self-update.js";

describe("classifyUpdateFailure", () => {
  it("flags registry propagation lag as retriable", () => {
    const npmEtarget =
      "Command failed: npm install -g @usepolyglot/cli@latest\n" +
      "npm error code ETARGET\n" +
      "npm error notarget No matching version found for @usepolyglot/cli@0.4.4.";
    expect(classifyUpdateFailure(npmEtarget)).toBe("registry-lag");
    expect(classifyUpdateFailure("No matching version found for pkg@1.2.3")).toBe("registry-lag");
  });

  it("flags network failures as retriable", () => {
    expect(classifyUpdateFailure("getaddrinfo ENOTFOUND registry.npmjs.org")).toBe("offline");
    expect(
      classifyUpdateFailure("request to https://registry.npmjs.org failed, reason: ETIMEDOUT"),
    ).toBe("offline");
  });

  it("treats anything else as a real failure", () => {
    expect(classifyUpdateFailure("EACCES: permission denied, mkdir '/usr/lib/node_modules'")).toBe(
      "other",
    );
    expect(classifyUpdateFailure("Command failed with exit code 1")).toBe("other");
  });
});

describe("detectPackageManager", () => {
  it("infers the manager from the resolved script path", () => {
    expect(detectPackageManager("/home/u/.local/share/pnpm/global/5/.pnpm/x/node_modules/x")).toBe(
      "pnpm",
    );
    expect(detectPackageManager("/home/u/.bun/bin/polyglot")).toBe("bun");
    expect(detectPackageManager("/usr/local/lib/node_modules/@usepolyglot/cli/dist/main.js")).toBe(
      "npm",
    );
  });
});

describe("runSelfUpdate", () => {
  it("refuses a package name that isn't one word", async () => {
    const r = await runSelfUpdate("@usepolyglot/cli; rm -rf ~");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Not a valid package name");
  });
});
