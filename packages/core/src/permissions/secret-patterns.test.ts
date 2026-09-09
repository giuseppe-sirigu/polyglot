import { describe, expect, it } from "vitest";
import { scanContent } from "./secret-patterns.js";

describe("scanContent - secrets", () => {
  it("returns no findings and unchanged text for clean input", () => {
    const r = scanContent("just prose about src/app.ts", { redact: true });
    expect(r.findings).toEqual([]);
    expect(r.text).toBe("just prose about src/app.ts");
  });

  it("finds an AWS key, a GitHub token, and a bearer token", () => {
    const text =
      "AKIAIOSFODNN7EXAMPLE ghp_0123456789abcdefghijABCDEFGHIJ Authorization: Bearer abcdefghijklmnopqrstuvwxyz01";
    const labels = scanContent(text, { redact: false }).findings.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["aws-key", "github-token", "bearer-token"]));
  });

  it("warn mode leaves the text untouched", () => {
    const text = "key AKIAIOSFODNN7EXAMPLE";
    const r = scanContent(text, { redact: false });
    expect(r.text).toBe(text);
    expect(r.findings).toEqual([{ label: "aws-key", count: 1 }]);
  });

  it("redact mode replaces the match", () => {
    const r = scanContent("key AKIAIOSFODNN7EXAMPLE", { redact: true });
    expect(r.text).toBe("key [redacted:aws-key]");
  });

  it("counts multiple hits of one pattern", () => {
    const r = scanContent("AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPL2", { redact: false });
    expect(r.findings).toEqual([{ label: "aws-key", count: 2 }]);
  });

  it("keeps the key name on a `key = value` assignment", () => {
    const r = scanContent('api_key = "abcdefghijklmnop"', { redact: true });
    expect(r.text).toContain("api_key");
    expect(r.text).not.toContain("abcdefghijklmnop");
  });

  it("does not flag a short innocuous assignment", () => {
    expect(scanContent("count = 42", { redact: false }).findings).toEqual([]);
  });
});

describe("scanContent - PII (opt-in)", () => {
  const withCard = "card 4242424242424242 here"; // a valid Luhn test number
  const withBadCard = "id 4242424242424241 here"; // same but last digit changed - fails Luhn

  it("ignores PII patterns unless pii is set", () => {
    expect(scanContent("email me at a@b.com", { redact: false }).findings).toEqual([]);
    expect(scanContent(withCard, { redact: false }).findings).toEqual([]);
  });

  it("flags email and a Luhn-valid card when pii is on", () => {
    const r = scanContent(`a@b.com ${withCard}`, { redact: false, pii: true });
    const labels = r.findings.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["email", "credit-card"]));
  });

  it("does not flag a number that fails the Luhn check", () => {
    const labels = scanContent(withBadCard, { redact: false, pii: true }).findings.map(
      (f) => f.label,
    );
    expect(labels).not.toContain("credit-card");
  });

  it("flags a US SSN but not a plain 9-digit run", () => {
    expect(
      scanContent("ssn 123-45-6789", { redact: false, pii: true }).findings.map((f) => f.label),
    ).toContain("ssn");
    expect(
      scanContent("order 123456789 shipped", { redact: false, pii: true }).findings.map(
        (f) => f.label,
      ),
    ).not.toContain("ssn");
  });
});

describe("scanContent - extra patterns", () => {
  it("applies caller-supplied patterns", () => {
    const r = scanContent("internal token XZ-9999", {
      redact: true,
      extra: [{ label: "internal-id", re: /\bXZ-\d{4}\b/g }],
    });
    expect(r.text).toBe("internal token [redacted:internal-id]");
    expect(r.findings).toEqual([{ label: "internal-id", count: 1 }]);
  });
});
