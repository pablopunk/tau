import {
  type ConversationView,
  nextViewState,
  readRuntimeLive,
  transcriptOf,
  type ViewState,
  waitOutcomeOf,
} from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { legacyWorkspace } from "./conversation-index";
import { createNativeConversation } from "./conversation-native";
import { createConversationStore } from "./conversation-store";
import { createRuntimeStore, type RuntimeStore } from "./runtime-store";
import { modelCallsOf, openRuntimeWorld, type RuntimeWorld } from "./runtime-store-fixture";

const tempDir = useTempDir();
const open: RuntimeWorld[] = [];
const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop().catch(() => undefined)));
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually<T>(read: () => T, done: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(15);
  }
}

async function openWatchedNativeThread() {
  const directory = await tempDir();
  const world = await openRuntimeWorld(directory);
  open.push(world);
  const { summary } = await createNativeConversation(world.harness, {
    project: { id: "p1", path: directory },
    input: { text: "read a.ts", requestId: "start" },
    workspace: legacyWorkspace(directory),
    now: 1,
  });
  const conversations = createConversationStore(world.harness, async () => directory);
  let view: ViewState;
  const watcher = await conversations.watch(summary.id, async (ops) => {
    view = nextViewState(view, ops);
  });
  stops.push(() => watcher.stop());
  const store = createRuntimeStore(world.harness, summary.id);
  const viewWith = (count: number) =>
    eventually(
      () => view as ConversationView | null | undefined,
      (current) => (current?.entries ?? []).length >= count,
      `${count} entries in the watched view`,
    ) as Promise<ConversationView>;
  return { world, store, viewWith };
}

const text = (key: string, messageId: string, body: string) =>
  ({ type: "assistant-text", key, messageId, partIndex: 0, text: body }) as const;

async function runOneTurn(store: RuntimeStore) {
  await store.admit({
    threadId: store.threadId,
    requestId: "r1",
    payload: { text: "read a.ts", attachmentIds: [], origin: "user", delivery: "queue" },
  });
  for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
  await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
  await store.markDeliveredOnce("r1");
  await store.markDelivered("r1");
  await store.setLifecycle("running");
  await store.appendEvent({ type: "session", key: "s1:init", sessionId: "s1" });
  await store.appendEvent(text("t1", "m1", "reading"));
  await store.appendEvent({
    type: "tool-call",
    key: "c1",
    callId: "call-1",
    name: "Read",
    input: { path: "a.ts" },
  });
  await store.appendEvent({
    type: "tool-result",
    key: "res1",
    callId: "call-1",
    isError: false,
    text: "export const a = 1;",
    imageCount: 0,
  });
  await store.appendEvent(text("t2", "m2", "done"));
  await store.appendEvent({ type: "result", key: "r", subtype: "success", isError: false, sessionId: "s1" });
  await store.settle("completed");
}

describe("native thread projections from the watched entries only", () => {
  it("shows the queue and lifecycle after admission with no custom doc in the view", async () => {
    const { store, viewWith, world } = await openWatchedNativeThread();
    await store.admit({
      threadId: store.threadId,
      requestId: "r1",
      payload: { text: "hello", attachmentIds: [], origin: "user", delivery: "queue" },
    });
    const view = await viewWith(3);
    expect(Object.keys(view.docs).filter((kind) => kind.startsWith("native."))).toEqual([]);
    expect(view.entries.map((entry) => entry.kind)).toEqual(["native.event", "native.event", "native.event"]);
    const live = readRuntimeLive(view, "claude-code");
    expect(live).toMatchObject({ lifecycle: "accepted", writer: "running", busy: false });
    expect(live.queued).toEqual([
      { id: 1, mode: "followUp", entryKind: "native.user", text: "hello", images: [] },
    ]);
    expect(transcriptOf(view).items).toMatchObject([{ kind: "user", text: "hello" }]);
    expect(modelCallsOf(world.setup)).toBe(0);
  });

  it("derives busy, then the whole transcript and a settled writer, after one full turn", async () => {
    const { store, viewWith, world } = await openWatchedNativeThread();
    await runOneTurn(store);
    const view = await viewWith(15);

    const live = readRuntimeLive(view, "claude-code");
    expect(live).toMatchObject({ lifecycle: "completed", writer: "settled", busy: false, queued: [] });
    expect(waitOutcomeOf(live)).toBe("done");

    const { items, results } = transcriptOf(view);
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "assistant"]);
    expect(items[0]).toMatchObject({ kind: "user", text: "read a.ts", images: [] });
    expect(items[1]?.kind === "assistant" && items[1].message.content).toEqual([
      { type: "text", text: "reading" },
      { type: "toolCall", id: "call-1", name: "Read", arguments: { path: "a.ts" } },
    ]);
    expect(items[2]?.kind === "assistant" && items[2].message.content).toEqual([
      { type: "text", text: "done" },
    ]);
    expect(results.get("call-1")?.message).toMatchObject({
      toolName: "Read",
      isError: false,
      content: [{ type: "text", text: "export const a = 1;" }],
    });
    expect(modelCallsOf(world.setup)).toBe(0);
  });

  it("shows a running thread as busy with an empty queue once its request is delivered", async () => {
    const { store, viewWith } = await openWatchedNativeThread();
    await store.admit({
      threadId: store.threadId,
      requestId: "r1",
      payload: { text: "go", attachmentIds: [], origin: "user", delivery: "queue" },
    });
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    await store.markDeliveredOnce("r1");
    await store.markDelivered("r1");
    await store.setLifecycle("running");
    const live = readRuntimeLive(await viewWith(8), "claude-code");
    expect(live).toMatchObject({ lifecycle: "running", writer: "running", busy: true, queued: [] });
    expect(waitOutcomeOf(live)).toBe("pending");
  });

  it("keeps an unknown outcome unknown and never done", async () => {
    const { store, viewWith } = await openWatchedNativeThread();
    await store.admit({
      threadId: store.threadId,
      requestId: "r1",
      payload: { text: "go", attachmentIds: [], origin: "user", delivery: "queue" },
    });
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    await store.settle("outcome-unknown", "gone");
    const live = readRuntimeLive(await viewWith(7), "claude-code");
    expect(live).toMatchObject({ lifecycle: "outcome-unknown", writer: "unknown" });
    expect(waitOutcomeOf(live)).toBe("unknown");
  });
});
