import type { DiffPreview, PermissionCategory } from "../tools/types.js";

export interface PermissionRequest {
  toolName: string;
  category: PermissionCategory;
  input: unknown;
  cwd: string;
  /** Extra context surfaced to the user alongside the prompt (e.g. why approval is being
   * asked for even though the current mode wouldn't normally ask). */
  note?: string;
  /** Lazy - only called if a prompt is actually shown, so paths that never reach an
   * interactive prompt (auto mode, an allow rule) never pay for the read. */
  loadDiff?: () => Promise<DiffPreview | null>;
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
