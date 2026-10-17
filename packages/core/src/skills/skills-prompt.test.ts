import { describe, expect, it } from "vitest";
import { skillsPrompt } from "./skills-prompt";

describe("skillsPrompt", () => {
  it("is omitted without skills", () => {
    expect(skillsPrompt([])).toBeUndefined();
  });

  it("lists name, description and path", () => {
    const text = skillsPrompt([
      { name: "a", description: "Does A", scope: "project", path: ".agents/skills/a/SKILL.md" },
    ]);
    expect(text).toContain("- a — Does A — .agents/skills/a/SKILL.md");
    expect(text).toContain("read that SKILL.md first");
  });
});
