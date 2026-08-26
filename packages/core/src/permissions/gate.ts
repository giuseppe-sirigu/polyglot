import type { PermissionCategory } from "../tools/types.js";

export interface PermissionRequest {
  toolName: string;
  category: PermissionCategory;
  input: unknown;
}

export interface PermissionDecision {
  decision: "allow" | "deny";
  reason?: string;
}

export interface PermissionGate {
  evaluate(request: PermissionRequest): Promise<PermissionDecision>;
}

/** Allows every tool call. Used as the Phase 2 default; real allow/deny-list and
 * interactive-approval gates are layered on top of this interface in a later phase. */
export class AllowAllGate implements PermissionGate {
  async evaluate(): Promise<PermissionDecision> {
    return { decision: "allow" };
  }
}
