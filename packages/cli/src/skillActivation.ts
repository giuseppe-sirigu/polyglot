import type { Skill } from "@usepolyglot/core";

export interface SkillActivation {
  skill: Skill;
  /** The message with the `@<name>` directive token removed (it's an instruction, not content). */
  strippedText: string;
}

// `@<name>` where `<name>` is the skill-name grammar and the `@` starts a token (start of text
// or preceded by whitespace). Matches anywhere in the message, not just the first token.
const TOKEN_RE = /(^|\s)@([a-z0-9][a-z0-9_-]*)/g;

/**
 * Detects a `@skill-name` activation directive anywhere in a submitted message. Returns the
 * matched skill and the message with that token removed, or null when no `@<token>` names a
 * loaded skill. The first matching token wins.
 */
export function resolveSkillActivation(text: string, skills: Skill[]): SkillActivation | null {
  if (skills.length === 0) return null;
  for (const m of text.matchAll(TOKEN_RE)) {
    const [, lead, name] = m;
    if (name === undefined) continue;
    const skill = skills.find((s) => s.name === name);
    if (!skill) continue;
    const at = (m.index ?? 0) + (lead?.length ?? 0);
    const stripped = `${text.slice(0, at)}${text.slice(at + 1 + name.length)}`
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return { skill, strippedText: stripped };
  }
  return null;
}
