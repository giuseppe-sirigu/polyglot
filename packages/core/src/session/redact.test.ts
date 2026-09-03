import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("leaves clean text untouched and reports zero", () => {
    const r = redactSecrets("just some normal prose about src/app.ts and a plan");
    expect(r.text).toBe("just some normal prose about src/app.ts and a plan");
    expect(r.count).toBe(0);
  });

  it("redacts an AWS access key id", () => {
    const r = redactSecrets("export AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF");
    expect(r.text).not.toContain("AKIA1234567890ABCDEF");
    expect(r.count).toBeGreaterThanOrEqual(1);
  });

  it("redacts an Anthropic and an OpenAI key", () => {
    const r = redactSecrets("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA then sk-abcdefghijklmnopqrstuvwx");
    expect(r.text).not.toContain("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA");
    expect(r.text).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(r.count).toBe(2);
  });

  it("redacts a GitHub token and a bearer token", () => {
    const r = redactSecrets(
      "ghp_0123456789abcdefghijABCDEFGHIJ and Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
    );
    expect(r.text).not.toMatch(/ghp_0123456789/);
    expect(r.text).not.toMatch(/Bearer abcdefghij/);
  });

  it("redacts a whole PEM private-key block", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nsecretbytes\n-----END RSA PRIVATE KEY-----";
    const r = redactSecrets(`here is a key:\n${pem}\nok`);
    expect(r.text).not.toContain("MIIEpAIBAAKCAQEA");
    expect(r.text).not.toContain("secretbytes");
    expect(r.text).toContain("[redacted:private-key]");
  });

  it("redacts a `key = value` assignment but keeps the key name", () => {
    const r = redactSecrets('database_password = "hunter2hunter2hunter2"');
    expect(r.text).toContain("password");
    expect(r.text).not.toContain("hunter2hunter2hunter2");
  });

  it("does not flag a short innocuous assignment", () => {
    expect(redactSecrets("token = 42").count).toBe(0);
  });

  it("is idempotent", () => {
    const once = redactSecrets("key=AKIA1234567890ABCDEF and sk-abcdefghijklmnopqrstuvwx").text;
    expect(redactSecrets(once).count).toBe(0);
  });
});
