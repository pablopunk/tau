import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { setUp } from "./workspace-test-support";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("workspaces.remove and terminals", () => {
  test("closes the thread's terminals after the checks, before the worktree goes", async () => {
    const calls: Array<{ id: string; folderExisted: boolean }> = [];
    let path = "";
    const { startThread, service } = await setUp({
      deps: {
        closeTerminalsOf: async (id) => {
          calls.push({ id, folderExisted: await exists(path) });
        },
      },
    });
    const thread = await startThread();
    path = thread.workspace.path;
    await service.remove(thread.id, false);
    expect(calls).toEqual([{ id: thread.id, folderExisted: true }]);
    expect(await exists(path)).toBe(false);
  });

  test("a rejected remove leaves terminals running", async () => {
    const closed: string[] = [];
    const { startThread, service, setStatus } = await setUp({
      deps: { closeTerminalsOf: async (id) => void closed.push(id) },
    });
    const thread = await startThread();
    setStatus(thread.id, "running");
    await expect(service.remove(thread.id, true)).rejects.toMatchObject({ code: "thread_busy" });
    setStatus(thread.id, "idle");
    await writeFile(join(thread.workspace.path, "dirty.txt"), "x");
    await expect(service.remove(thread.id, false)).rejects.toMatchObject({ code: "has_unmerged_work" });
    expect(closed).toEqual([]);
  });
});
