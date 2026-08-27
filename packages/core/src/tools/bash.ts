import { exec } from "node:child_process";
import { type ToolDefinition, textResult } from "./types.js";

const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 120_000;

const IS_WINDOWS = process.platform === "win32";
/** PowerShell (not cmd.exe) on Windows — it supports many POSIX-like aliases
 * (ls, cat, cp, rm, pwd, ...) so commands a model writes out of habit are far
 * more likely to still work than they would under cmd.exe. */
const SHELL = IS_WINDOWS ? "powershell.exe" : "/bin/bash";

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
      const child = exec(
        input.command,
        {
          cwd: ctx.cwd,
          signal: ctx.signal,
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          shell: SHELL,
        },
        (error, stdout, stderr) => {
          if (error) {
            const combined = [stdout, stderr].filter(Boolean).join("\n") || error.message;
            resolve(textResult(truncate(combined), false));
          } else {
            const combined = [stdout, stderr].filter(Boolean).join("\n");
            resolve(textResult(truncate(combined || "(no output)")));
          }
        },
      );
      // Commands run here are never interactive — close stdin immediately so a script that
      // blocks on input (e.g. a model-generated `read -p ...`) gets EOF right away instead of
      // hanging forever on a pipe nobody will ever write to.
      child.stdin?.end();
    });
  },
};
