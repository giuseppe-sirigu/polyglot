import { describe, expect, it } from "vitest";
import { type AtCandidate, findMentionQuery, rankMentions } from "./atMentions.js";

describe("findMentionQuery", () => {
  const q = (text: string, cursor = text.length) => findMentionQuery(text, cursor);

  it("finds a bare @ just typed", () => {
    expect(q("look at @")).toEqual({ query: "", start: 8 });
  });

  it("finds a partial token", () => {
    expect(q("@src/ap")).toEqual({ query: "src/ap", start: 0 });
    expect(q("explain @todo.mjs")).toEqual({ query: "todo.mjs", start: 8 });
  });

  it("respects the cursor position (mid-word)", () => {
    expect(findMentionQuery("@abcdef", 4)).toEqual({ query: "abc", start: 0 });
  });

  it("returns null when a space intervenes", () => {
    expect(q("@src/app.ts and")).toBeNull();
    expect(q("@foo bar")).toBeNull();
  });

  it("does not trigger on an @ mid-word (email-ish)", () => {
    expect(q("mail me at foo@bar.com")).toBeNull();
  });

  it("works on a later line", () => {
    expect(q("first line\n@second")).toEqual({ query: "second", start: 11 });
  });

  it("returns null with no @", () => {
    expect(q("just some text")).toBeNull();
  });
});

const files: AtCandidate[] = [
  "src/app.ts",
  "src/apple/index.ts",
  "src/agent/loop.ts",
  "README.md",
  "packages/core/src/app.ts",
].map((p) => ({ kind: "file", value: p, label: p }));

describe("rankMentions", () => {
  it("returns everything (up to the limit) for an empty query", () => {
    expect(rankMentions("", files)).toHaveLength(files.length);
  });

  it("ranks exact and prefix matches first", () => {
    const r = rankMentions("src/app.ts", files).map((c) => c.value);
    expect(r[0]).toBe("src/app.ts");
  });

  it("matches a last-path-segment prefix", () => {
    const r = rankMentions("app.ts", files).map((c) => c.value);
    expect(r).toContain("src/app.ts");
    expect(r).toContain("packages/core/src/app.ts");
  });

  it("matches an ordered subsequence", () => {
    const r = rankMentions("sagl", files).map((c) => c.value);
    expect(r).toContain("src/agent/loop.ts");
  });

  it("drops non-matches", () => {
    expect(rankMentions("zzz", files)).toEqual([]);
  });

  it("honours the limit", () => {
    expect(rankMentions("", files, 2)).toHaveLength(2);
  });

  it("breaks ties by shorter label", () => {
    const r = rankMentions("src/app", files).map((c) => c.value);
    expect(r.indexOf("src/app.ts")).toBeLessThan(r.indexOf("packages/core/src/app.ts"));
  });
});
