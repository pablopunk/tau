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
  root = await realpath(await mkdtemp(join(tmpdir(), "tau-skills-")));
  project = join(root, "project");
  home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  clearSkillsCache();
});
afterEach(() => rm(root, { recursive: true, force: true }));

const discoverUserAndProject = async (...args: Parameters<typeof discoverSkills>) =>
  (await discoverSkills(...args)).filter((skill) => skill.scope !== "app");

describe("discoverSkills", () => {
  it("finds project and user skills with project-relative and ~-relative paths", async () => {
    await addSkill(project, ".claude/skills", "a", skillText("alpha", "Does A"));
    await addSkill(home, ".pi/agent/skills", "b", skillText("beta", "Does B"));
    expect(await discoverUserAndProject(project, home)).toEqual([
      { name: "alpha", description: "Does A", scope: "project", path: ".claude/skills/a/SKILL.md" },
      { name: "beta", description: "Does B", scope: "user", path: "~/.pi/agent/skills/b/SKILL.md" },
    ]);
  });

  it("lets the project win a name clash", async () => {
    await addSkill(project, ".agents/skills", "x", skillText("same", "project one"));
    await addSkill(home, ".agents/skills", "x", skillText("same", "user one"));
    const skills = await discoverUserAndProject(project, home);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.scope).toBe("project");
  });

  it("lists the bundled tau skill last with scope app", async () => {
    await addSkill(project, ".agents/skills", "a", skillText("alpha", "Does A"));
    const skills = await discoverSkills(project, home);
    expect(skills.map((skill) => skill.name)).toEqual(["alpha", "tau"]);
    expect(skills[1]?.scope).toBe("app");
  });

  it("lets a project or user skill named tau win over the bundled one", async () => {
    await addSkill(home, ".agents/skills", "t", skillText("tau", "mine"));
    const skills = await discoverSkills(project, home);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ scope: "user", description: "mine" });
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
    const skills = await discoverUserAndProject(project, home);
    expect(skills.map((skill) => skill.name)).toEqual(["long"]);
    expect(skills[0]?.description).toHaveLength(300);
  });

  it("skips symlinks that resolve outside the skills dir", async () => {
    await addSkill(root, "outside", "evil", skillText("evil", "Outside"));
    const folder = join(project, ".agents", "skills", "evil");
    await mkdir(folder, { recursive: true });
    await symlink(join(root, "outside", "evil", "SKILL.md"), join(folder, "SKILL.md"));
    expect(await discoverUserAndProject(project, home)).toEqual([]);
  });

  it("answers user skills only without a project and caches the answer", async () => {
    await addSkill(home, ".claude/skills", "u", skillText("u", "User"));
    expect(await discoverUserAndProject(null, home)).toHaveLength(1);
    await addSkill(home, ".claude/skills", "v", skillText("v", "Later"));
    expect(await discoverUserAndProject(null, home)).toHaveLength(1);
    clearSkillsCache();
    expect(await discoverUserAndProject(null, home)).toHaveLength(2);
  });
});
