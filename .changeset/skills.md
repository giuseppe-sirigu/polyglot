---
"@usepolyglot/cli": minor
---

Skills. Put a focused instruction bundle at `.polyglot/skills/<name>/SKILL.md` (or `~/.polyglot/skills/` for one available everywhere) — frontmatter `description`, body is the guidance — and activate it for the session by typing `@<name>` in a message. Its instructions are added to the system prompt from the next turn until `/skill off`. Bundled resource files sit alongside `SKILL.md` and the model reads them by relative path. `@` suggestions now include skills; `/skills` lists them and shows which is active; `/status` has a skill line. Same `SKILL.md` layout as Claude Code, so skills are portable. `POLYGLOT_NO_SKILLS=1` disables. In `-p` mode, a `@<name>` token in the prompt activates the skill for that run.
