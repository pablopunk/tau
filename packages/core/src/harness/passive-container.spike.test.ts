import { join } from "node:path";
import type { Op } from "@earendil-works/chord/delta";
import type { CommitPublication, ConversationId } from "@earendil-works/pi-durable";
import { LiveDoc } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireHomeLock, HomeLockedError } from "../home/lock";
import { useTempDir } from "../test-support/temp-dir";
import { readMeta, scanAppConversations } from "./conversation-index";
import { isBusy } from "./live-state";
import { BACKGROUND } from "./open";
import {
  appendNativeEvent,
  createPassiveContainer,
  NATIVE_DOC_KIND,
  NATIVE_ENTRY_KIND,
  NATIVE_TASK_NAME,
  NativeThreadDoc,
  NativeWaitTask,
  openSpikeWorld,
  type PiWorkCounters,
  type SpikeWorld,
} from "./passive-container-fixture";

const tempDir = useTempDir();
let directory: string;
const open: SpikeWorld[] = [];

const track = async (world: ReturnType<typeof openSpikeWorld>) => {
  const opened = await world;
  open.push(opened);
  return opened;
};

beforeEach(async () => {
  directory = await tempDir();
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(15);
  }
}

function expectNoPiWork(world: SpikeWorld, counters: PiWorkCounters = world.counters) {
  expect(counters.modelCalls()).toBe(0);
  expect(counters.toolExecutions).toBe(0);
  expect(counters.toolTasks).toBe(0);
  expect(world.faux.getPendingResponseCount()).toBeGreaterThan(0);
}

async function piTaskKinds(world: SpikeWorld): Promise<string[]> {
  const page = await world.harness.commit((tx) => tx.scanTasks({}, 200), BACKGROUND);
  return page.items.map((task) => task.kind);
}

async function piSubmissionKinds(world: SpikeWorld): Promise<string[]> {
  const inspection = await world.harness.inspect(BACKGROUND);
  return inspection.submissions.map((submission) => submission.type);
}

const idOf = (id: ConversationId) => String(id);

describe("passive container: creation and writes", () => {
  it("creates, writes entry and doc, runs a custom task, with zero Pi work", async () => {
    const world = await track(openSpikeWorld({ directory }));
    expectNoPiWork(world);

    const container = await createPassiveContainer(world, {
      title: "Native thread",
      sessionId: "sess-1",
      now: 100,
    });
    expectNoPiWork(world);
    expect(await piTaskKinds(world)).toEqual([]);
    expect(await piSubmissionKinds(world)).toEqual([]);
    expect(await isBusy(world.harness, container.id)).toBe(false);

    const submission = await container.submit(
      { type: "write", entry: { kind: NATIVE_ENTRY_KIND, data: { text: "hello from claude" } } },
      BACKGROUND,
    );
    const settled = await submission.wait(BACKGROUND);
    expect(settled.status).toBe("done");
    const { entries } = await container.context(BACKGROUND);
    expect(entries.map((entry) => entry.kind)).toEqual([NATIVE_ENTRY_KIND]);
    expect(entries[0]?.data).toEqual({ text: "hello from claude" });
    expect(entries[0]?.model).toBeUndefined();
    expectNoPiWork(world);

    await appendNativeEvent(world.harness, container.id, "doc-write");
    const doc = await world.harness.snapshot(NativeThreadDoc, container.id, BACKGROUND);
    expect(doc).toEqual({ sessionId: "sess-1", events: ["doc-write"] });
    expectNoPiWork(world);

    const taskId = await container.commit(
      (tx) =>
        tx.createTask(NativeWaitTask, { label: "w1", waitMs: 50 }, { ownership: { kind: "conversation" } }),
      BACKGROUND,
    );
    const finished = await world.harness.waitForTask(taskId, BACKGROUND);
    expect(finished.state.outcome).toEqual({ status: "completed", result: { label: "w1" } });
    expect((await world.harness.snapshot(NativeThreadDoc, container.id, BACKGROUND))?.events).toEqual([
      "doc-write",
      "task-begin:w1",
      "task-done:w1",
    ]);
    expect(await piTaskKinds(world)).toEqual([NATIVE_TASK_NAME]);
    expect(await isBusy(world.harness, container.id)).toBe(false);
    expectNoPiWork(world);
  });

  it("accepts a pi.-prefixed kind on the write path, so native kinds must avoid the pi. prefix themselves", async () => {
    const world = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(world, { title: "t", sessionId: "s", now: 1 });
    const attempt = container.submit(
      { type: "write", entry: { kind: "pi.fake", data: { a: 1 } } },
      BACKGROUND,
    );
    const outcome = await attempt.then(
      (submission) => submission.wait(BACKGROUND).then(() => "accepted" as const),
      () => "rejected" as const,
    );
    expect(outcome).toBe("accepted");
    expect(world.counters.modelCalls()).toBe(0);
  });
});

