import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { slugFrom } from "./slug";
import { createWorkspaceService } from "./workspace-service";
import { git, makeRepo, projectAt, setUp } from "./workspace-test-support";

describe("slugFrom", () => {
  test("keeps lowercase words, trims to 40 characters and never answers empty", () => {
    expect(slugFrom("Fix the Bug!!")).toBe("fix-the-bug");
    expect(slugFrom("a".repeat(60))).toHaveLength(40);
    expect(slugFrom("???")).toBe("thread");
  });
});

describe("workspaces.create", () => {
  test("adds a worktree on pi/<slug> for a repo root project", async () => {
    const { startThread, home, repo } = await setUp();
    const { workspace } = await startThread("Add login");
    expect(workspace).toMatchObject({
      mode: "worktree",
      branch: "pi/add-login",
      base: "main",
      state: "ready",
    });
    expect(workspace.path).toBe(join(home, "worktrees", "repo", "add-login"));
    expect(await git(repo, "branch", "--list", "pi/add-login")).toContain("pi/add-login");
  });

  test("points a subfolder project at the same subfolder inside the worktree", async () => {
    const { startThread, home } = await setUp({ subfolder: "packages/app" });
    const { workspace } = await startThread("Edit app");
    expect(workspace.path).toBe(join(home, "worktrees", "repo", "edit-app", "packages", "app"));
    await expect(access(join(workspace.path, "app.txt"))).resolves.toBeUndefined();
  });

  test("returns the folder for checkout mode, home and non-git folders", async () => {
    const { service, repo } = await setUp();
    const { root } = await makeRepo();
    const plain = join(root, "plain");
    const base = { requestId: "r", firstMessage: "x" };
    expect((await service.create({ ...base, project: projectAt(repo), mode: "checkout" })).mode).toBe(
      "checkout",
    );
    expect((await service.create({ ...base, project: projectAt(repo, "home"), mode: "worktree" })).path).toBe(
      repo,
    );
    await writeFile(join(root, "file"), "x");
    const nonGit = await service.create({ ...base, project: projectAt(root, "folder"), mode: "worktree" });
    expect(nonGit.mode).toBe("checkout");
    expect(plain).toBeTruthy();
  });

  test("gives colliding messages different slugs, branches and folders", async () => {
    const { startThread } = await setUp();
    const first = (await startThread("same")).workspace;
    const second = (await startThread("same")).workspace;
    expect(second.branch).toBe("pi/same-2");
    expect(second.path).not.toBe(first.path);
  });

  test("skips a slug whose branch exists", async () => {
    const { startThread, repo } = await setUp();
    await git(repo, "branch", "pi/taken");
    expect((await startThread("taken")).workspace.branch).toBe("pi/taken-2");
  });

  test("reuses the worktree when the same requestId is retried", async () => {
    const { service, repo } = await setUp();
    const request = {
      project: projectAt(repo),
      mode: "worktree" as const,
      requestId: "once",
      firstMessage: "go",
    };
    const first = await service.create(request);
    expect(await service.create(request)).toEqual(first);
  });

  test("falls back to the folder when the repo has no commits", async () => {
    const { root } = await makeRepo();
    const empty = join(root, "empty");
    await git(root, "init", "--quiet", "-b", "main", empty);
    const { store } = (await import("./workspace-test-support")).fakeConversations();
    const service = createWorkspaceService({ home: join(root, "home"), conversations: store });
    const workspace = await service.create({
      project: projectAt(empty),
      mode: "worktree",
      requestId: "r",
      firstMessage: "x",
    });
    expect(workspace.mode).toBe("checkout");
  });
});
