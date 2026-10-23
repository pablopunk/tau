import type { AdmissionReceipt } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createFakeRuntimeExecutor, type FakeRuntimeExecutor } from "./fake-runtime-executor";
import {
  type AdmitRequest,
  type RuntimeContractTarget,
  type RuntimeExecutorUnderTest,
  runCase1,
  runCase2,
  runCase3,
  runCase8,
  runRuntimeContract,
} from "./runtime-contract";

function asFake(executor: RuntimeExecutorUnderTest): FakeRuntimeExecutor {
  const fake = executor as Partial<FakeRuntimeExecutor>;
  if (typeof fake.restartFrom !== "function") throw new Error("not a fake runtime executor");
  return fake as FakeRuntimeExecutor;
}

const fakeTarget: RuntimeContractTarget = {
  makeExecutor: () => createFakeRuntimeExecutor(),
  restart: async (executor) => asFake(executor).restartFrom(asFake(executor).snapshot()),
  expectedExecutor: "pi",
  makeLegacyExecutor: (legacyRequestIds) => createFakeRuntimeExecutor({ legacyRequestIds }),
  settle: (executor) => asFake(executor).settle(),
  bumpEpoch: (executor) => asFake(executor).bumpEpoch(),
};

runRuntimeContract("fake", fakeTarget);

function withAdmit(
  inner: RuntimeExecutorUnderTest,
  admit: (req: AdmitRequest) => Promise<AdmissionReceipt>,
): RuntimeExecutorUnderTest {
  return Object.assign(Object.create(inner) as RuntimeExecutorUnderTest, { admit });
}

function brokenTarget(
  wrap: (inner: RuntimeExecutorUnderTest) => RuntimeExecutorUnderTest,
): RuntimeContractTarget {
  return { ...fakeTarget, makeExecutor: () => wrap(createFakeRuntimeExecutor()) };
}

function freshReceiptOnRetry(inner: RuntimeExecutorUnderTest): RuntimeExecutorUnderTest {
  const seen = new Set<string>();
  let counter = 0;
  return withAdmit(inner, async (req) => {
    const receipt = await inner.admit(req);
    const retried = seen.has(req.requestId);
    seen.add(req.requestId);
    return retried ? { ...receipt, receiptId: `fresh-${++counter}` } : receipt;
  });
}

function acceptsConflictingPayload(inner: RuntimeExecutorUnderTest): RuntimeExecutorUnderTest {
  const firstReceipts = new Map<string, AdmissionReceipt>();
  return withAdmit(inner, async (req) => {
    const known = firstReceipts.get(req.requestId);
    if (known) return known;
    const receipt = await inner.admit(req);
    firstReceipts.set(req.requestId, receipt);
    return receipt;
  });
}

function letsSteerThrough(inner: RuntimeExecutorUnderTest): RuntimeExecutorUnderTest {
  return withAdmit(inner, (req) => inner.admit({ ...req, payload: { ...req.payload, delivery: "queue" } }));
}

describe("runtime contract catches broken executors", () => {
  it("fails when an identical retry gets a fresh receiptId", async () => {
    const target = brokenTarget(freshReceiptOnRetry);
    await expect(runCase1(target)).rejects.toThrow();
    await expect(runCase2(target)).rejects.toThrow();
  });

  it("fails when a conflicting payload is accepted", async () => {
    await expect(runCase3(brokenTarget(acceptsConflictingPayload))).rejects.toThrow();
  });

  it("fails when a steer admit goes through", async () => {
    await expect(runCase8(brokenTarget(letsSteerThrough))).rejects.toThrow();
  });
});
