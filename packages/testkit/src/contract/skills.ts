import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function skillCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("skills", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[skills] lists user skills without a project", async () => {
      const skills = await target.core.skills.list(null);
      expect(Array.isArray(skills)).toBe(true);
      for (const skill of skills) expect(skill.scope).toBe("user");
    });

    test("[skills] rejects an unknown project with not_found", async () => {
      await rejectsWithCode(target.core.skills.list("nope"), "not_found");
    });

    test("[skills] lists a skill found in the project folder", async () => {
      const { addProjectSkill } = target;
      if (!addProjectSkill) return;
      const project = await target.core.projects.add({ path: await target.paths.directory("skilled") });
      await addProjectSkill(project.path, "demo-skill", "Does the demo thing.");
      const skills = await target.core.skills.list(project.id);
      expect(skills).toContainEqual({
        name: "demo-skill",
        description: "Does the demo thing.",
        scope: "project",
        path: ".agents/skills/demo-skill/SKILL.md",
      });
    });
  });
}
