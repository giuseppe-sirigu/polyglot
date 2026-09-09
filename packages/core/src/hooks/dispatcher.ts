import { execFile } from "node:child_process";
import { minimatch } from "minimatch";

/**
 * User-defined shell commands that run at agent lifecycle points - `preToolUse` (allow or block
 * a tool call), `postToolUse` (inspect a result, optionally block it), and `userPromptSubmit`
 * (gate or augment a prompt). Configured under `hooks` in settings.json.
 *
 * Contract: the hook gets a JSON payload on stdin and `POLYGLOT_HOOK_EVENT` in its env.
 *   - exit 0  -> proceed. Optional stdout JSON `{ decision?, reason?, additionalContext? }`.
 *   - exit 2  -> block. Reason comes from stdout `reason`, else stdout JSON, else stderr.
 *   - other   -> non-blocking error; stderr is surfaced as a warning, the action proceeds.
 *   - timeout / spawn failure -> fail open (proceed) with a warning. A hook must never wedge
 *     the agent; policy that must fail closed belongs in a PermissionGate, not a shell hook.
 */

const IS_WINDOWS = process.platform === "win32";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 64_000;

export interface HookSpec {
  command: string;
  /** Glob-matched tool names this hook applies to (pre/postToolUse only). Empty / unset = all. */
  tools?: string[];
  timeoutMs?: number;
}

export interface ResolvedHooks {
  preToolUse: HookSpec[];
  postToolUse: HookSpec[];
  userPromptSubmit: HookSpec[];
}

export type HookEvent = "preToolUse" | "postToolUse" | "userPromptSubmit";

export interface HookOutcome {
  /** Set when a hook blocked the action; the string is fed back to the model (tool events) or
   * shown to the user (userPromptSubmit). */
  block?: string;
  /** Extra text a `userPromptSubmit` hook wants appended to the message. */
  additionalContext?: string;
}

export interface HookDispatcher {
  hasAny(event: HookEvent): boolean;
  preToolUse(toolName: string, input: unknown): Promise<HookOutcome>;
  postToolUse(
    toolName: string,
    input: unknown,
    resultText: string,
    isError: boolean,
  ): Promise<HookOutcome>;
  userPromptSubmit(prompt: string): Promise<HookOutcome>;
}

interface HookResult {
  decision?: "block";
  reason?: string;
  additionalContext?: string;
}

function matchesTool(spec: HookSpec, toolName: string): boolean {
  if (!spec.tools || spec.tools.length === 0) return true;
  return spec.tools.some((p) => minimatch(toolName, p));
}

function parseStdout(stdout: string): HookResult | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as HookResult) : null;
  } catch {
    return null;
  }
}

/** Runs one hook command to completion and maps its exit code / output to a HookOutcome. */
function runOne(
  spec: HookSpec,
  event: HookEvent,
  payload: unknown,
  cwd: string,
  onWarn: (msg: string) => void,
): Promise<HookOutcome> {
  return new Promise((resolve) => {
    const opts = {
      cwd,
      timeout: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env, POLYGLOT_HOOK_EVENT: event },
    } as const;
    const done = (err: (Error & { code?: number }) | null, stdout: string, stderr: string) => {
      const exitCode = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      const json = parseStdout(stdout);

      if (exitCode === 0) {
        if (json?.decision === "block") {
          resolve({ block: json.reason || `blocked by a ${event} hook` });
          return;
        }
        resolve(json?.additionalContext ? { additionalContext: json.additionalContext } : {});
        return;
      }
      if (exitCode === 2) {
        const reason =
          json?.reason || stdout.trim() || stderr.trim() || `blocked by a ${event} hook`;
        resolve({ block: reason });
        return;
      }
      // Any other failure (including a timeout, which arrives as an error with no code 2) is
      // non-blocking - the hook is broken, not saying "no".
      const detail = (stderr.trim() || err?.message || "non-zero exit").slice(0, 200);
      onWarn(`${event} hook exited ${exitCode}: ${detail}`);
      resolve({});
    };

    const child = IS_WINDOWS
      ? execFile("powershell.exe", ["-Command", spec.command], opts, (e, o, s) =>
          done(e as never, String(o), String(s)),
        )
      : execFile("/bin/bash", ["-c", spec.command], opts, (e, o, s) =>
          done(e as never, String(o), String(s)),
        );
    // A hook that never reads stdin (e.g. `exit 2`) closes it first; the write then EPIPEs,
    // which is harmless - swallow it.
    child.stdin?.on("error", () => {});
    child.stdin?.end(`${JSON.stringify(payload)}\n`);
  });
}

const NOOP: HookOutcome = {};

/**
 * Builds a dispatcher from resolved hook config. `onWarn` receives one-line messages for hook
 * failures (the frontends route these to the transcript / stderr). With no hooks configured for
 * an event, the corresponding method returns immediately without spawning anything.
 */
export function createHookDispatcher(
  hooks: ResolvedHooks,
  ctx: { cwd: string; onWarn?: (msg: string) => void },
): HookDispatcher {
  const warn = ctx.onWarn ?? (() => {});

  async function runChain(
    specs: HookSpec[],
    event: HookEvent,
    toolName: string | null,
    payload: unknown,
  ): Promise<HookOutcome> {
    let additionalContext = "";
    for (const spec of specs) {
      if (toolName !== null && !matchesTool(spec, toolName)) continue;
      const outcome = await runOne(spec, event, payload, ctx.cwd, warn);
      if (outcome.block !== undefined) return outcome;
      if (outcome.additionalContext) {
        additionalContext += (additionalContext ? "\n\n" : "") + outcome.additionalContext;
      }
    }
    return additionalContext ? { additionalContext } : NOOP;
  }

  return {
    hasAny: (event) => hooks[event].length > 0,
    preToolUse: (toolName, input) =>
      hooks.preToolUse.length === 0
        ? Promise.resolve(NOOP)
        : runChain(hooks.preToolUse, "preToolUse", toolName, {
            event: "preToolUse",
            cwd: ctx.cwd,
            toolName,
            toolInput: input,
          }),
    postToolUse: (toolName, input, resultText, isError) =>
      hooks.postToolUse.length === 0
        ? Promise.resolve(NOOP)
        : runChain(hooks.postToolUse, "postToolUse", toolName, {
            event: "postToolUse",
            cwd: ctx.cwd,
            toolName,
            toolInput: input,
            resultText,
            isError,
          }),
    userPromptSubmit: (prompt) =>
      hooks.userPromptSubmit.length === 0
        ? Promise.resolve(NOOP)
        : runChain(hooks.userPromptSubmit, "userPromptSubmit", null, {
            event: "userPromptSubmit",
            cwd: ctx.cwd,
            prompt,
          }),
  };
}