describe("passive container: restart and listing", () => {
  it("keeps doc, entry, task result and listing across a harness restart", async () => {
    const first = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(first, {
      title: "Native thread",
      sessionId: "sess-2",
      now: 500,
    });
    await (
      await container.submit(
        { type: "write", entry: { kind: NATIVE_ENTRY_KIND, data: { n: 1 } } },
        BACKGROUND,
      )
    ).wait(BACKGROUND);
    await appendNativeEvent(first.harness, container.id, "before-restart");
    const taskId = await container.commit(
      (tx) =>
        tx.createTask(NativeWaitTask, { label: "r1", waitMs: 10 }, { ownership: { kind: "conversation" } }),
      BACKGROUND,
    );
    await first.harness.waitForTask(taskId, BACKGROUND);
    const listedBefore = await first.store.list(first.project.id);
    await first.close();

    const second = await track(openSpikeWorld({ directory, setup: first.setup, counters: first.counters }));
    const doc = await second.harness.snapshot(NativeThreadDoc, container.id, BACKGROUND);
    expect(doc?.events).toEqual(["before-restart", "task-begin:r1", "task-done:r1"]);
    const record = await second.harness.getTask(taskId, BACKGROUND);
    expect(record?.state.status).toBe("terminal");
    expect(record?.state.outcome).toEqual({ status: "completed", result: { label: "r1" } });
    const reopened = await second.harness.conversation(container.id, BACKGROUND);
    const { entries } = await (reopened as NonNullable<typeof reopened>).context(BACKGROUND);
    expect(entries.map((entry) => entry.kind)).toEqual([NATIVE_ENTRY_KIND]);
    expect(entries[0]?.data).toEqual({ n: 1 });

    const listed = await second.store.list(second.project.id);
    expect(listed).toEqual(listedBefore);
    expect(listed).toHaveLength(1);
    const [summary] = listed;
    expect(summary).toMatchObject({
      id: idOf(container.id),
      title: "Native thread",
      status: "idle",
      model: null,
      lastRunEndedAt: null,
    });
    expect(await second.store.find(idOf(container.id))).toEqual(summary);
    expect((await readMeta(second.harness, container.id))?.pendingFirstInput).toBeUndefined();
    expect((await scanAppConversations(second.harness)).map((found) => found.id)).toContain(container.id);
    expect(await second.store.resumePendingStarts()).toEqual([]);
    expect(await second.store.modelOf(idOf(container.id))).toBeUndefined();
    await expect(second.store.agentOf(idOf(container.id))).rejects.toMatchObject({ code: "invalid_request" });
    expectNoPiWork(second, first.counters);
  });

  it("resumes a custom task that was mid-wait at restart, with zero Pi work", async () => {
    const first = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(first, {
      title: "Native thread",
      sessionId: "s3",
      now: 1,
    });
    const taskId = await container.commit(
      (tx) =>
        tx.createTask(
          NativeWaitTask,
          { label: "slow", waitMs: 600 },
          { ownership: { kind: "conversation" } },
        ),
      BACKGROUND,
    );
    await eventually(
      () => first.harness.snapshot(NativeThreadDoc, container.id, BACKGROUND),
      (doc) => doc?.events.includes("task-begin:slow") === true,
      "task start",
    );
    await first.close();

    const second = await track(openSpikeWorld({ directory, setup: first.setup, counters: first.counters }));
    const done = await second.harness.waitForTask(taskId, BACKGROUND);
    expect(done.state.outcome).toEqual({ status: "completed", result: { label: "slow" } });
    const doc = await second.harness.snapshot(NativeThreadDoc, container.id, BACKGROUND);
    expect(doc?.events.filter((event) => event === "task-done:slow")).toHaveLength(1);
    expectNoPiWork(second, first.counters);
  });
});

