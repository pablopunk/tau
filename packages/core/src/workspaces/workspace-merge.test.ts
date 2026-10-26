import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commitFile, git, setUp } from "./workspace-test-support";

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code,
  );

describe("workspaces.status", () => {
  test("counts ahead, behind and dirty files", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await commitFile(repo, "b.txt", "b");
    await writeFile(join(thread.workspace.path, "dirty.txt"), "x");
    expect(await service.status(thread.id)).toMatchObject({
      ahead: 1,
      behind: 1,
      dirtyFiles: ["dirty.txt"],
      unmergedCommits: 1,
      canMerge: false,
    });
  });

  test("rejects checkout threads and unknown threads", async () => {
    const { service, add, legacy, repo } = await setUp();
    const checkout = add(legacy(repo));
    expect(await codeOf(service.status(checkout.id))).toBe("invalid_request");
    expect(await codeOf(service.status("nope"))).toBe("not_found");
  });
});

describe("workspaces.merge", () => {
  test("fast-forwards the base after rebasing and records the sha", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await commitFile(repo, "b.txt", "b");
    const merged = await service.merge(thread.id);
    expect(merged.workspace.state).toBe("merged");
    expect(merged.workspace.mergedSha).toBe(await git(repo, "rev-parse", "main"));
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("a");
  });

  test("aborts the rebase and reports merge_conflict", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "hello.txt", "from thread");
    await commitFile(repo, "hello.txt", "from main");
    expect(await codeOf(service.merge(thread.id))).toBe("merge_conflict");
    expect(await git(thread.workspace.path, "status", "--porcelain")).toBe("");
    expect(await git(thread.workspace.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      thread.workspace.branch,
    );
  });

  test("refuses while the thread runs", async () => {
    const { startThread, service, setStatus } = await setUp();
    const thread = await startThread();
    setStatus(thread.id, "running");
    expect(await codeOf(service.merge(thread.id))).toBe("thread_busy");
  });

  test("merges while the thread runs with force", async () => {
    const { startThread, service, repo, setStatus } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    setStatus(thread.id, "running");
    const merged = await service.merge(thread.id, true);
    expect(merged.workspace.state).toBe("merged");
    expect(merged.workspace.mergedSha).toBe(await git(repo, "rev-parse", "main"));
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("a");
  });

  test("still refuses a dirty worktree with force", async () => {
    const { startThread, service, setStatus } = await setUp();
    const thread = await startThread();
    await writeFile(join(thread.workspace.path, "new.txt"), "x");
    setStatus(thread.id, "running");
    expect(await codeOf(service.merge(thread.id, true))).toBe("worktree_dirty");
  });

  test("refuses a dirty worktree", async () => {
    const { startThread, service } = await setUp();
    const thread = await startThread();
    await writeFile(join(thread.workspace.path, "new.txt"), "x");
    expect(await codeOf(service.merge(thread.id))).toBe("worktree_dirty");
  });

  test("refuses when the main checkout is on another branch", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await git(repo, "checkout", "--quiet", "-b", "other");
    expect(await codeOf(service.merge(thread.id))).toBe("not_on_base");
  });

  test("reports base_dirty with git's message when the base edits an overlapping file", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "hello.txt", "from thread");
    await writeFile(join(repo, "hello.txt"), "uncommitted on base");
    const error = await service.merge(thread.id).catch((caught: Error & { code?: string }) => caught);
    expect(error).toMatchObject({ code: "base_dirty" });
    expect((error as Error).message).toMatch(/overwritten|local changes/i);
  });

  test("merges when the base has non-overlapping uncommitted changes", async () => {
    const { startThread, service, repo } = await setUp();
    const thread = await startThread();
    await commitFile(thread.workspace.path, "a.txt", "a");
    await writeFile(join(repo, "hello.txt"), "uncommitted on base");
    expect((await service.merge(thread.id)).workspace.state).toBe("merged");
    expect(await readFile(join(repo, "hello.txt"), "utf8")).toBe("uncommitted on base");
  });

  test("serializes two merges into the same repo", async () => {
    const { startThread, service } = await setUp();
    const first = await startThread("one");
    const second = await startThread("two");
    await commitFile(first.workspace.path, "one.txt", "1");
    await commitFile(second.workspace.path, "two.txt", "2");
    const results = await Promise.all([service.merge(first.id), service.merge(second.id)]);
    expect(results.map((thread) => thread.workspace.state)).toEqual(["merged", "merged"]);
  });
});
