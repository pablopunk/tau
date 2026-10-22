import type {
  AdmissionReceipt,
  CancelReceipt,
  ExecutorKind,
  ObserveFrame,
  ProjectionCursor,
  ReconcileOutcome,
  RuntimeCapabilities,
  RuntimeLifecycle,
  WriterState,
} from "@tau/protocol";
import { isAppError, isStaleEpoch } from "@tau/protocol";
import { describe, expect, it } from "vitest";

export type RuntimePayload = {
  readonly text: string;
  readonly attachmentIds: readonly string[];
  readonly origin: "user" | "timer" | "notification" | "child-report";
  readonly delivery: "queue" | "steer" | "send-now";
};

export type AdmitRequest = {
  threadId: string;
  requestId: string;
  payload: RuntimePayload;
};

export type RuntimeInspection = {
  executor: ExecutorKind;
  capabilities: RuntimeCapabilities;
  lifecycle: RuntimeLifecycle | undefined;
  writer: WriterState;
  unresolvedOutcomes: number;
  cursor: ProjectionCursor;
};

export type CancelRequest = {
  threadId: string;
  operationId: string;
};

export interface RuntimeExecutorUnderTest {
  readonly executor: ExecutorKind;
  admit(req: AdmitRequest): Promise<AdmissionReceipt>;
  inspect(threadId: string): Promise<RuntimeInspection>;
  observe(threadId: string, from: ProjectionCursor | undefined): AsyncIterable<ObserveFrame>;
  cancel(req: CancelRequest): Promise<CancelReceipt>;
  reconcile(threadId: string, epoch: number): Promise<ReconcileOutcome>;
  capabilities(threadId: string): Promise<RuntimeCapabilities>;
}

export type RuntimeContractTarget = {
  makeExecutor(): RuntimeExecutorUnderTest;
  restart(executor: RuntimeExecutorUnderTest): Promise<RuntimeExecutorUnderTest>;
  expectedExecutor: ExecutorKind;
  makeLegacyExecutor?(legacyRequestIds: string[]): RuntimeExecutorUnderTest;
  settle?(executor: RuntimeExecutorUnderTest): Promise<void> | void;
  bumpEpoch?(executor: RuntimeExecutorUnderTest): Promise<void> | void;
};

export const OBSERVE_BURST = 8;

const THREAD = "thread-contract";

function payload(overrides: Partial<RuntimePayload> = {}): RuntimePayload {
  return { text: "hello", attachmentIds: [], origin: "user", delivery: "queue", ...overrides };
}

function request(
  requestId: string,
  overrides: Partial<RuntimePayload> = {},
  threadId = THREAD,
): AdmitRequest {
  return { threadId, requestId, payload: payload(overrides) };
}

async function collect(frames: AsyncIterable<ObserveFrame>): Promise<ObserveFrame[]> {
  const collected: ObserveFrame[] = [];
  for await (const frame of frames) collected.push(frame);
  return collected;
}

async function revisionOf(executor: RuntimeExecutorUnderTest, threadId = THREAD): Promise<number> {
  return (await executor.inspect(threadId)).cursor.revision;
}

async function expectInvalidRequest(attempt: Promise<unknown>): Promise<void> {
  const error = await attempt.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(isAppError(error)).toBe(true);
  expect(error).toMatchObject({ code: "invalid_request" });
}

async function whenHookPresent<Hook>(
  hook: Hook | undefined,
  body: (present: Hook) => Promise<void>,
): Promise<void> {
  if (hook === undefined) {
    expect(hook).toBeUndefined();
    return;
  }
  await body(hook);
}

async function admitBurst(executor: RuntimeExecutorUnderTest): Promise<void> {
  for (let index = 0; index < OBSERVE_BURST; index++) {
    await executor.admit(request(`burst-${index}`, { text: `burst ${index}` }));
  }
}

export async function runCase1(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  const first = await executor.admit(request("req-1"));
  const second = await executor.admit(request("req-1"));
  expect(second.receiptId).toBe(first.receiptId);
  expect(first.executor).toBe(target.expectedExecutor);
  expect(Number.isInteger(first.epoch)).toBe(true);
  expect(first.epoch).toBeGreaterThanOrEqual(0);
  expect(first.payloadIdentity).toBe("fingerprinted");
  expect(typeof first.payloadFingerprint).toBe("string");
}

export async function runCase2(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  const first = await executor.admit(request("req-2"));
  const before = await revisionOf(executor);
  const retry = await executor.admit(request("req-2"));
  expect(retry).toEqual(first);
  expect(await revisionOf(executor)).toBe(before);
}

export async function runCase3(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  const first = await executor.admit(request("req-3", { text: "original" }));
  await expectInvalidRequest(executor.admit(request("req-3", { text: "conflicting" })));
  const again = await executor.admit(request("req-3", { text: "original" }));
  expect(again).toEqual(first);
}

export async function runCase4(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  const first = await executor.admit(request("req-4"));
  const restarted = await target.restart(executor);
  const second = await restarted.admit(request("req-4"));
  expect(second.receiptId).toBe(first.receiptId);
  expect(second.epoch).toBeGreaterThanOrEqual(first.epoch);
}

export async function runCase5(target: RuntimeContractTarget): Promise<void> {
  await whenHookPresent(target.makeLegacyExecutor, async (makeLegacyExecutor) => {
    const executor = makeLegacyExecutor(["legacy-1"]);
    const legacy = await executor.admit(request("legacy-1"));
    expect(legacy.payloadIdentity).toBe("legacy-payload-unverified");
    expect(legacy.payloadFingerprint).toBeUndefined();
    const retry = await executor.admit(request("legacy-1"));
    expect(retry.receiptId).toBe(legacy.receiptId);
    const current = await executor.admit(request("current-1"));
    expect(current.payloadIdentity).toBe("fingerprinted");
    expect(typeof current.payloadFingerprint).toBe("string");
  });
}

