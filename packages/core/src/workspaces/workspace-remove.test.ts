import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkspaceService } from "./workspace-service";
import { commitFile, git, setUp } from "./workspace-test-support";

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code,
  );

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("workspaces.remove", () => {
  test("removes a clean worktree and its branch, moving the thread to the main checkout", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    const removed = await service.remove(thread.id, false);
    expect(removed.workspace).toMatchObject({ state: "removed", path: repo });
    expect(await exists(thread.workspace.path)).toBe(false);
    expect(await git(repo, "branch", "--list", thread.workspace.branch ?? "")).toBe("");
  });

  test("lists uncommitted files and commits before deleting, unless forced", async () => {
    const { startThread, service } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await writeFile(join(thread.workspace.path, "dirty.txt"), "x");
    expect(await service.unmergedWork(thread)).toEqual(["dirty.txt", "1 unmerged commit(s)"]);
    expect(await codeOf(service.remove(thread.id, false))).toBe("has_unmerged_work");
    expect((await service.remove(thread.id, true)).workspace.state).toBe("removed");
  });

  test("keeps the branch when forced removal would lose its commits", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await service.remove(thread.id, true);
    expect(await git(repo, "branch", "--list", thread.workspace.branch ?? "")).toContain("pi/");
  });

  test("deletes a merged branch", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await service.merge(thread.id);
    await service.remove(thread.id, false);
    expect(await git(repo, "branch", "--list", thread.workspace.branch ?? "")).toBe("");
  });

  test("refuses while the thread runs", async () => {
    const { startThread, service, setStatus } = await setUp();
    const thread = await startThread();
    setStatus(thread.id, "running");
    expect(await codeOf(service.remove(thread.id, true))).toBe("thread_busy");
  });

  test("onConversationRemoved discards the worktree and branch", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await service.onConversationRemoved(thread);
    expect(await exists(thread.workspace.path)).toBe(false);
    expect(await git(repo, "branch", "--list", thread.workspace.branch ?? "")).toBe("");
  });

  test("onProjectRemoved discards every thread worktree of the project", async () => {
    const { startThread, service } = await setUp();
    const first = await startThread("one");
    const second = await startThread("two");
    await service.onProjectRemoved("p1");
    expect(await exists(first.workspace.path)).toBe(false);
    expect(await exists(second.workspace.path)).toBe(false);
  });
});

describe("workspaces.createPullRequest", () => {
  test("answers github_unavailable without a connected gh", async () => {
    const { startThread, service } = await setUp();
    const thread = await startThread();
    expect(await codeOf(service.createPullRequest(thread.id))).toBe("github_unavailable");
  });

  test("pushes the branch, runs gh pr create and keeps the url", async () => {
    const { startThread, root, repo, store, home } = await setUp();
    const bare = join(root, "origin.git");
    await git(root, "init", "--bare", "--quiet", bare);
    await git(repo, "remote", "add", "origin", "https://github.com/me/repo.git");
    await git(repo, "config", `url.${bare}.pushInsteadOf`, "https://github.com/me/repo.git");
    const calls: string[][] = [];
    const runGh = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "auth") {
        const host = {
          state: "success",
          active: true,
          host: "github.com",
          login: "me",
          gitProtocol: "https",
        };
        return { stdout: JSON.stringify({ hosts: { "github.com": [host] } }), stderr: "", exitCode: 0 };
      }
      return { stdout: "https://github.com/me/repo/pull/7\n", stderr: "", exitCode: 0 };
    };
    const service = createWorkspaceService({ home, conversations: store, runGh });
    const thread = await startThread();
    const created = await service.createPullRequest(thread.id);
    expect(created.workspace.pullRequestUrl).toBe("https://github.com/me/repo/pull/7");
    expect(calls.at(-1)).toEqual(
      expect.arrayContaining(["pr", "create", "--repo", "me/repo", "--head", thread.workspace.branch]),
    );
    expect(await git(bare, "branch", "--list", thread.workspace.branch ?? "")).toContain("pi/");
  });
});
