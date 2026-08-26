import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PermissionDecision, PermissionGate, PermissionRequest } from "./gate.js";
import { matchesAny } from "./rule-matcher.js";

/** True if a tool's `path` argument, once resolved against cwd, points outside cwd. Tools
 * without a string `path` field (bash, web_fetch, glob's pattern) are left alone — this is
 * scoped to the file-path tools (read/write/edit/grep) that take an explicit target path. */
function targetsOutsideCwd(request: PermissionRequest): boolean {
  const input = request.input as Record<string, unknown> | undefined;
  const path = input && typeof input.path === "string" ? input.path : null;
  if (!path) return false;

  const target = isAbsolute(path) ? path : resolve(request.cwd, path);
  const rel = relative(request.cwd, target);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export type PermissionMode = "manual" | "auto" | "plan";
export type ApprovalResponse = "allow_once" | "allow_always" | "deny";

export interface PolicyGateOptions {
  mode: PermissionMode;
  allow?: string[];
  deny?: string[];
  /** Required in "manual" mode for any request not already covered by an allow/deny rule. */
  onAskUser?: (request: PermissionRequest) => Promise<ApprovalResponse>;
}

/**
 * The real permission gate: manual (ask before any change — write/execute/network — with an
 * "always allow this tool for the rest of the session" shortcut; reads are never asked about),
 * auto (allow unless deny-listed), and plan (read-only, hard override regardless of allow
 * rules). A target outside the working directory always asks, in every mode, regardless of
 * category.
 */
export class PolicyGate implements PermissionGate {
  private mode: PermissionMode;
  private readonly allow: string[];
  private readonly deny: string[];
  private readonly onAskUser?: (request: PermissionRequest) => Promise<ApprovalResponse>;
  private readonly sessionAllowRules: string[] = [];

  constructor(opts: PolicyGateOptions) {
    this.mode = opts.mode;
    this.allow = opts.allow ?? [];
    this.deny = opts.deny ?? [];
    this.onAskUser = opts.onAskUser;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  /** Transitions out of (or into) plan mode — used once a proposed plan is approved. */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  async evaluate(request: PermissionRequest): Promise<PermissionDecision> {
    if (matchesAny(this.deny, request)) {
      return { decision: "deny", reason: "blocked by a deny rule" };
    }

    if (this.mode === "plan" && request.category !== "read") {
      return {
        decision: "deny",
        reason: "plan mode only allows read-only tools until a plan is approved",
      };
    }

    if (matchesAny(this.allow, request) || matchesAny(this.sessionAllowRules, request)) {
      return { decision: "allow" };
    }

    // A target outside the working directory always needs a human's eyes on it, even in auto
    // or plan mode, since none of the usual rule/mode-based fast paths were written with
    // "reaching outside the project" in mind.
    if (targetsOutsideCwd(request)) {
      if (!this.onAskUser) {
        return {
          decision: "deny",
          reason: "target is outside the working directory and no interactive prompt is configured",
        };
      }
      return this.askUser(
        request,
        `${request.toolName} targets a path outside the working directory (${request.cwd}).`,
      );
    }

    // Read-only tools within the working directory never need a prompt, in any mode — manual
    // mode is about gating changes (writes/execute/network), not gating looking around.
    if (request.category === "read") {
      return { decision: "allow" };
    }

    if (this.mode === "auto" || this.mode === "plan") {
      return { decision: "allow" };
    }

    if (!this.onAskUser) {
      return {
        decision: "deny",
        reason: "manual approval mode has no interactive prompt configured",
      };
    }

    return this.askUser(request);
  }

  private async askUser(request: PermissionRequest, note?: string): Promise<PermissionDecision> {
    const response = await this.onAskUser?.(note ? { ...request, note } : request);
    if (response === "deny" || response === undefined) {
      return { decision: "deny", reason: "declined by the user" };
    }
    if (response === "allow_always") {
      this.sessionAllowRules.push(request.toolName);
    }
    return { decision: "allow" };
  }
}