export async function runCase6(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  const attachments = request("req-6", { attachmentIds: ["a", "b"] });
  const first = await executor.admit(attachments);
  const restarted = await target.restart(executor);
  const unresolved = (await restarted.inspect(THREAD)).unresolvedOutcomes;
  expect(unresolved).toBeGreaterThanOrEqual(1);
  const again = await restarted.admit(attachments);
  expect(again.receiptId).toBe(first.receiptId);
  expect((await restarted.inspect(THREAD)).unresolvedOutcomes).toBe(unresolved);
}

async function cancelTwice(executor: RuntimeExecutorUnderTest): Promise<CancelReceipt[]> {
  const first = await executor.cancel({ threadId: THREAD, operationId: "op-7" });
  const second = await executor.cancel({ threadId: THREAD, operationId: "op-7" });
  return [first, second];
}

export async function runCase7(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  await executor.admit(request("req-7"));
  const settle = target.settle;
  const receipts = await cancelTwice(executor);
  for (const receipt of receipts) expect(receipt.intentRecorded).toBe(true);
  await whenHookPresent(settle, async (settleExecutor) => {
    for (const receipt of receipts) expect(receipt.outcome).toBe("stopping");
    await settleExecutor(executor);
    const confirmed = await executor.cancel({ threadId: THREAD, operationId: "op-7" });
    expect(confirmed.outcome).toBe("stopped");
    const afterTerminal = await executor.cancel({ threadId: THREAD, operationId: "op-7" });
    expect(afterTerminal.intentRecorded).toBe(true);
    expect(afterTerminal.outcome).toBe("stopped");
  });
}

export async function runCase8(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  const caps = await executor.capabilities(THREAD);
  expect(caps.steer.supported).toBe(false);
  const before = await revisionOf(executor);
  await expectInvalidRequest(executor.admit(request("req-8", { delivery: "steer" })));
  expect(await revisionOf(executor)).toBe(before);
}

export async function runCase9(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  await admitBurst(executor);
  const frames = await collect(executor.observe(THREAD, undefined));
  expect(frames.length).toBeGreaterThan(0);
  const revisions = frames.map((frame) => frame.cursor.revision);
  expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
  const current = (await executor.inspect(THREAD)).cursor;
  const stale = await collect(executor.observe(THREAD, { epoch: current.epoch, revision: 0 }));
  expect(stale[0]?.kind).toBe("reset");
}

export async function runCase10(target: RuntimeContractTarget): Promise<void> {
  const executor = target.makeExecutor();
  await admitBurst(executor);
  const all = await collect(executor.observe(THREAD, undefined));
  const from = (all[0] as ObserveFrame).cursor;
  const firstPass = await collect(executor.observe(THREAD, from));
  const secondPass = await collect(executor.observe(THREAD, from));
  expect(secondPass).toEqual(firstPass);
  const revisions = firstPass.map((frame) => frame.cursor.revision);
  expect(new Set(revisions).size).toBe(revisions.length);
}

export async function runCase11(target: RuntimeContractTarget): Promise<void> {
  await whenHookPresent(target.bumpEpoch, async (bumpEpoch) => {
    const executor = target.makeExecutor();
    await executor.admit(request("req-11"));
    const oldCursor = (await executor.inspect(THREAD)).cursor;
    await bumpEpoch(executor);
    const current = (await executor.inspect(THREAD)).cursor;
    expect(isStaleEpoch(current, oldCursor)).toBe(true);
    const frames = await collect(executor.observe(THREAD, oldCursor));
    expect(frames[0]?.kind).toBe("reset");
    expect(frames.every((frame) => frame.kind === "reset")).toBe(true);
  });
}

export async function runCase12(target: RuntimeContractTarget): Promise<void> {
  const left = target.makeExecutor();
  const right = target.makeExecutor();
  await left.admit(request("req-12", { attachmentIds: ["a"] }));
  expect(await revisionOf(left)).toBeGreaterThan(0);
  const other = await right.inspect(THREAD);
  expect(other.cursor.revision).toBe(0);
  expect(other.unresolvedOutcomes).toBe(0);
}

const CASES: ReadonlyArray<readonly [string, (target: RuntimeContractTarget) => Promise<void>]> = [
  ["stable admission receipt", runCase1],
  ["identical retry returns the same receipt without a second admission", runCase2],
  ["conflicting retry is rejected and keeps the original receipt", runCase3],
  ["restart keeps receipt identity and never lowers the epoch", runCase4],
  ["historical-unverified receipts carry no fingerprint (needs makeLegacyExecutor, fake only)", runCase5],
  ["attachments are retained across restart, not re-requested", runCase6],
  ["cancel is idempotent and stopped needs confirmation (needs settle, fake only)", runCase7],
  ["unsupported capability rejects before any effect", runCase8],
  ["observe orders frames and resets outside the retained window", runCase9],
  ["reconnect from the same cursor yields identical frames", runCase10],
  ["epoch-fenced late cursor yields reset, never an update (needs bumpEpoch, fake only)", runCase11],
  ["executors from makeExecutor share no state", runCase12],
];

export function runRuntimeContract(name: string, target: RuntimeContractTarget): void {
  describe(`runtime contract: ${name}`, () => {
    for (const [caseName, body] of CASES) it(caseName, () => body(target));
  });
}
