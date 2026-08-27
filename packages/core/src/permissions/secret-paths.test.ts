import { describe, expect, it } from "vitest";
import { isSecretFilename, matchesSecretPath } from "./secret-paths.js";

describe("matchesSecretPath", () => {
  it.each([
    "/proj/.env",
    "/proj/.env.local",
    "/proj/.env.production",
    "/proj/config/id_rsa",
    "/proj/deploy/server.pem",
    "/proj/keystore.jks",
    "/home/u/.ssh/known_hosts",
    "/home/u/.aws/config",
    "/proj/secrets/token.txt",
    "/proj/.npmrc",
  ])("flags %s", (p) => {
    expect(matchesSecretPath(p)).toBe(true);
  });

  it.each([
    "/proj/README.md",
    "/proj/src/index.ts",
    "/proj/.envrc",
    "/proj/environment.ts",
    "/proj/package.json",
  ])("does not flag %s", (p) => {
    expect(matchesSecretPath(p)).toBe(false);
  });

  it("is case-insensitive on the filename", () => {
    expect(isSecretFilename("ID_RSA")).toBe(true);
    expect(isSecretFilename("Server.PEM")).toBe(true);
  });
});
