import { access } from "node:fs/promises";
import type { ConversationSummary, WriterState } from "@tau/protocol";
import { describe, expect, test } from "vitest";
import { commitFile, setUp } from "./workspace-test-support";
import { createWriterBarrier } from "./writer-barrier";

type Answer = WriterState | "throws" | undefined;

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ code: "ok", message: "" }),
    (error: { code?: string; message?: string }) => ({ code: error.code, message: error.message ?? "" }),
  );

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function setUpWithPort(options: { withSibling?: boolean } = {}) {
  const answers = new Map<string, Answer>();
  const asked: string[] = [];
  const writerStateOf = async (thread: ConversationSummary) => {
    asked.push(thread.id);
    const answer = answers.get(thread.id);
    if (answer === "throws") throw new Error("store unreadable");
    return answer;
  };
  const barrier = createWriterBarrier();
  const context = await setUp({ deps: { writerBarrier: barrier, writerStateOf } });
  const owner = await context.startThread();
  const sibling = context.add(owner.workspace);
  if (options.withSibling === false)
    await context.store.setWorkspace(sibling.id, { ...sibling.workspace, state: "removed" });
  const answer = (thread: ConversationSummary, state: Answer) => answers.set(thread.id, state);
  return { ...context, barrier, owner, sibling, answer, asked };
}

const UNSETTLED = [
  ["running", /still running/],
  ["cancelling", /cancelling/],
  ["reconciling", /reconciling/],
  ["unknown", /could not be verified/],
] as const;

describe("workspace writer port: sibling decides merge", () => {
  test.each(UNSETTLED)("a sibling that is %s denies merge even with force", async (state, message) => {
    const { service, owner, sibling, answer, barrier } = await setUpWithPort();
    await commitFile(owner.workspace.path, "a.txt", "a");
    answer(sibling, state);
    for (const force of [true, false]) {
      const denied = await errorOf(service.merge(owner.id, force));
      expect(denied.code).toBe("thread_busy");
      expect(denied.message).toMatch(message);
    }
    expect(barrier.isFenced(owner.workspace.path)).toBe(false);
  });

  test("a port that throws is unknown and denies", async () => {
    const { service, owner, sibling, answer } = await setUpWithPort();
    answer(sibling, "throws");
    const denied = await errorOf(service.merge(owner.id, true));
    expect(denied.code).toBe("thread_busy");
    expect(denied.message).toMatch(/could not be verified/);
  });

  test("a settled sibling lets merge proceed", async () => {
    const { service, owner, sibling, answer } = await setUpWithPort();
    await commitFile(owner.workspace.path, "a.txt", "a");
    answer(sibling, "settled");
    expect((await service.merge(owner.id, true)).workspace.state).toBe("merged");
  });

  test("a settled port answer does not override a running summary status", async () => {
    const { service, owner, sibling, answer, setStatus } = await setUpWithPort();
    answer(sibling, "settled");
    setStatus(sibling.id, "running");
    expect((await errorOf(service.merge(owner.id, true))).code).toBe("thread_busy");
  });

  test("an undefined answer keeps the legacy summary-status logic", async () => {
    const { service, owner, sibling, answer, setStatus } = await setUpWithPort();
    await commitFile(owner.workspace.path, "a.txt", "a");
    answer(sibling, undefined);
    setStatus(sibling.id, "running");
    expect((await errorOf(service.merge(owner.id, true))).code).toBe("thread_busy");
    setStatus(sibling.id, "idle");
    expect((await service.merge(owner.id, true)).workspace.state).toBe("merged");
  });
});

describe("workspace writer port: the thread itself", () => {
  test("self-merge with force from a running writer is still exempt", async () => {
    const { service, owner, answer, setStatus } = await setUpWithPort();
    await commitFile(owner.workspace.path, "a.txt", "a");
    answer(owner, "running");
    setStatus(owner.id, "running");
    expect((await service.merge(owner.id, true)).workspace.state).toBe("merged");
  });

  test("a running writer without force is denied", async () => {
    const { service, owner, answer } = await setUpWithPort();
    answer(owner, "running");
    expect((await errorOf(service.merge(owner.id, false))).code).toBe("thread_busy");
  });

  test.each(["cancelling", "reconciling", "unknown", "throws"] as const)(
    "a %s native thread cannot be merged, even with force",
    async (state) => {
      const { service, owner, answer } = await setUpWithPort();
      await commitFile(owner.workspace.path, "a.txt", "a");
      answer(owner, state);
      for (const force of [true, false]) {
        expect((await errorOf(service.merge(owner.id, force))).code).toBe("thread_busy");
      }
    },
  );

  test.each(["running", "cancelling", "reconciling", "unknown", "throws"] as const)(
    "a %s native thread cannot be removed, even with force",
    async (state) => {
      const { service, owner, answer } = await setUpWithPort();
      answer(owner, state);
      expect((await errorOf(service.remove(owner.id, true))).code).toBe("thread_busy");
      expect(await exists(owner.workspace.path)).toBe(true);
    },
  );

  test("a settled native thread is merged and removed normally", async () => {
    const { service, owner, answer } = await setUpWithPort();
    answer(owner, "settled");
    expect((await service.remove(owner.id, true)).workspace.state).toBe("removed");
  });
});

describe("workspace writer port: remove and discard", () => {
  test.each(UNSETTLED)("a sibling that is %s denies remove even with force", async (state, message) => {
    const { service, owner, sibling, answer, barrier } = await setUpWithPort();
    answer(sibling, state);
    const denied = await errorOf(service.remove(owner.id, true));
    expect(denied.code).toBe("thread_busy");
    expect(denied.message).toMatch(message);
    expect(barrier.isFenced(owner.workspace.path)).toBe(false);
  });

  test("a settled sibling lets remove proceed", async () => {
    const { service, owner, sibling, answer } = await setUpWithPort();
    answer(sibling, "settled");
    expect((await service.remove(owner.id, true)).workspace.state).toBe("removed");
  });

  test("discarding a thread whose own native writer is not settled keeps the worktree", async () => {
    const { service, owner, answer } = await setUpWithPort({ withSibling: false });
    answer(owner, "unknown");
    await service.onConversationRemoved(owner);
    expect(await exists(owner.workspace.path)).toBe(true);
  });

  test("discarding a settled native thread removes the worktree", async () => {
    const { service, owner, answer } = await setUpWithPort({ withSibling: false });
    answer(owner, "settled");
    await service.onConversationRemoved(owner);
    expect(await exists(owner.workspace.path)).toBe(false);
  });
});

describe("workspace writer port: flag off", () => {
  test("without a port the Pi logic is unchanged", async () => {
    const context = await setUp();
    const owner = await context.startThread();
    const sibling = context.add(owner.workspace);
    context.setStatus(sibling.id, "running");
    expect((await errorOf(context.service.merge(owner.id, true))).code).toBe("thread_busy");
    context.setStatus(sibling.id, "idle");
    await commitFile(owner.workspace.path, "a.txt", "a");
    expect((await context.service.merge(owner.id, true)).workspace.state).toBe("merged");
  });
});
