import type { PolicyGate } from "../permissions/policy.js";
import { persistPlan } from "../plans/store.js";
import { type ToolDefinition, textResult } from "./types.js";

interface ExitPlanModeInput {
  plan: string;
}

/**
 * Lets the model signal "I'm done exploring, here's my plan" from inside plan
 * mode. Presents the plan to the user via `onApprove`; if approved, flips the
 * gate out of plan mode so subsequent write/execute/network tool calls in the
 * same session are no longer hard-denied.
 */
export function createExitPlanModeTool(
  gate: PolicyGate,
  onApprove: (plan: string) => Promise<boolean>,
  resumeMode: "manual" | "auto" = "manual",
  persist = true,
): ToolDefinition<ExitPlanModeInput> {
  return {
    name: "exit_plan_mode",
    description:
      "Call this when you've finished read-only exploration and are ready to present your plan " +
      "for approval before making any changes. Do not call write/edit/bash tools before this.",
    permission: "read",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "The plan to present to the user, in markdown." },
      },
      required: ["plan"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      // Best-effort: a proposed plan is worth keeping a durable record of regardless of whether
      // the disk write happens to succeed, but persistence failing here must never block the
      // actual approval flow the model and user are waiting on. Skipped entirely when the
      // session is ephemeral (persistTranscripts: false).
      if (persist) await persistPlan(ctx.sessionId, input.plan).catch(() => {});
      const approved = await onApprove(input.plan);
      if (approved) {
        gate.setMode(resumeMode);
        return textResult(
          "Plan approved. You may now use write, edit, bash, and other non-read-only tools to execute it.",
        );
      }
      return textResult(
        "Plan not approved yet. Continue read-only exploration, or revise the plan and call exit_plan_mode again.",
        false,
      );
    },
  };
}
