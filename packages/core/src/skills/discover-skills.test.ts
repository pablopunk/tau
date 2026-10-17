import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSkillsCache, discoverSkills, MAX_SKILL_FILE_BYTES } from "./discover-skills";

let root: string;
let project: string;
let home: string;

const skillText = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\nBody`;

async function addSkill(base: string, dir: string, folder: string, text: string) {
  const directory = join(base, dir, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), text);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pie-skills-")));
  project = join(root, "project");
  home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  clearSkillsCache();
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("discoverSkills", () => {
  it("finds project and user skills with project-relative and ~-relative paths", async () => {
    await addSkill(project, ".claude/skills", "a", skillText("alpha", "Does A"));
    await addSkill(home, ".pi/agent/skills", "b", skillText("beta", "Does B"));
    expect(await discoverSkills(project, home)).toEqual([
      { name: "alpha", description: "Does A", scope: "project", path: ".claude/skills/a/SKILL.md" },
      { name: "beta", description: "Does B", scope: "user", path: "~/.pi/agent/skills/b/SKILL.md" },
    ]);
  });

  it("lets the project win a name clash", async () => {
    await addSkill(project, ".agents/skills", "x", skillText("same", "project one"));
    await addSkill(home, ".agents/skills", "x", skillText("same", "user one"));
    const skills = await discoverSkills(project, home);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.scope).toBe("project");
  });

  it("skips missing name or description, big files and cuts long descriptions", async () => {
    await addSkill(project, ".agents/skills", "noname", "---\ndescription: x\n---\n");
    await addSkill(project, ".agents/skills", "nodesc", "---\nname: nodesc\n---\n");
    await addSkill(
      project,
      ".agents/skills",
      "big",
      `${skillText("big", "x")}${"a".repeat(MAX_SKILL_FILE_BYTES)}`,
    );
    await addSkill(project, ".agents/skills", "long", skillText("long", "d".repeat(400)));
    const skills = await discoverSkills(project, home);
    expect(skills.map((skill) => skill.name)).toEqual(["long"]);
    expect(skills[0]?.description).toHaveLength(300);
  });

  it("skips symlinks that resolve outside the skills dir", async () => {
    await addSkill(root, "outside", "evil", skillText("evil", "Outside"));
    const folder = join(project, ".agents", "skills", "evil");
    await mkdir(folder, { recursive: true });
    await symlink(join(root, "outside", "evil", "SKILL.md"), join(folder, "SKILL.md"));
    expect(await discoverSkills(project, home)).toEqual([]);
  });

  it("answers user skills only without a project and caches the answer", async () => {
    await addSkill(home, ".claude/skills", "u", skillText("u", "User"));
    expect(await discoverSkills(null, home)).toHaveLength(1);
    await addSkill(home, ".claude/skills", "v", skillText("v", "Later"));
    expect(await discoverSkills(null, home)).toHaveLength(1);
    clearSkillsCache();
    expect(await discoverSkills(null, home)).toHaveLength(2);
  });
});
