import type { Skill } from "@pi-everywhere/protocol";
import { runCoreContract } from "./contract/index";
import { createFakeCore, type FakeGithubRepo } from "./index";

const SPEED = 20;

runCoreContract(
  "testkit fake",
  async () => {
    const fs: Record<string, "directory" | "file"> = { "/fake/notes.txt": "file" };
    const repos: FakeGithubRepo[] = [
      {
        nameWithOwner: "demo/local",
        description: null,
        private: false,
        pushedAt: 2,
        localPath: "/fake/local",
      },
      { nameWithOwner: "demo/remote", description: null, private: true, pushedAt: 3, localPath: null },
    ];
    const skills: Skill[] = [];
    const core = createFakeCore({ speed: SPEED, fs, github: { repos }, skills });
    return {
      core,
      github: { repoWithLocalCopy: "demo/local", repoWithoutLocalCopy: "demo/remote" },
      paths: {
        directory: async (name) => {
          fs[`/fake/${name}`] = "directory";
          return `/fake/${name}`;
        },
        file: async () => "/fake/notes.txt",
        missing: () => "/fake/missing",
        cloneUrl: async () => "https://example.com/demo/ok.git",
        failingCloneUrl: () => "https://127.0.0.1:1/fail.git",
      },
      writeProjectFile: async (directory, name) => {
        fs[`${directory}/${name}`] = "file";
      },
      addProjectSkill: async (_directory, name, description) => {
        skills.push({ name, description, scope: "project", path: `.agents/skills/${name}/SKILL.md` });
      },
      dispose: () => core.close(),
    };
  },
  { pending: ["[subagents-v2]"] },
);
