import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeEvent } from "../runtimes/native/events";
import type { AdmitRequest, RuntimePayload } from "../runtimes/types";
import { useTempDir } from "../test-support/temp-dir";
import { fingerprintOf } from "./runtime-docs";
import { createRuntimeStore } from "./runtime-store";
import {
  createPassiveThread,
  modelCallsOf,
  openRuntimeWorld,
  type RuntimeWorld,
} from "./runtime-store-fixture";

const tempDir = useTempDir();
let directory: string;
const open: RuntimeWorld[] = [];

const track = async (world: Promise<RuntimeWorld>) => {
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

const payloadOf = (overrides: Partial<RuntimePayload> = {}): RuntimePayload => ({
  text: "hello",
  attachmentIds: [],
  origin: "user",
  delivery: "queue",
  ...overrides,
});

const requestOf = (
  threadId: string,
  requestId: string,
  overrides: Partial<RuntimePayload> = {},
): AdmitRequest => ({
  threadId,
  requestId,
  payload: payloadOf(overrides),
});

async function newStore() {
  const world = await track(openRuntimeWorld(directory));
  const threadId = await createPassiveThread(world);
  return { world, threadId, store: createRuntimeStore(world.harness, threadId) };
}

describe("fingerprintOf", () => {
  it("is stable, order-sensitive for attachments and sensitive to every field", () => {
    const base = payloadOf({ attachmentIds: ["a", "b"] });
    expect(fingerprintOf(base)).toBe(fingerprintOf({ ...base, attachmentIds: ["a", "b"] }));
    expect(fingerprintOf(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, attachmentIds: ["b", "a"] }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, text: "other" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, origin: "timer" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, delivery: "send-now" }));
  });
});

describe("runtime store admission", () => {
  it("admits a new request with a deterministic fingerprinted receipt", async () => {
    const { store, threadId } = await newStore();
    const receipt = await store.admit(requestOf(threadId, "r1", { text: "first" }));
    expect(receipt).toMatchObject({
      receiptId: `${threadId}:0:1`,
      threadId,
      requestId: "r1",
      executor: "claude-code",
      epoch: 0,
      payloadIdentity: "fingerprinted",
      payloadFingerprint: fingerprintOf(payloadOf({ text: "first" })),
    });
    const second = await store.admit(requestOf(threadId, "r2"));
    expect(second.receiptId).toBe(`${threadId}:0:2`);
    expect((await store.inspect()).lifecycle).toBe("accepted");
    expect((await store.pending()).map((item) => item.requestId)).toEqual(["r1", "r2"]);
  });

  it("returns the original receipt for an identical retry without a new item or revision", async () => {
    const { store, threadId } = await newStore();
    const first = await store.admit(requestOf(threadId, "r1", { attachmentIds: ["a", "b"] }));
    const before = await store.inspect();
    const retry = await store.admit(requestOf(threadId, "r1", { attachmentIds: ["a", "b"] }));
    expect(retry).toEqual(first);
    expect(await store.inspect()).toEqual(before);
    expect(await store.pending()).toHaveLength(1);
  });

  it("keeps the original receipt after an epoch bump", async () => {
    const { store, threadId } = await newStore();
    const first = await store.admit(requestOf(threadId, "r1"));
    expect(await store.bumpEpoch()).toBe(1);
    expect(await store.admit(requestOf(threadId, "r1"))).toEqual(first);
    const later = await store.admit(requestOf(threadId, "r2"));
    expect(later).toMatchObject({ epoch: 1, receiptId: `${threadId}:1:2` });
  });

  it("rejects a different payload under the same request id and leaves the original untouched", async () => {
    const { store, threadId } = await newStore();
    const first = await store.admit(requestOf(threadId, "r1", { text: "original" }));
    const before = await store.inspect();
    await expect(store.admit(requestOf(threadId, "r1", { text: "changed" }))).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      store.admit(requestOf(threadId, "r1", { text: "original", attachmentIds: ["x"] })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await store.inspect()).toEqual(before);
    expect((await store.pending()).map((item) => item.text)).toEqual(["original"]);
    expect(await store.admit(requestOf(threadId, "r1", { text: "original" }))).toEqual(first);
  });

  it("rejects steer before any write", async () => {
    const { store, threadId } = await newStore();
    const before = await store.inspect();
    await expect(store.admit(requestOf(threadId, "r1", { delivery: "steer" }))).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await store.inspect()).toEqual(before);
    expect(before.lifecycle).toBeUndefined();
    expect(await store.pending()).toEqual([]);
  });

  it("admits one item when ten concurrent admits carry the same request", async () => {
    const { store, threadId } = await newStore();
    const receipts = await Promise.all(
      Array.from({ length: 10 }, () => store.admit(requestOf(threadId, "same"))),
    );
    expect(new Set(receipts.map((receipt) => receipt.receiptId)).size).toBe(1);
    expect(await store.pending()).toHaveLength(1);
    expect((await store.inspect()).cursorRevision).toBe(1);
  });

  it("admits ten concurrent distinct requests with unique receipts", async () => {
    const { store, threadId } = await newStore();
    const receipts = await Promise.all(
      Array.from({ length: 10 }, (_, index) => store.admit(requestOf(threadId, `r${index}`))),
    );
    expect(new Set(receipts.map((receipt) => receipt.receiptId)).size).toBe(10);
    expect(await store.pending()).toHaveLength(10);
  });

  it("stores attachment ids as given and counts queued items as unresolved", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1", { attachmentIds: ["b", "a"] }));
    await store.admit(requestOf(threadId, "r2"));
    expect((await store.pending())[0]?.attachmentIds).toEqual(["b", "a"]);
    expect((await store.inspect()).unresolved).toBe(2);
  });
});

