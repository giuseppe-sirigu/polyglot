import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.js";

describe("parseCliArgs", () => {
  it("defaults to interactive mode with no args", () => {
    const args = parseCliArgs([]);
    expect(args).toMatchObject({
      print: false,
      help: false,
      version: false,
      init: false,
      resume: false,
      outputFormat: "text",
      allowAll: false,
    });
    expect(args.prompt).toBeUndefined();
  });

  it("recognises the `init` subcommand only as the first token", () => {
    expect(parseCliArgs(["init"]).init).toBe(true);
    // not a subcommand mid-args - falls through to prompt text
    expect(parseCliArgs(["-p", "init"]).init).toBe(false);
    expect(parseCliArgs(["-p", "init"]).prompt).toBe("init");
  });

  it("parses -p with a quoted prompt", () => {
    const args = parseCliArgs(["-p", "hello world"]);
    expect(args.print).toBe(true);
    expect(args.prompt).toBe("hello world");
  });

  it("joins multi-token positional prompts", () => {
    const args = parseCliArgs(["--print", "list", "the", "files"]);
    expect(args.prompt).toBe("list the files");
  });

  it("leaves prompt undefined when -p has no positional args (stdin)", () => {
    const args = parseCliArgs(["-p"]);
    expect(args.print).toBe(true);
    expect(args.prompt).toBeUndefined();
  });

  it("parses --output-format json", () => {
    expect(parseCliArgs(["-p", "--output-format", "json", "hi"]).outputFormat).toBe("json");
  });

  it("throws on an invalid --output-format value", () => {
    expect(() => parseCliArgs(["-p", "--output-format", "yaml"])).toThrow(/output-format/);
  });

  it("throws when --output-format has no value", () => {
    expect(() => parseCliArgs(["-p", "--output-format"])).toThrow(/output-format/);
  });

  it("parses --allow-all and --permission-mode", () => {
    const args = parseCliArgs(["-p", "--allow-all", "--permission-mode", "auto", "go"]);
    expect(args.allowAll).toBe(true);
    expect(args.permissionMode).toBe("auto");
  });

  it("parses --no-persist", () => {
    expect(parseCliArgs([]).noPersist).toBe(false);
    expect(parseCliArgs(["--no-persist"]).noPersist).toBe(true);
    expect(parseCliArgs(["-p", "--no-persist", "hi"]).noPersist).toBe(true);
  });

  it("parses --probe", () => {
    expect(parseCliArgs([]).probe).toBe(false);
    expect(parseCliArgs(["--probe"]).probe).toBe(true);
  });

  it("throws on an invalid --permission-mode value", () => {
    expect(() => parseCliArgs(["-p", "--permission-mode", "yolo"])).toThrow(/permission-mode/);
  });

  it("parses --resume with no id", () => {
    const args = parseCliArgs(["--resume"]);
    expect(args.resume).toBe(true);
    expect(args.resumeId).toBeUndefined();
  });

  it("parses --resume with an explicit id", () => {
    const args = parseCliArgs(["--resume", "abc123"]);
    expect(args.resume).toBe(true);
    expect(args.resumeId).toBe("abc123");
  });

  it("does not consume a following flag as the resume id", () => {
    const args = parseCliArgs(["--resume", "-p", "continue"]);
    expect(args.resume).toBe(true);
    expect(args.resumeId).toBeUndefined();
    expect(args.print).toBe(true);
    expect(args.prompt).toBe("continue");
  });

  it("keeps a --resume path token verbatim", () => {
    expect(parseCliArgs(["--resume", "./x.jsonl"]).resumeId).toBe("./x.jsonl");
    expect(parseCliArgs(["--resume", "/abs/y.jsonl"]).resumeId).toBe("/abs/y.jsonl");
  });

  describe("share subcommand", () => {
    it("recognises `share` and `export` only as the first token", () => {
      expect(parseCliArgs(["share"]).share).toBe(true);
      expect(parseCliArgs(["export"]).share).toBe(true);
      expect(parseCliArgs(["-p", "share"]).share).toBe(false);
    });

    it("parses the target, --out, --format, --no-redact and --full", () => {
      const args = parseCliArgs([
        "share",
        "abc123",
        "--out",
        "/tmp/s.html",
        "--format",
        "html",
        "--no-redact",
        "--full",
      ]);
      expect(args).toMatchObject({
        share: true,
        shareTarget: "abc123",
        shareOut: "/tmp/s.html",
        shareFormat: "html",
        shareRedact: false,
        shareFull: true,
      });
    });

    it("defaults to md, redacted, summarised", () => {
      const args = parseCliArgs(["share"]);
      expect(args).toMatchObject({ shareFormat: "md", shareRedact: true, shareFull: false });
      expect(args.shareTarget).toBeUndefined();
    });

    it("rejects a bad --format", () => {
      expect(() => parseCliArgs(["share", "--format", "pdf"])).toThrow(/--format/);
    });
  });

  it("parses --help and --version", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
    expect(parseCliArgs(["--version"]).version).toBe(true);
    expect(parseCliArgs(["-v"]).version).toBe(true);
  });

  it("throws on an unknown option", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(/Unknown option/);
  });
});
