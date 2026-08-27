import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, matchSlashCommands } from "./slashCommands.js";

describe("matchSlashCommands", () => {
  it("returns nothing when the value doesn't start with /", () => {
    expect(matchSlashCommands("hello")).toEqual([]);
    expect(matchSlashCommands("")).toEqual([]);
  });

  it("lists every command right after typing a bare /", () => {
    expect(matchSlashCommands("/")).toEqual(SLASH_COMMANDS);
  });

  it("narrows by prefix as more is typed", () => {
    expect(matchSlashCommands("/mo").map((c) => c.command)).toEqual(["/model"]);
  });

  it("is case-insensitive", () => {
    expect(matchSlashCommands("/MO").map((c) => c.command)).toEqual(["/model"]);
  });

  it("returns nothing once a space is typed (moved on to an argument)", () => {
    expect(matchSlashCommands("/model ")).toEqual([]);
    expect(matchSlashCommands("/model qwen3")).toEqual([]);
  });

  it("returns nothing once a newline is typed", () => {
    expect(matchSlashCommands("/model\nqwen3")).toEqual([]);
  });

  it("returns nothing when nothing matches the prefix", () => {
    expect(matchSlashCommands("/zzz")).toEqual([]);
  });
});