describe("runtime store dispositions", () => {
  it("marks delivered and cancels queued items, idempotently, each as one revision", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    await store.admit(requestOf(threadId, "r2"));
    await store.markDelivered("r1");
    await store.markDelivered("r1");
    await store.cancelQueued("r2");
    await store.cancelQueued("r2");
    expect(await store.pending()).toEqual([]);
    expect(await store.inspect()).toMatchObject({ unresolved: 0, cursorRevision: 4 });
    await expect(store.cancelQueued("r1")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.markDelivered("r2")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.markDelivered("missing")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("runtime store lifecycle", () => {
  it("walks a legal path and settles once", async () => {
    const { store } = await newStore();
    for (const step of ["accepted", "preparing", "ready", "starting", "running", "completed"] as const) {
      await store.setLifecycle(step);
      expect((await store.inspect()).lifecycle).toBe(step);
    }
    await expect(store.setLifecycle("failed")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await store.inspect()).lifecycle).toBe("completed");
  });

  it("rejects illegal transitions without a write", async () => {
    const { store } = await newStore();
    await expect(store.setLifecycle("running")).rejects.toMatchObject({ code: "invalid_request" });
    await store.setLifecycle("accepted");
    const before = await store.inspect();
    await expect(store.setLifecycle("running")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.setLifecycle("accepted")).rejects.toMatchObject({ code: "invalid_request" });
    expect(await store.inspect()).toEqual(before);
  });

  it("records a cancel intent once per operation and settles it", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    expect(await store.recordCancel("op")).toBe("stopping");
    expect(await store.recordCancel("op")).toBe("stopping");
    expect((await store.inspect()).cancelsInFlight).toBe(1);
    await store.settleCancels();
    expect(await store.recordCancel("op")).toBe("stopped");
    expect(await store.inspect()).toMatchObject({ lifecycle: "cancelled", cancelsInFlight: 0 });
  });
});

describe("runtime store restart", () => {
  it("keeps items, receipts, epoch, lifecycle, revision and cancels on the same sqlite file", async () => {
    const first = await track(openRuntimeWorld(directory));
    const threadId = await createPassiveThread(first);
    const store = createRuntimeStore(first.harness, threadId);
    const receipt = await store.admit(requestOf(threadId, "r1", { attachmentIds: ["a"] }));
    await store.admit(requestOf(threadId, "r2"));
    await store.markDelivered("r2");
    await store.bumpEpoch();
    await store.setLifecycle("preparing");
    await store.recordCancel("op");
    const before = await store.inspect();
    const frames = await store.window();
    await first.close();

    const second = await track(openRuntimeWorld(directory, first.setup));
    const reopened = createRuntimeStore(second.harness, threadId);
    expect(await reopened.inspect()).toEqual(before);
    expect(await reopened.window()).toEqual(frames);
    expect(await reopened.admit(requestOf(threadId, "r1", { attachmentIds: ["a"] }))).toEqual(receipt);
    await expect(
      reopened.admit(requestOf(threadId, "r1", { attachmentIds: ["a"], text: "changed" })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect((await reopened.pending()).map((item) => item.requestId)).toEqual(["r1"]);
    expect(await reopened.recordCancel("op")).toBe("stopping");
    expect(await reopened.inspect()).toEqual(before);
    expect(modelCallsOf(first.setup)).toBe(0);
  });
});

const identityOf = (nonce = "n1") => ({ pid: 4242, startTime: 1_700_000_000, nonce, pgid: 4242 });

const textEvent = (key: string, text = "hi"): NativeEvent => ({
  type: "assistant-text",
  key,
  messageId: "m1",
  partIndex: 0,
  text,
});

async function launchedStore() {
  const context = await newStore();
  for (const step of ["accepted", "preparing", "ready"] as const) await context.store.setLifecycle(step);
  await context.store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
  return context;
}

describe("runtime store launch intent", () => {
  it("moves ready to starting and records the operation as one revision", async () => {
    const { store } = await newStore();
    for (const step of ["accepted", "preparing", "ready"] as const) await store.setLifecycle(step);
    const before = (await store.inspect()).cursorRevision;
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    const state = await store.operationState();
    expect(state.lifecycle).toBe("starting");
    expect(state.operation).toMatchObject({ operationId: "op1", nonce: "n1" });
    expect(state.operation?.launchIntentAt).toBeGreaterThan(0);
    expect(state.operation?.terminal).toBeUndefined();
    expect((await store.inspect()).cursorRevision).toBe(before + 1);
  });

  it("rejects any lifecycle other than ready without a write", async () => {
    const { store } = await newStore();
    await expect(store.recordLaunchIntent({ operationId: "op1", nonce: "n1" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await store.setLifecycle("accepted");
    await store.setLifecycle("preparing");
    const before = await store.inspect();
    await expect(store.recordLaunchIntent({ operationId: "op1", nonce: "n1" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await store.inspect()).toEqual(before);
    expect((await store.operationState()).operation).toBeUndefined();
  });

  it("rejects a second launch while the first operation is unresolved", async () => {
    const { store } = await launchedStore();
    const before = await store.operationState();
    await expect(store.recordLaunchIntent({ operationId: "op2", nonce: "n2" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(store.recordLaunchIntent({ operationId: "op1", nonce: "n1" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await store.operationState()).toEqual(before);
  });

  it("rejects an empty operation id or nonce", async () => {
    const { store } = await newStore();
    await expect(store.recordLaunchIntent({ operationId: "", nonce: "n" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(store.recordLaunchIntent({ operationId: "op", nonce: "" })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("runtime store operation records", () => {
  it("records the identity once, idempotently, and only for the launch nonce", async () => {
    const { store } = await launchedStore();
    await expect(store.recordIdentity(identityOf("other"))).rejects.toMatchObject({
      code: "invalid_request",
    });
    await store.recordIdentity(identityOf());
    const revision = (await store.inspect()).cursorRevision;
    await store.recordIdentity(identityOf());
    expect((await store.inspect()).cursorRevision).toBe(revision);
    await expect(store.recordIdentity({ ...identityOf(), pid: 1 })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect((await store.operationState()).operation?.identity).toEqual(identityOf());
  });

  it("rejects identity, session and delivery before any launch intent", async () => {
    const { store } = await newStore();
    await expect(store.recordIdentity(identityOf())).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.recordSession("s1")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.markDeliveredOnce("r1")).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("records the session idempotently and rejects a conflicting id", async () => {
    const { store } = await launchedStore();
    await store.recordSession("s1");
    const revision = (await store.inspect()).cursorRevision;
    await store.recordSession("s1");
    expect((await store.inspect()).cursorRevision).toBe(revision);
    await expect(store.recordSession("s2")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await store.operationState()).operation?.sessionId).toBe("s1");
  });

  it("marks one request delivered, idempotently", async () => {
    const { store } = await launchedStore();
    await store.markDeliveredOnce("r1");
    const revision = (await store.inspect()).cursorRevision;
    await store.markDeliveredOnce("r1");
    expect((await store.inspect()).cursorRevision).toBe(revision);
    await expect(store.markDeliveredOnce("r2")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await store.operationState()).operation?.deliveredRequestId).toBe("r1");
  });
});

describe("runtime store events", () => {
  it("writes the event entry and one projection frame in the same commit", async () => {
    const { store } = await launchedStore();
    const before = (await store.inspect()).cursorRevision;
    const { revision } = await store.appendEvent(textEvent("k1"));
    expect(revision).toBe(before + 1);
    expect((await store.window()).cursor.revision).toBe(revision);
    expect(await store.events()).toEqual([{ revision, key: "k1", event: textEvent("k1") }]);
  });

  it("dedupes by key, never by text", async () => {
    const { store } = await launchedStore();
    const first = await store.appendEvent(textEvent("k1", "same"));
    const retry = await store.appendEvent(textEvent("k1", "different"));
    const sameText = await store.appendEvent(textEvent("k2", "same"));
    expect(retry).toEqual(first);
    expect(sameText.revision).toBe(first.revision + 1);
    expect((await store.events()).map((entry) => entry.key)).toEqual(["k1", "k2"]);
    expect((await store.events())[0]?.event).toEqual(textEvent("k1", "same"));
  });

  it("dedupes ten concurrent appends of one key and keeps distinct keys ordered", async () => {
    const { store } = await launchedStore();
    const before = (await store.inspect()).cursorRevision;
    const same = await Promise.all(Array.from({ length: 10 }, () => store.appendEvent(textEvent("dup"))));
    expect(new Set(same.map((result) => result.revision))).toEqual(new Set([before + 1]));
    const distinct = await Promise.all(
      Array.from({ length: 10 }, (_, index) => store.appendEvent(textEvent(`k${index}`))),
    );
    expect(new Set(distinct.map((result) => result.revision)).size).toBe(10);
    expect((await store.events()).length).toBe(11);
    expect((await store.inspect()).cursorRevision).toBe(before + 11);
  });

  it("round-trips tool-call input and result events", async () => {
    const { store } = await launchedStore();
    const call: NativeEvent = {
      type: "tool-call",
      key: "c",
      callId: "c1",
      name: "Read",
      input: { file: "a", n: [1, null] },
    };
    const result: NativeEvent = {
      type: "result",
      key: "r",
      subtype: "success",
      isError: false,
      sessionId: "s1",
    };
    await store.appendEvent(call);
    await store.appendEvent(result);
    expect((await store.events()).map((entry) => entry.event)).toEqual([call, result]);
  });
});

describe("runtime store settle", () => {
  it("settles once with a reason and rejects every later settle", async () => {
    const { store } = await launchedStore();
    await store.settle("completed", "all good");
    const state = await store.operationState();
    expect(state.lifecycle).toBe("completed");
    expect(state.operation?.terminal).toMatchObject({ lifecycle: "completed", reason: "all good" });
    expect(state.operation?.terminal?.at).toBeGreaterThan(0);
    for (const outcome of ["completed", "failed", "cancelled", "interrupted", "outcome-unknown"] as const) {
      await expect(store.settle(outcome)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(await store.operationState()).toEqual(state);
  });

  it("never turns cancelled into completed", async () => {
    const { store } = await launchedStore();
    await store.settle("cancelled");
    await expect(store.settle("completed")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await store.operationState()).operation?.terminal?.lifecycle).toBe("cancelled");
  });

  it("refuses completed while a cancel is in flight but accepts cancelled", async () => {
    const { store } = await launchedStore();
    await store.recordCancel("cancel-1");
    expect((await store.inspect()).lifecycle).toBe("cancelling");
    await expect(store.settle("completed")).rejects.toMatchObject({ code: "invalid_request" });
    await store.settle("cancelled");
    expect((await store.operationState()).lifecycle).toBe("cancelled");
  });

  it("freezes the operation record after settle", async () => {
    const { store } = await launchedStore();
    await store.settle("failed", "boom");
    await expect(store.recordIdentity(identityOf())).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.recordSession("s1")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.markDeliveredOnce("r1")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(store.recordLaunchIntent({ operationId: "op2", nonce: "n2" })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects settle with no operation and leaves the lifecycle alone", async () => {
    const { store } = await newStore();
    await store.setLifecycle("accepted");
    await expect(store.settle("failed")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await store.inspect()).lifecycle).toBe("accepted");
  });

  it("records the terminal outcome when the cancel path settles the thread", async () => {
    const { store } = await launchedStore();
    await store.recordCancel("cancel-1");
    await store.settleCancels();
    expect((await store.operationState()).operation?.terminal).toMatchObject({ lifecycle: "cancelled" });
    await expect(store.settle("completed")).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("runtime store native operation restart", () => {
  it("keeps the operation, events and terminal on the same sqlite file", async () => {
    const first = await track(openRuntimeWorld(directory));
    const threadId = await createPassiveThread(first);
    const store = createRuntimeStore(first.harness, threadId);
    for (const step of ["accepted", "preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    await store.recordIdentity(identityOf());
    await store.recordSession("s1");
    await store.markDeliveredOnce("r1");
    const appended = await store.appendEvent(textEvent("k1"));
    const midway = await store.operationState();
    const frames = await store.window();
    await first.close();

    const second = await track(openRuntimeWorld(directory, first.setup));
    const reopened = createRuntimeStore(second.harness, threadId);
    expect(await reopened.operationState()).toEqual(midway);
    expect(await reopened.window()).toEqual(frames);
    expect(await reopened.appendEvent(textEvent("k1"))).toEqual(appended);
    await expect(reopened.recordLaunchIntent({ operationId: "op2", nonce: "n2" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await reopened.settle("interrupted", "restart");
    await second.close();

    const third = await track(openRuntimeWorld(directory, first.setup));
    const final = createRuntimeStore(third.harness, threadId);
    const state = await final.operationState();
    expect(state.operation?.terminal).toMatchObject({ lifecycle: "interrupted", reason: "restart" });
    expect(state.operation).toMatchObject({
      sessionId: "s1",
      deliveredRequestId: "r1",
      identity: identityOf(),
    });
    await expect(final.settle("completed")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await final.events()).map((entry) => entry.key)).toEqual(["k1"]);
    expect(modelCallsOf(first.setup)).toBe(0);
  });
});
