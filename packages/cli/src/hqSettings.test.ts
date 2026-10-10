import { describe, expect, it } from "vitest";
import { hqSettings, oldNamesNotice } from "./hqSettings.js";

describe("hqSettings", () => {
  it("reads HQ's settings", () => {
    expect(
      hqSettings({
        POLYGLOT_HQ_URL: "https://hq.internal",
        POLYGLOT_HQ_TOKEN: "t",
        POLYGLOT_HQ_INCLUDE_RAW_CALLS: "true",
      }),
    ).toEqual({ url: "https://hq.internal", token: "t", includeRawCalls: true, oldNames: [] });
  });

  it("still reads the old control-plane names, and lists the ones used", () => {
    const s = hqSettings({
      POLYGLOT_CONTROL_PLANE_URL: "https://cp.internal",
      POLYGLOT_CONTROL_PLANE_TOKEN: "t",
    });
    expect(s).toEqual({
      url: "https://cp.internal",
      token: "t",
      includeRawCalls: false,
      oldNames: ["POLYGLOT_CONTROL_PLANE_URL", "POLYGLOT_CONTROL_PLANE_TOKEN"],
    });
    expect(oldNamesNotice(s.oldNames)).toBe(
      "POLYGLOT_CONTROL_PLANE_URL, POLYGLOT_CONTROL_PLANE_TOKEN are the old names for your team HQ's settings: rename to POLYGLOT_HQ_URL, POLYGLOT_HQ_TOKEN. The old names still work for now.",
    );
  });

  it("prefers the new name when both are set", () => {
    const s = hqSettings({
      POLYGLOT_HQ_URL: "https://new",
      POLYGLOT_CONTROL_PLANE_URL: "https://old",
    });
    expect([s.url, s.oldNames]).toEqual(["https://new", []]);
  });

  it("is off with nothing set", () => {
    expect(hqSettings({})).toEqual({
      url: undefined,
      token: undefined,
      includeRawCalls: false,
      oldNames: [],
    });
  });
});
