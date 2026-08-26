import type { PermissionDecision, PermissionGate, PermissionRequest } from "./gate.js";
import { matchesAny } from "./rule-matcher.js";

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
 * The real permission gate: manual (ask, with an "always allow this tool for the
 * rest of the session" shortcut), auto (allow unless deny-listed), and plan
 * (read-only, hard override regardless of allow rules).
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

    if (this.mode === "auto" || this.mode === "plan") {
      return { decision: "allow" };
    }

    if (!this.onAskUser) {
      return {
        decision: "deny",
        reason: "manual approval mode has no interactive prompt configured",
      };
    }

    const response = await this.onAskUser(request);
    if (response === "deny") {
      return { decision: "deny", reason: "declined by the user" };
    }
    if (response === "allow_always") {
      this.sessionAllowRules.push(request.toolName);
    }
    return { decision: "allow" };
  }
}
