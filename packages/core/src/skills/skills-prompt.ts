import type { Skill } from "@pi-everywhere/protocol";

const SKILLS_INTRO =
  "Skills available. When the user writes `@name` or the task matches one, read that SKILL.md first and follow it.";

const describeSkill = (skill: Skill) => `- ${skill.name} — ${skill.description} — ${skill.path}`;

export function skillsPrompt(skills: Skill[]): string | undefined {
  if (skills.length === 0) return undefined;
  return [SKILLS_INTRO, ...skills.map(describeSkill)].join("\n");
}
