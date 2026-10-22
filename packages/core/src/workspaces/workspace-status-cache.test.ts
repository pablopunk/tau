import type { ThreadWorkspace } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as status from "./workspace-git-status";
import { createWorkspaceService } from "./workspace-service";
import { fakeConversations } from "./workspace-test-support";

const workspace: ThreadWorkspace = {
  mode: "worktree",
  path: "/w",
  branch: "pi/fix",
  base: "main",
  state: "ready",
  mergedSha: null,
  pullRequestUrl: null,
};
const clean = { ahead: 1, behind: 2, dirtyFiles: [] };

beforeEach(() => vi.spyOn(status, "readWorkspaceGitStatus").mockResolvedValue(clean));
afterEach(() => vi.restoreAllMocks());

function setup() {
  const threads = fakeConversations();
  const service = createWorkspaceService({ home: "/unused", conversations: threads.store });
  return { ...threads, service };
}

describe("workspace status integration", () => {
  it("shares Git facts but recomputes eligibility for each thread and running state", async () => {
    const { add, service, setStatus } = setup();
    const idle = add(workspace);
    const running = add(workspace, "running");
    const [a, b] = await Promise.all([service.status(idle.id), service.status(running.id)]);
    expect(a).toMatchObject({ canMerge: true, ahead: 1, behind: 2 });
    expect(b).toMatchObject({ canMerge: false, reason: "The thread is running." });
    setStatus(idle.id, "running");
    expect(await service.status(idle.id)).toMatchObject({ canMerge: false });
    expect(status.readWorkspaceGitStatus).toHaveBeenCalledTimes(1);
  });

  it("rechecks running state after a slow cold read", async () => {
    const { add, service, setStatus } = setup();
    const thread = add(workspace);
    let resolve!: (value: typeof clean) => void;
    vi.mocked(status.readWorkspaceGitStatus).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = service.status(thread.id);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    setStatus(thread.id, "running");
    resolve(clean);
    expect(await pending).toMatchObject({ canMerge: false });
  });

  it("does not reuse facts after a workspace identity changes or is removed", async () => {
    const { add, store, service } = setup();
    const thread = add(workspace);
    await service.status(thread.id);
    await store.setWorkspace(thread.id, { ...workspace, path: "/new" });
    await service.status(thread.id);
    expect(status.readWorkspaceGitStatus).toHaveBeenCalledTimes(2);
    await store.setWorkspace(thread.id, { ...workspace, state: "removed" });
    await expect(service.status(thread.id)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("invalidates all shared facts even after a failed mutation", async () => {
    const { add, service, setStatus } = setup();
    const thread = add(workspace);
    await service.status(thread.id);
    setStatus(thread.id, "running");
    await expect(service.remove(thread.id, false)).rejects.toBeDefined();
    await service.status(thread.id);
    expect(status.readWorkspaceGitStatus).toHaveBeenCalledTimes(2);
  });
});
