import { describe, expect, it, vi } from "vitest";
import type { PermissionRequest } from "./gate.js";
import { PolicyGate } from "./policy.js";

function readReq(path: string): PermissionRequest {
  return { toolName: "read_file", category: "read", input: { path }, cwd: "/proj" };
}

describe("PolicyGate — secret files", () => {
  it("prompts before reading a secret file even in auto mode", async () => {
    const onAskUser = vi.fn().mockResolvedValue("allow_once");
    const gate = new PolicyGate({ mode: "auto", onAskUser });
    const decision = await gate.evaluate(readReq(".env"));
    expect(onAskUser).toHaveBeenCalledOnce();
    expect(decision.decision).toBe("allow");
  });

  it("denies a secret-file read when there is no interactive prompt", async () => {
    const gate = new PolicyGate({ mode: "auto" });
    const decision = await gate.evaluate(readReq("config/id_rsa"));
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/credentials\/key file/);
  });

  it("an explicit allow rule is still an escape hatch", async () => {
    const onAskUser = vi.fn();
    const gate = new PolicyGate({ mode: "manual", allow: ["read_file"], onAskUser });
    const decision = await gate.evaluate(readReq(".env"));
    expect(onAskUser).not.toHaveBeenCalled();
    expect(decision.decision).toBe("allow");
  });

  it("a normal in-cwd read is still auto-allowed with no prompt", async () => {
    const onAskUser = vi.fn();
    const gate = new PolicyGate({ mode: "manual", onAskUser });
    const decision = await gate.evaluate(readReq("src/index.ts"));
    expect(onAskUser).not.toHaveBeenCalled();
    expect(decision.decision).toBe("allow");
  });
});
