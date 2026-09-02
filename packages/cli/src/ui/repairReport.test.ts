import { describe, expect, it } from "vitest";
import { formatRepairReport } from "./repairReport.js";
import type { DisplayItem } from "./types.js";

type Call = Extract<DisplayItem, { kind: "tool_call" }>;

const call = (over: Partial<Call> = {}): Call => ({
  kind: "tool_call",
  id: "1",
  name: "edit_file",
  input: { path: "todo.mjs", old_string: "a", new_string: "b" },
  repaired: true,
  rawCall: '<tool_call name="edit_file">\n{"path":"todo.mjs", broken}\n</tool_call>',
  ...over,
});

describe("formatRepairReport", () => {
  it("says so when nothing needed repair", () => {
    expect(formatRepairReport([])).toMatch(/every call parsed cleanly/);
  });

  it("shows the raw block and the resolved call for each repair", () => {
    const out = formatRepairReport([call()]);
    expect(out).toMatch(/1 tool call needed repair/);
    expect(out).toContain("edit_file");
    expect(out).toContain('{"path":"todo.mjs", broken}');
  });

  it("notes a corrected tool name", () => {
    const out = formatRepairReport([call({ correctedFromName: "edit_fil" })]);
    expect(out).toMatch(/corrected from "edit_fil"/);
  });

  it("caps the number shown and says how many were omitted", () => {
    const many = Array.from({ length: 12 }, (_, i) => call({ id: String(i) }));
    const out = formatRepairReport(many, 5);
    expect(out).toMatch(/12 tool calls needed repair/);
    expect(out).toMatch(/showing the last 5/);
  });
});
