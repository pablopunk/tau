import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