describe("passive container: observation", () => {
  it("shows entry appends via the Tau watcher, custom doc changes only via document observers", async () => {
    const world = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(world, {
      title: "Native thread",
      sessionId: "s4",
      now: 1,
    });
    const id = idOf(container.id);

    const watched: Op[][] = [];
    const watcher = await world.store.watch(id, async (ops) => {
      watched.push([...ops]);
    });
    const publications: CommitPublication[] = [];
    const unsubscribe = world.harness.subscribeCommits((publication) => publications.push(publication));
    const docWatch = await world.harness.watchDoc(NativeThreadDoc, container.id, BACKGROUND);
    const docOps: Op[][] = [];
    docWatch?.start(async (_value, ops) => {
      docOps.push([...ops]);
    });

    const firstFrame = watched[0]?.[0] as unknown as [
      string,
      { docs: Record<string, unknown>; entries: unknown[] },
    ];
    expect(firstFrame[0]).toBe("r");
    const initialDocKinds = Object.keys(firstFrame[1].docs);
    expect(initialDocKinds).not.toContain(NATIVE_DOC_KIND);
    const liveInView = (firstFrame[1].docs as Record<string, { run?: unknown }>)["pi.live"];
    expect(liveInView?.run).toBeUndefined();

    await appendNativeEvent(world.harness, container.id, "observed");
    await (
      await container.submit(
        { type: "write", entry: { kind: NATIVE_ENTRY_KIND, data: { n: 2 } } },
        BACKGROUND,
      )
    ).wait(BACKGROUND);
    await eventually(
      async () => watched.length,
      (count) => count >= 2,
      "watcher ops",
    );
    await eventually(
      async () => docOps.length,
      (count) => count >= 1,
      "doc ops",
    );
    unsubscribe();

    const watchedJson = JSON.stringify(watched.slice(1));
    expect(watchedJson).toContain(NATIVE_ENTRY_KIND);
    expect(watchedJson).not.toContain("observed");
    expect(watchedJson).not.toContain(NATIVE_DOC_KIND);

    expect(JSON.stringify(docOps)).toContain("observed");
    const nativeDocChanges = publications.flatMap((publication) =>
      publication.changes.filter(
        (change) => change.type === "document" && change.record.kind === NATIVE_DOC_KIND,
      ),
    );
    expect(nativeDocChanges.length).toBeGreaterThan(0);
    const liveChanges = publications.flatMap((publication) =>
      publication.changes.filter((change) => change.type === "document" && change.record.kind === "pi.live"),
    );
    expect(liveChanges).toHaveLength(0);

    const live = await world.harness
      .snapshot(LiveDoc, container.id, BACKGROUND)
      .catch((error) => `throws:${error}`);
    expect(live === undefined || typeof live === "object").toBe(true);
    expect(await isBusy(world.harness, container.id)).toBe(false);
    await docWatch?.stop();
    await watcher.stop();
    expectNoPiWork(world);
  });
});

describe("passive container: ownership", () => {
  it("does not exclude a second harness on the same sqlite file; the data-home lock does", async () => {
    const first = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(first, {
      title: "Native thread",
      sessionId: "s5",
      now: 1,
    });
    const second = await track(openSpikeWorld({ directory }));
    const seen = await second.harness.conversation(container.id, BACKGROUND);
    expect(seen?.id).toBe(container.id);

    const lockFile = join(directory, "lock");
    const lock = await acquireHomeLock(lockFile);
    await expect(acquireHomeLock(lockFile)).rejects.toBeInstanceOf(HomeLockedError);
    await lock.release();
  });
});

describe("passive container: accidental user send", () => {
  it("admits the send on a model-less container: pi.user entry, a failed pi.generation, zero model calls", async () => {
    const world = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(world, {
      title: "Native thread",
      sessionId: "s6",
      now: 1,
    });
    const receipt = await world.store.send(idOf(container.id), { text: "accidental", requestId: "r1" }, 2);
    expect(receipt.admitted).toBe(true);
    await eventually(
      () => piTaskKinds(world),
      (kinds) => kinds.includes("pi.generation"),
      "the generation task",
    );
    await world.harness.waitForIdle(BACKGROUND);
    const generation = (
      await world.harness.commit((tx) => tx.scanTasks({ kind: "pi.generation" }, 10), BACKGROUND)
    ).items[0];
    expect(generation?.state).toMatchObject({
      status: "terminal",
      outcome: { status: "failed", error: { detail: { reason: "no_model" } } },
    });
    const { entries } = await container.context(BACKGROUND);
    expect(entries.map((entry) => entry.kind)).toEqual(["pi.user"]);
    expect(world.counters.modelCalls()).toBe(0);
    expect(world.counters.toolExecutions).toBe(0);
    const summary = (await world.store.list(world.project.id))[0];
    expect(summary?.title).toBe("Native thread");
    await eventually(
      async (): Promise<number | null | undefined> =>
        (await world.store.list(world.project.id))[0]?.lastRunEndedAt,
      (ended) => typeof ended === "number",
      "lastRunEndedAt",
    );
    expect((await world.store.list(world.project.id))[0]?.status).toBe("idle");
  });

  it("calls the model when the container carries one: the send path does not refuse it", async () => {
    const world = await track(openSpikeWorld({ directory }));
    const container = await createPassiveContainer(world, {
      title: "Native thread",
      sessionId: "s7",
      now: 1,
    });
    await world.store.configure(idOf(container.id), {
      model: { provider: "faux", modelId: "faux-1" },
      thinkingLevel: "off",
    });
    expect(world.counters.modelCalls()).toBe(0);
    await world.store.send(idOf(container.id), { text: "accidental", requestId: "r2" }, 2);
    await eventually(
      async () => world.counters.modelCalls(),
      (calls) => calls >= 1,
      "a model call",
    );
    await world.harness.waitForIdle(BACKGROUND);
    expect(world.counters.modelCalls()).toBeGreaterThanOrEqual(1);
    const { entries } = await container.context(BACKGROUND);
    expect(entries.map((entry) => entry.kind)).toContain("pi.assistant");
  });
});
