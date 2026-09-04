import { describe, expect, it } from "vitest";
import { type ToolDefinition, ToolRegistry, textResult } from "./types.js";

function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    permission: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return textResult("");
    },
  };
}

describe("ToolRegistry.subset", () => {
  it("keeps the named tools and drops unknown names", () => {
    const reg = new ToolRegistry();
    reg.register(stubTool("read_file"));
    reg.register(stubTool("grep"));
    reg.register(stubTool("bash"));

    const sub = reg.subset(["read_file", "grep", "does_not_exist"]);
    expect(sub.names().sort()).toEqual(["grep", "read_file"]);
    expect(sub.get("bash")).toBeUndefined();
  });

  it("returns an empty registry when no names match", () => {
    const reg = new ToolRegistry();
    reg.register(stubTool("read_file"));
    expect(reg.subset(["nope"]).names()).toEqual([]);
  });

  it("does not mutate the source registry", () => {
    const reg = new ToolRegistry();
    reg.register(stubTool("read_file"));
    reg.register(stubTool("bash"));
    reg.subset(["read_file"]);
    expect(reg.names().sort()).toEqual(["bash", "read_file"]);
  });
});
