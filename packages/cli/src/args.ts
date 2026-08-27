export type OutputFormat = "text" | "json";
export type PermissionModeArg = "manual" | "auto" | "plan";

export interface CliArgs {
  help: boolean;
  version: boolean;
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
  /** The session id token following --resume, when present. */
  resumeId?: string;
}

export const HELP_TEXT = `polyglot - a model-agnostic coding-agent CLI

Usage:
  polyglot [options]                 start the interactive TUI
  polyglot -p "<prompt>" [options]   run one prompt, print the answer, exit
  echo "<prompt>" | polyglot -p      read the prompt from stdin

Options:
  -p, --print                  non-interactive: run a single prompt and exit
      --output-format <fmt>     print-mode output: "text" (default) or "json"
      --allow-all               print-mode: run every tool without prompting
      --permission-mode <mode>  print-mode: "manual", "auto", or "plan"
      --no-persist              write nothing to ~/.polyglot/ (ephemeral session)
      --resume [session-id]     resume the most recent session, or one by id
  -v, --version                print the version and exit
  -h, --help                   print this help and exit

In print mode the session id is written to stderr (and included in the JSON
envelope) so it can be chained with --resume.`;

const OUTPUT_FORMATS: OutputFormat[] = ["text", "json"];
const PERMISSION_MODES: PermissionModeArg[] = ["manual", "auto", "plan"];

/** Parses argv (already sliced past `node script`). Throws on malformed flag values. */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    version: false,
    print: false,
    outputFormat: "text",
    allowAll: false,
    noPersist: false,
    resume: false,
  };
  const positional: string[] = [];

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
