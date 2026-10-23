import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeEvent } from "../runtimes/native/events";
import type { AdmitRequest, RuntimePayload } from "../runtimes/types";
import { useTempDir } from "../test-support/temp-dir";
import { fingerprintOf } from "./runtime-docs";
import { createRuntimeStore, type RuntimeStore, type SettleOutcome } from "./runtime-store";
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

const TERMINAL_OUTCOMES = ["completed", "failed", "cancelled", "interrupted", "outcome-unknown"] as const;

async function readyStore() {
  const context = await newStore();
  await context.store.admit(requestOf(context.threadId, "r1"));
  for (const step of ["preparing", "ready"] as const) await context.store.setLifecycle(step);
  return context;
}

async function runOperation(store: RuntimeStore, operationId: string, outcome?: SettleOutcome) {
  await store.recordLaunchIntent({ operationId, nonce: `${operationId}-nonce` });
  if (outcome) await store.settle(outcome);
}

async function beginAfter(store: RuntimeStore, operationId: string, outcome: SettleOutcome) {
  await runOperation(store, operationId, outcome);
  await store.beginOperation();
}

describe("runtime store beginOperation", () => {
  it("is a no-op before any launch and while a blocked run waits for a retry", async () => {
    const { store, threadId } = await newStore();
    await store.beginOperation();
    expect((await store.inspect()).lifecycle).toBe("accepted");
    await store.admit(requestOf(threadId, "r1"));
    await store.setLifecycle("preparing");
    await store.setLifecycle("blocked");
    const before = await store.inspect();
    await store.beginOperation();
    expect(await store.inspect()).toEqual(before);
    expect((await store.operationState()).history).toEqual([]);
  });

  it.each(TERMINAL_OUTCOMES.filter((outcome) => outcome !== "outcome-unknown"))(
    "starts a new operation after %s and archives the previous one",
    async (outcome) => {
      const { store } = await readyStore();
      await runOperation(store, "op1", outcome);
      const before = (await store.inspect()).cursorRevision;
      await store.beginOperation();
      const state = await store.operationState();
      expect(state.lifecycle).toBe("accepted");
      expect(state.operation).toBeUndefined();
      expect(state.history).toEqual([{ operationId: "op1", lifecycle: outcome, at: expect.any(Number) }]);
      expect((await store.inspect()).cursorRevision).toBe(before + 1);
      for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
      await store.recordLaunchIntent({ operationId: "op2", nonce: "n2" });
      expect((await store.operationState()).operation?.operationId).toBe("op2");
    },
  );

  it.each(["starting", "running", "cancelling"] as const)(
    "rejects while an operation is unresolved in %s",
    async (lifecycle) => {
      const { store } = await readyStore();
      await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
      if (lifecycle !== "starting") await store.setLifecycle("running");
      if (lifecycle === "cancelling") await store.recordCancel("op1");
      const before = await store.operationState();
      await expect(store.beginOperation()).rejects.toMatchObject({ code: "invalid_request" });
      expect(await store.operationState()).toEqual(before);
    },
  );

  it("rejects after an unacknowledged outcome-unknown and allows it once acknowledged", async () => {
    const { store } = await readyStore();
    await runOperation(store, "op1", "outcome-unknown");
    const before = await store.operationState();
    await expect(store.beginOperation()).rejects.toMatchObject({ code: "invalid_request" });
    expect(await store.operationState()).toEqual(before);

    await store.acknowledgeUnknown({ operationId: "op1", note: "checked the logs" });
    await store.beginOperation();
    const state = await store.operationState();
    expect(state.lifecycle).toBe("accepted");
    expect(state.acknowledgement).toBeUndefined();
    expect(state.history).toEqual([
      {
        operationId: "op1",
        lifecycle: "outcome-unknown",
        at: expect.any(Number),
        acknowledgement: { note: "checked the logs", at: expect.any(Number) },
      },
    ]);
  });

  it("keeps only the last 20 summaries, oldest first out", async () => {
    const { store } = await readyStore();
    for (let index = 1; index <= 23; index += 1) {
      await beginAfter(store, `op${index}`, "completed");
      for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    }
    const { history } = await store.operationState();
    expect(history).toHaveLength(20);
    expect(history[0]?.operationId).toBe("op4");
    expect(history.at(-1)?.operationId).toBe("op23");
  });
});

