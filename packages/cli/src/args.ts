export type OutputFormat = "text" | "json";
export type PermissionModeArg = "manual" | "auto" | "plan";

export interface CliArgs {
  help: boolean;
  version: boolean;
  /** `polyglot init`: run the interactive setup wizard and exit. */
  init: boolean;
  /** -p / --print: run one prompt headlessly and exit instead of starting the TUI. */
  print: boolean;
  /** Positional args joined by a space. Undefined in print mode means "read stdin". */
  prompt?: string;
  /** Print mode only. */
  outputFormat: OutputFormat;
  /** Print mode only: run every tool without prompting (there is no TTY to prompt on). */
  allowAll: boolean;
  /** Print mode only: overrides the permission mode from config for this run. */
  permissionMode?: PermissionModeArg;
  /** Forces persistTranscripts off for this run (interactive or print). */
  noPersist: boolean;
  /** --resume was passed. */
  resume: boolean;
  /** The token following --resume: a session id, or a path to a `.jsonl` session file. */
  resumeId?: string;
  /** --probe: force a fresh capability probe of the endpoint on startup (openai-compatible). */
  probe: boolean;
  /** `polyglot share`/`export`: write a shareable transcript and exit. */
  share: boolean;
  /** Session id or `.jsonl`/path to export; undefined = most recent. */
  shareTarget?: string;
  /** Output path for the export (default `./polyglot-session-<date>.<ext>`). */
  shareOut?: string;
  /** Export format. */
  shareFormat: "md" | "html";
  /** Redact secret-looking values (default true; `--no-redact` turns it off). */
  shareRedact: boolean;
  /** Include full tool-call args and result bodies (default one-line summaries). */
  shareFull: boolean;
}

export const HELP_TEXT = `polyglot - a model-agnostic coding-agent CLI

Usage:
  polyglot [options]                 start the interactive TUI
  polyglot init                      interactive first-run setup (writes ~/.polyglot/settings.json)
  polyglot share [id|path] [opts]    export a session transcript to a file
  polyglot -p "<prompt>" [options]   run one prompt, print the answer, exit
  echo "<prompt>" | polyglot -p      read the prompt from stdin

Options:
  -p, --print                  non-interactive: run a single prompt and exit
      --output-format <fmt>     print-mode output: "text" (default) or "json"
      --allow-all               print-mode: run every tool without prompting
      --permission-mode <mode>  print-mode: "manual", "auto", or "plan"
      --no-persist              write nothing to ~/.polyglot/ (ephemeral session)
      --resume [id|path]        resume the most recent session, one by id, or a .jsonl file
      --probe                   ping the endpoint to detect its real capabilities
  -v, --version                print the version and exit
  -h, --help                   print this help and exit

share options:
      --out <path>              output file (default ./polyglot-session-<date>.<ext>)
      --format <md|html>        output format (default md)
      --no-redact               do not scrub secret-looking values (default: scrub)
      --full                    include full tool-call args and result bodies

In print mode the session id is written to stderr (and included in the JSON
envelope) so it can be chained with --resume.`;

const OUTPUT_FORMATS: OutputFormat[] = ["text", "json"];
const PERMISSION_MODES: PermissionModeArg[] = ["manual", "auto", "plan"];

/** Parses argv (already sliced past `node script`). Throws on malformed flag values. */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    version: false,
    init: false,
    print: false,
    outputFormat: "text",
    allowAll: false,
    noPersist: false,
    resume: false,
    probe: false,
    share: false,
    shareFormat: "md",
    shareRedact: true,
    shareFull: false,
  };
  const positional: string[] = [];

  // `init` is a subcommand, only recognised as the very first token.
  if (argv[0] === "init") {
    args.init = true;
    return args;
  }

  // `share` / `export` subcommand: `polyglot share [id|path] [--out F] [--format md|html] [--no-redact] [--full]`
  if (argv[0] === "share" || argv[0] === "export") {
    args.share = true;
    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i] as string;
      if (arg === "--out") args.shareOut = argv[++i];
      else if (arg === "--format") {
        const v = argv[++i];
        if (v !== "md" && v !== "html") throw new Error("--format must be md or html");
        args.shareFormat = v;
      } else if (arg === "--no-redact") args.shareRedact = false;
      else if (arg === "--full") args.shareFull = true;
      else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
      else args.shareTarget = arg;
    }
    return args;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      case "-p":
      case "--print":
        args.print = true;
        break;
      case "--allow-all":
        args.allowAll = true;
        break;
      case "--no-persist":
        args.noPersist = true;
        break;
      case "--probe":
        args.probe = true;
        break;
      case "--output-format": {
        const value = argv[++i];
        if (!value || !OUTPUT_FORMATS.includes(value as OutputFormat)) {
          throw new Error(`--output-format must be one of: ${OUTPUT_FORMATS.join(", ")}`);
        }
        args.outputFormat = value as OutputFormat;
        break;
      }
      case "--permission-mode": {
        const value = argv[++i];
        if (!value || !PERMISSION_MODES.includes(value as PermissionModeArg)) {
          throw new Error(`--permission-mode must be one of: ${PERMISSION_MODES.join(", ")}`);
        }
        args.permissionMode = value as PermissionModeArg;
        break;
      }
      case "--resume": {
        args.resume = true;
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          args.resumeId = next;
          i++;
        }
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  if (positional.length > 0) {
    args.prompt = positional.join(" ");
  }

  return args;
}
