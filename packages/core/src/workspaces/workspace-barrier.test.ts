import { describe, expect, test, vi } from "vitest";
import { createConversationsApi } from "../conversations-api";
import type { ConversationStore } from "../harness/conversation-store";
import { commitFile, setUp } from "./workspace-test-support";
import { createWriterBarrier } from "./writer-barrier";

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code,
  );

async function setUpSharedWorktree(options: { hasRunningOf?: (id: string) => boolean } = {}) {
  const barrier = createWriterBarrier();
  const context = await setUp({ deps: { writerBarrier: barrier, ...options } });
  const owner = await context.startThread();
  const sibling = context.add(owner.workspace);
  return { ...context, barrier, owner, sibling };
}

describe("workspace writer barrier: merge", () => {
  test("self-merge with force from a running thread still succeeds", async () => {
    const { service, owner, setStatus, repo } = await setUpSharedWorktree();
    await commitFile(owner.workspace.path, "a.txt", "a");
    setStatus(owner.id, "running");
    const merged = await service.merge(owner.id, true);
    expect(merged.workspace.state).toBe("merged");
    expect(merged.workspace.mergedSha).toBeDefined();
    expect(repo).toBeDefined();
  });

  test("rejects thread_busy with force when a thread sharing the worktree is running", async () => {
    const { service, owner, sibling, setStatus } = await setUpSharedWorktree();
    await commitFile(owner.workspace.path, "a.txt", "a");
    setStatus(sibling.id, "running");
    expect(await codeOf(service.merge(owner.id, true))).toBe("thread_busy");
    expect(await codeOf(service.merge(owner.id, false))).toBe("thread_busy");
  });

  test("rejects when a sibling's state cannot be determined", async () => {
    const { service, owner, sibling, store } = await setUpSharedWorktree();
    const find = store.find.bind(store);
    store.find = async (id: string) => (id === sibling.id ? Promise.reject(new Error("gone")) : find(id));
    expect(await codeOf(service.merge(owner.id, true))).toBe("thread_busy");
  });

  test("rejects when a sibling reports an unknown status", async () => {
    const { service, owner, sibling, setStatus } = await setUpSharedWorktree();
    setStatus(sibling.id, "mystery" as never);
    expect(await codeOf(service.merge(owner.id, true))).toBe("thread_busy");
  });

  test("rejects when the thread list cannot be read", async () => {
    const { service, owner, store } = await setUpSharedWorktree();
    store.list = () => Promise.reject(new Error("db down"));
    expect(await codeOf(service.merge(owner.id, true))).toBe("thread_busy");
  });

  test("releases the barrier after a rejected merge so a later merge works", async () => {
    const { service, owner, sibling, setStatus, barrier } = await setUpSharedWorktree();
    await commitFile(owner.workspace.path, "a.txt", "a");
    setStatus(sibling.id, "running");
    expect(await codeOf(service.merge(owner.id, true))).toBe("thread_busy");
    expect(barrier.isFenced(owner.workspace.path)).toBe(false);
    setStatus(sibling.id, "idle");
    expect((await service.merge(owner.id, true)).workspace.state).toBe("merged");
  });
});

describe("workspace writer barrier: remove", () => {
  test("rejects thread_busy with force when a thread sharing the worktree is running", async () => {
    const { service, owner, sibling, setStatus } = await setUpSharedWorktree();
    setStatus(sibling.id, "running");
    expect(await codeOf(service.remove(owner.id, true))).toBe("thread_busy");
  });

  test("rejects when a sibling has background processes", async () => {
    const { service, owner, sibling } = await setUpSharedWorktree({
      hasRunningOf: (id) => id === sibling.id,
    });
    expect(await codeOf(service.remove(owner.id, true))).toBe("thread_busy");
  });

  test("rejects when a sibling's state cannot be determined", async () => {
    const { service, owner, sibling, store } = await setUpSharedWorktree();
    const find = store.find.bind(store);
    store.find = async (id: string) => (id === sibling.id ? Promise.reject(new Error("gone")) : find(id));
    expect(await codeOf(service.remove(owner.id, true))).toBe("thread_busy");
  });

  test("removes once the sibling is idle and releases the barrier", async () => {
    const { service, owner, sibling, setStatus, barrier } = await setUpSharedWorktree();
    setStatus(sibling.id, "running");
    expect(await codeOf(service.remove(owner.id, true))).toBe("thread_busy");
    setStatus(sibling.id, "idle");
    expect((await service.remove(owner.id, true)).workspace.state).toBe("removed");
    expect(barrier.isFenced(owner.workspace.path)).toBe(false);
  });
});

describe("workspace writer barrier: delete discard", () => {
  test("keeps the worktree when a sibling still uses it and releases the barrier", async () => {
    const { service, owner, barrier } = await setUpSharedWorktree();
    await service.onConversationRemoved(owner);
    expect(barrier.isFenced(owner.workspace.path)).toBe(false);
    expect((await service.remove(owner.id, true)).workspace.state).toBe("removed");
  });
});

describe("workspace writer barrier: send admission", () => {
  function apiWith(fence: ReturnType<typeof createWriterBarrier>) {
    const snapshotBefore = vi.fn(async () => undefined);
    const send = vi.fn();
    const find = async (id: string) => ({ id, workspace: { path: "/work/tree" } });
    const api = createConversationsApi({
      conversations: { find, send } as unknown as ConversationStore,
      checkpoints: { snapshotBefore },
      workspaceFence: fence,
    } as unknown as Parameters<typeof createConversationsApi>[0]);
    return { api, snapshotBefore, send };
  }

  const message = { requestId: "r1", text: "hi" };

  test("rejects a send for a non-owner thread with no side effect", async () => {
    const fence = createWriterBarrier();
    const { api, snapshotBefore, send } = apiWith(fence);
    let release: () => void = () => undefined;
    const held = fence.run("/work/tree", "owner", () => new Promise<void>((resolve) => (release = resolve)));
    expect(await codeOf(api.send("other", message))).toBe("thread_busy");
    expect(snapshotBefore).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    release();
    await held;
  });

  test("does not fence a send once the barrier is released", async () => {
    const fence = createWriterBarrier();
    const { api } = apiWith(fence);
    await fence.run("/work/tree", "owner", async () => undefined);
    expect(await codeOf(api.send("other", message))).not.toBe("thread_busy");
  });
});