describe("runtime store acknowledgeUnknown", () => {
  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "is invalid for %s",
    async (outcome) => {
      const { store } = await readyStore();
      await runOperation(store, "op1", outcome);
      await expect(store.acknowledgeUnknown({ operationId: "op1", note: "n" })).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect((await store.operationState()).acknowledgement).toBeUndefined();
    },
  );

  it("is invalid while unresolved, for an unknown operation and with a blank note", async () => {
    const { store } = await readyStore();
    await runOperation(store, "op1");
    await expect(store.acknowledgeUnknown({ operationId: "op1", note: "n" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(store.acknowledgeUnknown({ operationId: "nope", note: "n" })).rejects.toMatchObject({
      code: "not_found",
    });
    await store.settle("outcome-unknown", "gone");
    await expect(store.acknowledgeUnknown({ operationId: "op1", note: "  " })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("records the acknowledgement once and never rewrites the terminal outcome", async () => {
    const { store } = await readyStore();
    await runOperation(store, "op1");
    await store.settle("outcome-unknown", "gone");
    const terminal = (await store.operationState()).operation?.terminal;

    await store.acknowledgeUnknown({ operationId: "op1", note: "first" });
    const revision = (await store.inspect()).cursorRevision;
    await store.acknowledgeUnknown({ operationId: "op1", note: "second" });

    const state = await store.operationState();
    expect(state.operation?.terminal).toEqual(terminal);
    expect(state.operation?.terminal?.lifecycle).toBe("outcome-unknown");
    expect(state.lifecycle).toBe("outcome-unknown");
    expect(state.acknowledgement).toMatchObject({ operationId: "op1", note: "first" });
    expect((await store.inspect()).cursorRevision).toBe(revision);
    await expect(store.settle("completed")).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("runtime store session across operations", () => {
  it("keeps the session id for the thread and rejects a conflicting one in a later operation", async () => {
    const { store } = await readyStore();
    await runOperation(store, "op1");
    await store.recordSession("s1");
    await store.settle("completed");
    await store.beginOperation();
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await runOperation(store, "op2");
    expect((await store.operationState()).sessionId).toBe("s1");
    await expect(store.recordSession("other")).rejects.toMatchObject({ code: "invalid_request" });
    await store.recordSession("s1");
    expect((await store.operationState()).operation?.sessionId).toBe("s1");
  });
});

describe("runtime store cancel outcomes", () => {
  it.each([
    ["stopped", "cancelled", "stopped"],
    ["unknown", "outcome-unknown", "unknown"],
  ] as const)("settles a cancel as %s", async (settlement, lifecycle, record) => {
    const { store } = await launchedStore();
    await store.recordCancel("op1");
    expect((await store.inspect()).cancelsInFlight).toBe(1);
    await store.settleCancels(settlement, "reason");
    expect((await store.inspect()).cancelsInFlight).toBe(0);
    expect(await store.recordCancel("op1")).toBe(record);
    const state = await store.operationState();
    expect(state.lifecycle).toBe(lifecycle);
    expect(state.operation?.terminal).toMatchObject({ lifecycle, reason: "reason" });
  });

  it("settles a denied cancel as a record only", async () => {
    const { store } = await launchedStore();
    await store.recordCancel("op1");
    await store.settleCancels("denied");
    expect((await store.inspect()).cancelsInFlight).toBe(0);
    expect(await store.recordCancel("op1")).toBe("denied");
    expect((await store.operationState()).operation?.terminal).toBeUndefined();
  });

  it("closes an in-flight cancel when the operation settles another way", async () => {
    const { store } = await launchedStore();
    await store.recordCancel("op1");
    await store.settle("outcome-unknown", "gone");
    expect((await store.inspect()).cancelsInFlight).toBe(0);
    expect(await store.recordCancel("op1")).toBe("unknown");
  });
});

describe("runtime store reconciling", () => {
  it("enters reconciling only with the restart flag, from any non-terminal lifecycle", async () => {
    const { store } = await launchedStore();
    await expect(store.setLifecycle("reconciling")).rejects.toMatchObject({ code: "invalid_request" });
    await store.setLifecycle("reconciling", { restart: true });
    expect((await store.inspect()).lifecycle).toBe("reconciling");
    await expect(store.setLifecycle("reconciling", { restart: true })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await store.settle("interrupted", "restart");
    await expect(store.setLifecycle("reconciling", { restart: true })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("keeps reconciling across a restart on the same sqlite file and settles from it", async () => {
    const first = await track(openRuntimeWorld(directory));
    const threadId = await createPassiveThread(first);
    const store = createRuntimeStore(first.harness, threadId);
    for (const step of ["accepted", "preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    await store.setLifecycle("reconciling", { restart: true });
    await first.close();

    const second = await track(openRuntimeWorld(directory, first.setup));
    const reopened = createRuntimeStore(second.harness, threadId);
    expect((await reopened.inspect()).lifecycle).toBe("reconciling");
    await reopened.settle("outcome-unknown", "restart");
    expect((await reopened.operationState()).operation?.terminal?.lifecycle).toBe("outcome-unknown");
  });
});

describe("runtime store multi-turn restart", () => {
  it("keeps history, acknowledgement and session on the same sqlite file", async () => {
    const first = await track(openRuntimeWorld(directory));
    const threadId = await createPassiveThread(first);
    const store = createRuntimeStore(first.harness, threadId);
    for (const step of ["accepted", "preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    await store.recordSession("s1");
    await store.settle("outcome-unknown", "gone");
    await store.acknowledgeUnknown({ operationId: "op1", note: "ok" });
    await first.close();

    const second = await track(openRuntimeWorld(directory, first.setup));
    const reopened = createRuntimeStore(second.harness, threadId);
    expect((await reopened.operationState()).acknowledgement).toMatchObject({ note: "ok" });
    await reopened.beginOperation();
    await second.close();

    const third = await track(openRuntimeWorld(directory, first.setup));
    const final = createRuntimeStore(third.harness, threadId);
    const state = await final.operationState();
    expect(state).toMatchObject({ lifecycle: "accepted", sessionId: "s1", operation: undefined });
    expect(state.history).toMatchObject([
      { operationId: "op1", lifecycle: "outcome-unknown", acknowledgement: { note: "ok" } },
    ]);
  });
});

function deferred() {
  let release: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { settled, release };
}

async function prepareOk(store: RuntimeStore) {
  await store.beginOperation();
  for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
}

describe("runtime store cancel before launch", () => {
  it("records no launch intent when the cancel lands between a finished prepare and the launch commit", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    await prepareOk(store);
    const prepareReturned = deferred();
    const launching = prepareReturned.settled.then(() =>
      store.recordLaunchIntent({ operationId: "op1", nonce: "n1" }),
    );
    const before = (await store.inspect()).cursorRevision;

    expect(await store.requestCancelBeforeLaunch()).toBe("requested");
    prepareReturned.release();

    expect(await launching).toEqual({ kind: "cancelled-before-launch" });
    const state = await store.operationState();
    expect(state.lifecycle).toBe("cancelled");
    expect(state.cancelRequested).toBe(false);
    expect(state.operation).toMatchObject({
      operationId: "op1",
      terminal: { lifecycle: "cancelled", reason: "cancelled before launch" },
    });
    expect(state.operation?.launchIntentAt).toBeUndefined();
    expect(state.operation?.deliveredRequestId).toBeUndefined();
    expect((await store.inspect()).cursorRevision).toBe(before + 1);
    expect((await store.pending()).map((item) => item.requestId)).toEqual(["r1"]);
  });

  it("settles each racing launch exactly one way: cancelled when the cancel committed first, launched otherwise", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    for (let round = 0; round < 12; round += 1) {
      await prepareOk(store);
      const [requested, launched] = await Promise.all([
        store.requestCancelBeforeLaunch(),
        store.recordLaunchIntent({ operationId: `op${round}`, nonce: `n${round}` }),
      ]);
      const state = await store.operationState();
      if (requested === "requested") {
        expect(launched.kind).toBe("cancelled-before-launch");
        expect(state.operation?.terminal?.lifecycle).toBe("cancelled");
      } else {
        expect(requested).toBe("launched");
        expect(launched.kind).toBe("recorded");
        expect(state.operation?.terminal).toBeUndefined();
        await store.settle("completed");
      }
      expect(state.cancelRequested).toBe(false);
    }
  });

  it("keeps the marker across a restart and still refuses the launch", async () => {
    const first = await track(openRuntimeWorld(directory));
    const threadId = await createPassiveThread(first);
    const store = createRuntimeStore(first.harness, threadId);
    await store.admit(requestOf(threadId, "r1"));
    await prepareOk(store);
    await store.requestCancelBeforeLaunch();
    await first.close();

    const second = await track(openRuntimeWorld(directory, first.setup));
    const reopened = createRuntimeStore(second.harness, threadId);

    expect((await reopened.operationState()).cancelRequested).toBe(true);
    expect(await reopened.recordLaunchIntent({ operationId: "op1", nonce: "n1" })).toEqual({
      kind: "cancelled-before-launch",
    });
    expect((await reopened.operationState()).operation?.launchIntentAt).toBeUndefined();
  });

  it("lets the next operation run normally once the cancelled terminal is recorded", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    await prepareOk(store);
    await store.requestCancelBeforeLaunch();
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });

    await prepareOk(store);
    expect(await store.recordLaunchIntent({ operationId: "op2", nonce: "n2" })).toEqual({ kind: "recorded" });

    const state = await store.operationState();
    expect(state.lifecycle).toBe("starting");
    expect(state.history).toEqual([{ operationId: "op1", lifecycle: "cancelled", at: expect.any(Number) }]);
  });

  it("sets no marker when nothing is in flight, so a cancel with nothing to cancel never poisons the next run", async () => {
    const { store, threadId } = await newStore();
    expect(await store.requestCancelBeforeLaunch()).toBe("nothing-pending");
    await store.admit(requestOf(threadId, "r1"));
    await prepareOk(store);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    await store.settle("completed");
    await store.markDelivered("r1");

    expect(await store.requestCancelBeforeLaunch()).toBe("nothing-pending");
    expect((await store.operationState()).cancelRequested).toBe(false);

    await store.admit(requestOf(threadId, "r2"));
    await prepareOk(store);
    expect(await store.recordLaunchIntent({ operationId: "op2", nonce: "n2" })).toEqual({ kind: "recorded" });
  });

  it("leaves a launched operation to the process cancel path", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    await prepareOk(store);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });

    expect(await store.requestCancelBeforeLaunch()).toBe("launched");
    expect((await store.operationState()).cancelRequested).toBe(false);
  });

  it("drops a stale marker on clear so the next launch is recorded", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    await prepareOk(store);
    await store.requestCancelBeforeLaunch();
    await store.clearCancelRequest();
    await store.clearCancelRequest();

    expect((await store.operationState()).cancelRequested).toBe(false);
    expect(await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" })).toEqual({ kind: "recorded" });
  });

  it("keeps the queued input queued after a cancelled-before-launch operation", async () => {
    const { store, threadId } = await newStore();
    await store.admit(requestOf(threadId, "r1"));
    await store.admit(requestOf(threadId, "r2"));
    await prepareOk(store);
    await store.requestCancelBeforeLaunch();
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });

    expect((await store.pending()).map((item) => item.requestId)).toEqual(["r1", "r2"]);
    expect((await store.operationState()).operation?.deliveredRequestId).toBeUndefined();
  });
});
