import { tmpdir } from "node:os";
import type { Project } from "@pi-everywhere/protocol";
import { describe, expect, it } from "vitest";
import { createPresentProject } from "./project-view";
import { makeRepo } from "./workspaces/workspace-test-support";

const project = (status: Project["status"]): Project => ({
  id: "p1",
  name: "p",
  path: "/p",
  createdAt: 0,
  kind: "folder",
  isGitRepo: false,
  status,
});

describe("createPresentProject", () => {
  const present = createPresentProject({ version: async () => "auto" } as never);

  it("serves an icon url only once the project is ready", async () => {
    expect((await present(project("cloning"))).iconUrl).toBeNull();
    expect((await present(project("failed"))).iconUrl).toBeNull();
    expect((await present(project("ready"))).iconUrl).toContain("/p1/icon");
  });

  it("marks a folder inside a repository as a git repo, and a plain folder as not", async () => {
    const { repo } = await makeRepo({ subfolder: "app" });
    const inside = { ...project("ready"), path: `${repo}/app` };
    expect((await present(inside)).isGitRepo).toBe(true);
    expect((await present({ ...inside, path: tmpdir() })).isGitRepo).toBe(false);
  });
});
