import type { CommitPublication, ConversationId } from "@earendil-works/pi-durable";
import { type NativeEvent, nativeEventOf } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { BACKGROUND } from "./open";
import { createRuntimeStore } from "./runtime-store";
import { createPassiveThread, openRuntimeWorld, type RuntimeWorld } from "./runtime-store-fixture";

const tempDir = useTempDir();
const open: RuntimeWorld[] = [];
let directory: string;

beforeEach(async () => {
  directory = await tempDir();
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

async function newStore() {
  const world = await openRuntimeWorld(directory);
  open.push(world);
  const threadId = await createPassiveThread(world);
  return { world, threadId, store: createRuntimeStore(world.harness, threadId) };
}

type Rig = Awaited<ReturnType<typeof newStore>>;

const admitRequest = (rig: Rig, requestId: string, text = `text of ${requestId}`) =>
  rig.store.admit({
    threadId: rig.threadId,
    requestId,
    payload: { text, attachmentIds: ["a"], origin: "user", delivery: "queue" },
  });

async function entryEvents(rig: Rig): Promise<NativeEvent[]> {
  const conversation = await rig.world.harness.conversation(
    Number(rig.threadId) as ConversationId,
    BACKGROUND,
  );
  const { entries } = await (conversation as NonNullable<typeof conversation>).context(BACKGROUND);
  return entries.flatMap((entry) => nativeEventOf(entry) ?? []);
}

function brief(event: NativeEvent): string {
  if (event.type === "lifecycle") return `lifecycle:${event.lifecycle}:${event.operationId ?? "-"}`;
  if (event.type === "queue") return `queue:${event.requestId}:${event.disposition}`;
  if (event.type === "user") return `user:${event.requestId}`;
  return event.type;
}

async function appendedBy(rig: Rig, action: () => Promise<unknown>): Promise<string[]> {
  const before = (await entryEvents(rig)).length;
  await action();
  return (await entryEvents(rig)).slice(before).map(brief);
}

const nativeEntriesOf = (publication: CommitPublication): NativeEvent[] =>
  publication.changes.flatMap((change) =>
    change.type === "entry" ? (nativeEventOf(change.value) ?? []) : [],
  );

const touchesProjection = (publication: CommitPublication): boolean =>
  publication.changes.some(
    (change) => change.type === "document" && change.record.kind === "native.projection",
  );

async function publicationsDuring(rig: Rig, action: () => Promise<unknown>): Promise<CommitPublication[]> {
  const seen: CommitPublication[] = [];
  const stop = rig.world.harness.subscribeCommits((publication) => seen.push(publication));
  await action();
  stop();
  return seen;
}

async function expectOneAtomicCommit(rig: Rig, action: () => Promise<unknown>, expected: string[]) {
  const carrying = (await publicationsDuring(rig, action)).filter((p) => nativeEntriesOf(p).length > 0);
  expect(carrying).toHaveLength(1);
  const [commit] = carrying as [CommitPublication];
  expect(touchesProjection(commit)).toBe(true);
  expect(nativeEntriesOf(commit).map(brief).sort()).toEqual([...expected].sort());
}

async function launched(rig: Rig) {
  await admitRequest(rig, "r1");
  for (const step of ["preparing", "ready"] as const) await rig.store.setLifecycle(step);
  await rig.store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
}

describe("runtime store appends the events of every state change", () => {
  it("admit appends lifecycle accepted once, then user and queued for each new request", async () => {
    const rig = await newStore();
    expect(await appendedBy(rig, () => admitRequest(rig, "r1", "hello"))).toEqual([
      "lifecycle:accepted:-",
      "user:r1",
      "queue:r1:queued",
    ]);
    expect(await appendedBy(rig, () => admitRequest(rig, "r2"))).toEqual(["user:r2", "queue:r2:queued"]);
    const events = await entryEvents(rig);
    expect(events.find((event) => event.type === "user")).toEqual({
      type: "user",
      key: "r1:user",
      requestId: "r1",
      receiptId: `${rig.threadId}:0:1`,
      text: "hello",
      delivery: "queue",
      attachmentCount: 1,
    });
    expect(events.find((event) => event.type === "queue")).toMatchObject({ key: "r1:queued" });
  });

  it("appends nothing for a duplicate admit, a conflicting payload or a refused steer", async () => {
    const rig = await newStore();
    await admitRequest(rig, "r1", "same");
    const before = await entryEvents(rig);
    await admitRequest(rig, "r1", "same");
    await expect(admitRequest(rig, "r1", "different")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      rig.store.admit({
        threadId: rig.threadId,
        requestId: "r2",
        payload: { text: "x", attachmentIds: [], origin: "user", delivery: "steer" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await entryEvents(rig)).toEqual(before);
  });

  it("marks delivery and cancellation as queue events, once each", async () => {
    const rig = await newStore();
    for (const requestId of ["r1", "r2"]) await admitRequest(rig, requestId);
    expect(await appendedBy(rig, () => rig.store.markDelivered("r1"))).toEqual(["queue:r1:delivered"]);
    expect(await appendedBy(rig, () => rig.store.markDelivered("r1"))).toEqual([]);
    expect(await appendedBy(rig, () => rig.store.cancelQueued("r2"))).toEqual(["queue:r2:cancelled"]);
    expect(await appendedBy(rig, () => rig.store.cancelQueued("r2"))).toEqual([]);
    await expect(rig.store.cancelQueued("r1")).rejects.toMatchObject({ code: "invalid_request" });
    expect(await appendedBy(rig, async () => undefined)).toEqual([]);
  });

  it("announces delivery once whichever of markDeliveredOnce and markDelivered runs first", async () => {
    const rig = await newStore();
    await launched(rig);
    expect(await appendedBy(rig, () => rig.store.markDeliveredOnce("r1"))).toEqual(["queue:r1:delivered"]);
    expect(await appendedBy(rig, () => rig.store.markDeliveredOnce("r1"))).toEqual([]);
    expect(await appendedBy(rig, () => rig.store.markDelivered("r1"))).toEqual([]);

    const other = await newStore();
    await launched(other);
    expect(await appendedBy(other, () => other.store.markDelivered("r1"))).toEqual(["queue:r1:delivered"]);
    expect(await appendedBy(other, () => other.store.markDeliveredOnce("r1"))).toEqual([]);
  });

  it("appends one lifecycle event per accepted transition and none for a refused one", async () => {
    const rig = await newStore();
    await admitRequest(rig, "r1");
    expect(await appendedBy(rig, () => rig.store.setLifecycle("preparing"))).toEqual([
      "lifecycle:preparing:-",
    ]);
    expect(await appendedBy(rig, () => rig.store.setLifecycle("ready"))).toEqual(["lifecycle:ready:-"]);
    await expect(rig.store.setLifecycle("running")).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      await appendedBy(rig, () => rig.store.recordLaunchIntent({ operationId: "op1", nonce: "n1" })),
    ).toEqual(["lifecycle:starting:op1"]);
    expect(await appendedBy(rig, () => rig.store.setLifecycle("running"))).toEqual(["lifecycle:running:op1"]);
    expect(await appendedBy(rig, () => rig.store.settle("completed", "fine"))).toEqual([
      "lifecycle:completed:op1",
    ]);
    for (const outcome of ["completed", "failed", "outcome-unknown"] as const) {
      await expect(rig.store.settle(outcome)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(await appendedBy(rig, async () => undefined)).toEqual([]);
    const settled = (await entryEvents(rig)).at(-1);
    expect(settled).toMatchObject({ type: "lifecycle", lifecycle: "completed", reason: "fine" });
  });

  it("records cancelling once and the cancel outcome once", async () => {
    const rig = await newStore();
    await launched(rig);
    expect(await appendedBy(rig, () => rig.store.recordCancel("op1"))).toEqual(["lifecycle:cancelling:op1"]);
    expect(await appendedBy(rig, () => rig.store.recordCancel("op1"))).toEqual([]);
    expect(await appendedBy(rig, () => rig.store.settleCancels("stopped", "user"))).toEqual([
      "lifecycle:cancelled:op1",
    ]);
    expect(await appendedBy(rig, () => rig.store.settleCancels("stopped"))).toEqual([]);
    expect(await appendedBy(rig, () => rig.store.recordCancel("op1"))).toEqual([]);
  });

  it("records a denied cancel without any lifecycle event", async () => {
    const rig = await newStore();
    await launched(rig);
    await rig.store.recordCancel("op1");
    expect(await appendedBy(rig, () => rig.store.settleCancels("denied"))).toEqual([]);
  });

  it("appends accepted when a new operation begins and nothing when it only continues", async () => {
    const rig = await newStore();
    await admitRequest(rig, "r1");
    await rig.store.setLifecycle("preparing");
    await rig.store.setLifecycle("blocked");
    expect(await appendedBy(rig, () => rig.store.beginOperation())).toEqual([]);

    const next = await newStore();
    await launched(next);
    await next.store.settle("failed", "boom");
    expect(await appendedBy(next, () => next.store.beginOperation())).toEqual(["lifecycle:accepted:-"]);
  });

  it("appends a lifecycle event and a notice once when an unknown outcome is acknowledged", async () => {
    const rig = await newStore();
    await launched(rig);
    await rig.store.settle("outcome-unknown", "gone");
    expect(
      await appendedBy(rig, () => rig.store.acknowledgeUnknown({ operationId: "op1", note: "checked" })),
    ).toEqual(["lifecycle:outcome-unknown:op1", "notice"]);
    expect(
      await appendedBy(rig, () => rig.store.acknowledgeUnknown({ operationId: "op1", note: "again" })),
    ).toEqual([]);
    await expect(rig.store.acknowledgeUnknown({ operationId: "op1", note: " " })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await appendedBy(rig, async () => undefined)).toEqual([]);
    const events = await entryEvents(rig);
    expect(events.at(-2)).toMatchObject({ lifecycle: "outcome-unknown", reason: "acknowledged: checked" });
    expect(events.at(-1)).toMatchObject({ type: "notice", code: "outcome-acknowledged" });
  });

  it("appends reconciling only with the restart flag", async () => {
    const rig = await newStore();
    await launched(rig);
    await expect(rig.store.setLifecycle("reconciling")).rejects.toMatchObject({ code: "invalid_request" });
    expect(await appendedBy(rig, () => rig.store.setLifecycle("reconciling", { restart: true }))).toEqual([
      "lifecycle:reconciling:op1",
    ]);
  });

  it("appends an SDK event as an entry once per key and keeps the doc event log to those events", async () => {
    const rig = await newStore();
    await launched(rig);
    const event: NativeEvent = {
      type: "assistant-text",
      key: "k1",
      messageId: "m",
      partIndex: 0,
      text: "hi",
    };
    expect(await appendedBy(rig, () => rig.store.appendEvent(event))).toEqual(["assistant-text"]);
    expect(await appendedBy(rig, () => rig.store.appendEvent({ ...event, text: "other" }))).toEqual([]);
    expect((await rig.store.events()).map((entry) => entry.key)).toEqual(["k1"]);
    expect((await entryEvents(rig)).filter((entry) => entry.type === "assistant-text")).toEqual([event]);
  });

  it("gives every event of a multi-operation run a unique key", async () => {
    const rig = await newStore();
    await admitRequest(rig, "r1");
    for (const [index, requestId] of ["r1", "r2"].entries()) {
      if (index > 0) {
        await rig.store.beginOperation();
        await admitRequest(rig, requestId);
      }
      for (const step of ["preparing", "ready"] as const) await rig.store.setLifecycle(step);
      await rig.store.recordLaunchIntent({ operationId: `op${index}`, nonce: `n${index}` });
      await rig.store.markDeliveredOnce(requestId);
      await rig.store.markDelivered(requestId);
      await rig.store.setLifecycle("running");
      await rig.store.settle("completed");
    }
    const keys = (await entryEvents(rig)).map((event) => event.key);
    expect(keys.length).toBeGreaterThan(15);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("runtime store commits events atomically with the state change", () => {
  it("writes the state and its events in one commit for every mutation", async () => {
    const rig = await newStore();
    await expectOneAtomicCommit(rig, () => admitRequest(rig, "r1"), [
      "lifecycle:accepted:-",
      "user:r1",
      "queue:r1:queued",
    ]);
    await expectOneAtomicCommit(rig, () => rig.store.setLifecycle("preparing"), ["lifecycle:preparing:-"]);
    await rig.store.setLifecycle("ready");
    await expectOneAtomicCommit(
      rig,
      () => rig.store.recordLaunchIntent({ operationId: "op1", nonce: "n1" }),
      ["lifecycle:starting:op1"],
    );
    await expectOneAtomicCommit(rig, () => rig.store.markDeliveredOnce("r1"), ["queue:r1:delivered"]);
    await expectOneAtomicCommit(rig, () => rig.store.recordCancel("op1"), ["lifecycle:cancelling:op1"]);
    await expectOneAtomicCommit(rig, () => rig.store.settleCancels("unknown", "lost"), [
      "lifecycle:outcome-unknown:op1",
    ]);
    await expectOneAtomicCommit(rig, () => rig.store.acknowledgeUnknown({ operationId: "op1", note: "ok" }), [
      "lifecycle:outcome-unknown:op1",
      "notice",
    ]);
    await expectOneAtomicCommit(rig, () => rig.store.beginOperation(), ["lifecycle:accepted:-"]);
  });

  it("writes settle and an SDK event each in one commit", async () => {
    const rig = await newStore();
    await launched(rig);
    const event: NativeEvent = {
      type: "assistant-text",
      key: "k1",
      messageId: "m",
      partIndex: 0,
      text: "hi",
    };
    await expectOneAtomicCommit(rig, () => rig.store.appendEvent(event), ["assistant-text"]);
    await expectOneAtomicCommit(rig, () => rig.store.settle("completed"), ["lifecycle:completed:op1"]);
  });

  it("commits no event entry for an idempotent call", async () => {
    const rig = await newStore();
    await launched(rig);
    await rig.store.markDeliveredOnce("r1");
    const commits = await publicationsDuring(rig, async () => {
      await rig.store.markDeliveredOnce("r1");
      await admitRequest(rig, "r1");
    });
    expect(commits.flatMap(nativeEntriesOf)).toEqual([]);
  });
});
