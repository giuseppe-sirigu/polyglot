import { exec, execFile } from "node:child_process";
import { type ToolDefinition, textResult } from "./types.js";

const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 120_000;

const IS_WINDOWS = process.platform === "win32";

interface BashInput {
  command: string;
}

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = output.slice(0, MAX_OUTPUT_CHARS / 2);
  const tail = output.slice(-MAX_OUTPUT_CHARS / 2);
  return `${head}\n\n[... output truncated, ${output.length - MAX_OUTPUT_CHARS} chars omitted ...]\n\n${tail}`;
}

export const bashTool: ToolDefinition<BashInput> = {
  name: "bash",
  description: IS_WINDOWS
    ? "Run a shell command in the working directory (via PowerShell on this Windows machine) and return its stdout/stderr."
    : "Run a shell command in the working directory and return its stdout/stderr.",
  permission: "execute",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    return new Promise((resolve) => {
      const opts = {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      } as const;
      const onDone = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const out = [stdout, stderr].map(String).filter(Boolean).join("\n");
        if (error) {
          resolve(textResult(truncate(out || error.message), false));
        } else {
          resolve(textResult(truncate(out || "(no output)")));
        }
      };
      // On POSIX, run through bash with `pipefail` so a failed stage in a pipeline
      // (`missing-cmd | wc -l`) makes the whole command non-zero and is reported as an error,
      // instead of the last stage's exit 0 masking it. Cost: `grep x f | head` now "fails"
      // when grep matches nothing or head closes the pipe early (SIGPIPE). PowerShell on
      // Windows supports POSIX-like aliases (ls/cat/rm/…) so habit commands still work.
      const child = IS_WINDOWS
        ? exec(input.command, { ...opts, shell: "powershell.exe" }, onDone)
        : execFile("/bin/bash", ["-o", "pipefail", "-c", input.command], opts, onDone);
      // Commands run here are never interactive - close stdin immediately so a script that
      // blocks on input (e.g. a model-generated `read -p ...`) gets EOF right away instead of
      // hanging forever on a pipe nobody will ever write to.
      child.stdin?.end();
    });
  },
};
