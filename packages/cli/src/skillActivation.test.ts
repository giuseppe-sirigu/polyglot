import type { Skill } from "@usepolyglot/core";
import { describe, expect, it } from "vitest";
import { resolveSkillActivation } from "./skillActivation.js";

function skill(name: string): Skill {
  return { name, description: "", body: "b", dir: `/s/${name}`, source: `${name}/SKILL.md` };
}

const skills = [skill("haiku"), skill("code-review")];

describe("resolveSkillActivation", () => {
  it("detects `@name` at the start and strips the token", () => {
    const a = resolveSkillActivation("@haiku write about autumn", skills);
    expect(a?.skill.name).toBe("haiku");
    expect(a?.strippedText).toBe("write about autumn");
  });

  it("detects `@name` mid-message and strips just that token", () => {
    const a = resolveSkillActivation("please @haiku describe the sea", skills);
    expect(a?.skill.name).toBe("haiku");
    expect(a?.strippedText).toBe("please describe the sea");
  });

  it("handles a hyphenated skill name", () => {
    expect(resolveSkillActivation("@code-review look at this", skills)?.skill.name).toBe(
      "code-review",
    );
  });

  it("returns an empty strippedText when the message is only the token", () => {
    const a = resolveSkillActivation("@haiku", skills);
    expect(a?.skill.name).toBe("haiku");
    expect(a?.strippedText).toBe("");
  });

  it("ignores an `@` that is part of another word (email)", () => {
    expect(resolveSkillActivation("mail me at a@haiku.dev", skills)).toBeNull();
  });

  it("returns null when no token names a loaded skill", () => {
    expect(resolveSkillActivation("@nope do a thing", skills)).toBeNull();
    expect(resolveSkillActivation("just a normal message", skills)).toBeNull();
  });

  it("returns null with no skills loaded", () => {
    expect(resolveSkillActivation("@haiku hello", [])).toBeNull();
  });

  it("takes the first matching token when several are present", () => {
    const a = resolveSkillActivation("@code-review then @haiku", skills);
    expect(a?.skill.name).toBe("code-review");
    expect(a?.strippedText).toBe("then @haiku");
  });
});
