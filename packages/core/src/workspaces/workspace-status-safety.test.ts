import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { commitFile, setUp } from "./workspace-test-support";

describe("cached display status never weakens Git safety checks", () => {
  it("observes external edits after the short TTL", async () => {
    let now = 1_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const { service, startThread } = await setUp();
      const thread = await startThread();
      expect((await service.status(thread.id)).dirtyFiles).toEqual([]);
      await writeFile(join(thread.workspace.path, "external.txt"), "external edit");
      expect((await service.status(thread.id)).dirtyFiles).toEqual([]);
      now += 5_001;
      expect((await service.status(thread.id)).dirtyFiles).toEqual(["external.txt"]);
    } finally {
      clock.mockRestore();
    }
  });

  it("reports repository-root paths for projects in subfolders", async () => {
    const { service, startThread } = await setUp({ subfolder: "app" });
    const thread = await startThread();
    await writeFile(join(thread.workspace.path, "dirty.txt"), "edit");
    expect((await service.status(thread.id)).dirtyFiles).toEqual(["app/dirty.txt"]);
  });

  it("still refuses dirty merges and deletion after priming a clean cache", async () => {
    const { service, startThread } = await setUp();
    const thread = await startThread();
    expect((await service.status(thread.id)).dirtyFiles).toEqual([]);
    await writeFile(join(thread.workspace.path, "new.txt"), "not disposable");
    expect(await service.unmergedWork(thread)).toContain("new.txt");
    await expect(service.merge(thread.id)).rejects.toMatchObject({ code: "worktree_dirty" });
    await expect(service.remove(thread.id, false)).rejects.toMatchObject({ code: "has_unmerged_work" });
  });

  it("invalidates sibling status after advancing the shared base", async () => {
    const { service, startThread } = await setUp();
    const a = await startThread("one");
    const b = await startThread("two");
    expect((await service.status(b.id)).behind).toBe(0);
    await commitFile(a.workspace.path, "a.txt", "a");
    await service.merge(a.id);
    expect((await service.status(b.id)).behind).toBe(1);
  });
});
