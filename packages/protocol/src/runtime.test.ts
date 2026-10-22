import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AdmissionReceiptSchema,
  CANCEL_OUTCOMES,
  CancelOutcomeSchema,
  CancelReceiptSchema,
  CapabilityStateSchema,
  DEFAULT_EXECUTOR,
  EXECUTOR_KINDS,
  ExecutorKindSchema,
  executorOf,
  isConfirmedStopped,
  isSafeToDestroy,
  isStaleEpoch,
  isSuccessfulLifecycle,
  isTerminalLifecycle,
  ObserveFrameSchema,
  PAYLOAD_IDENTITIES,
  PayloadIdentitySchema,
  ProjectionCursorSchema,
  RECONCILE_OUTCOMES,
  ReconcileOutcomeSchema,
  RUNTIME_CAPABILITY_KEYS,
  RUNTIME_LIFECYCLES,
  RUNTIME_UNSUPPORTED_REASON,
  RuntimeCapabilitiesSchema,
  RuntimeDescriptorSchema,
  RuntimeLifecycleSchema,
  TERMINAL_LIFECYCLES,
  unsupportedCapabilities,
  WRITER_STATES,
  WriterStateSchema,
} from "./runtime";

const cursor = { epoch: 2, revision: 5 };
const receipt = {
  receiptId: "r1",
  threadId: "t1",
  requestId: "q1",
  executor: "pi",
  epoch: 0,
  payloadIdentity: "fingerprinted",
  payloadFingerprint: "abc",
  admittedAt: 1,
};

describe("executor kind", () => {
  it("accepts known kinds and rejects others", () => {
    for (const kind of EXECUTOR_KINDS) expect(Value.Check(ExecutorKindSchema, kind)).toBe(true);
    expect(Value.Check(ExecutorKindSchema, "gpt")).toBe(false);
  });

  it("defaults to pi when omitted and ignores everything else", () => {
    expect(DEFAULT_EXECUTOR).toBe("pi");
    expect(executorOf(undefined)).toBe("pi");
    expect(executorOf({})).toBe("pi");
    expect(executorOf({ executor: "claude-code" })).toBe("claude-code");
    expect(executorOf({ model: "claude-sonnet" } as { executor?: "pi" })).toBe("pi");
  });
});

describe("capabilities", () => {
  it("validates a capability state", () => {
    expect(Value.Check(CapabilityStateSchema, { supported: true })).toBe(true);
    expect(Value.Check(CapabilityStateSchema, { supported: false, reason: "x" })).toBe(true);
    expect(Value.Check(CapabilityStateSchema, { supported: "yes" })).toBe(false);
  });

  it("marks all ten keys unsupported with the reason", () => {
    const capabilities = unsupportedCapabilities(RUNTIME_UNSUPPORTED_REASON);
    expect(RUNTIME_CAPABILITY_KEYS).toHaveLength(10);
    expect(Object.keys(capabilities).sort()).toEqual([...RUNTIME_CAPABILITY_KEYS].sort());
    for (const key of RUNTIME_CAPABILITY_KEYS) {
      expect(capabilities[key]).toEqual({ supported: false, reason: "executor-disabled" });
    }
    expect(Value.Check(RuntimeCapabilitiesSchema, capabilities)).toBe(true);
  });

  it("requires every key", () => {
    const { steer: _steer, ...missingSteer } = unsupportedCapabilities("x");
    expect(Value.Check(RuntimeCapabilitiesSchema, missingSteer)).toBe(false);
  });
});

describe("lifecycle", () => {
  it("accepts every lifecycle and rejects unknown ones", () => {
    for (const lifecycle of RUNTIME_LIFECYCLES)
      expect(Value.Check(RuntimeLifecycleSchema, lifecycle)).toBe(true);
    expect(Value.Check(RuntimeLifecycleSchema, "paused")).toBe(false);
  });

  it("treats outcome-unknown as terminal but not successful", () => {
    expect(isTerminalLifecycle("outcome-unknown")).toBe(true);
    expect(isSuccessfulLifecycle("outcome-unknown")).toBe(false);
  });

  it("succeeds only on completed", () => {
    for (const lifecycle of RUNTIME_LIFECYCLES) {
      expect(isSuccessfulLifecycle(lifecycle)).toBe(lifecycle === "completed");
    }
    expect(isSuccessfulLifecycle("cancelled")).toBe(false);
  });

  it("is terminal exactly for the terminal list", () => {
    for (const lifecycle of RUNTIME_LIFECYCLES) {
      expect(isTerminalLifecycle(lifecycle)).toBe(
        (TERMINAL_LIFECYCLES as readonly string[]).includes(lifecycle),
      );
    }
    expect(isTerminalLifecycle("running")).toBe(false);
    expect(isTerminalLifecycle("cancelling")).toBe(false);
  });
});

describe("writer state", () => {
  it("accepts known states and rejects others", () => {
    for (const state of WRITER_STATES) expect(Value.Check(WriterStateSchema, state)).toBe(true);
    expect(Value.Check(WriterStateSchema, "idle")).toBe(false);
  });

  it("is safe to destroy only when settled", () => {
    for (const state of WRITER_STATES) expect(isSafeToDestroy(state)).toBe(state === "settled");
    for (const state of ["running", "cancelling", "reconciling", "unknown"] as const) {
      expect(isSafeToDestroy(state)).toBe(false);
    }
  });
});

describe("admission receipt", () => {
  it("accepts a valid receipt, with or without a fingerprint", () => {
    expect(Value.Check(AdmissionReceiptSchema, receipt)).toBe(true);
    const { payloadFingerprint: _fingerprint, ...legacy } = receipt;
    expect(
      Value.Check(AdmissionReceiptSchema, { ...legacy, payloadIdentity: "legacy-payload-unverified" }),
    ).toBe(true);
  });

  it("rejects a negative epoch and empty ids", () => {
    expect(Value.Check(AdmissionReceiptSchema, { ...receipt, epoch: -1 })).toBe(false);
    expect(Value.Check(AdmissionReceiptSchema, { ...receipt, receiptId: "" })).toBe(false);
    expect(Value.Check(AdmissionReceiptSchema, { ...receipt, threadId: "" })).toBe(false);
    expect(Value.Check(AdmissionReceiptSchema, { ...receipt, requestId: "" })).toBe(false);
  });

  it("rejects an unknown payload identity", () => {
    expect(Value.Check(PayloadIdentitySchema, "fingerprinted")).toBe(true);
    expect(PAYLOAD_IDENTITIES).toHaveLength(2);
    expect(Value.Check(AdmissionReceiptSchema, { ...receipt, payloadIdentity: "guess" })).toBe(false);
  });
});

describe("cancel receipt", () => {
  const cancel = { operationId: "op", intentRecorded: true, outcome: "stopped" } as const;

  it("accepts a valid receipt and rejects bad ones", () => {
    for (const outcome of CANCEL_OUTCOMES) expect(Value.Check(CancelOutcomeSchema, outcome)).toBe(true);
    expect(Value.Check(CancelReceiptSchema, cancel)).toBe(true);
    expect(Value.Check(CancelReceiptSchema, { ...cancel, operationId: "" })).toBe(false);
    expect(Value.Check(CancelReceiptSchema, { ...cancel, outcome: "done" })).toBe(false);
  });

  it("confirms a stop only for stopped", () => {
    expect(isConfirmedStopped(cancel)).toBe(true);
    for (const outcome of ["stopping", "denied", "unknown"] as const) {
      expect(isConfirmedStopped({ ...cancel, outcome })).toBe(false);
    }
  });
});

describe("observation", () => {
  it("validates a projection cursor", () => {
    expect(Value.Check(ProjectionCursorSchema, cursor)).toBe(true);
    expect(Value.Check(ProjectionCursorSchema, { epoch: -1, revision: 0 })).toBe(false);
    expect(Value.Check(ProjectionCursorSchema, { epoch: 0, revision: 1.5 })).toBe(false);
  });

  it("validates update and reset frames", () => {
    expect(Value.Check(ObserveFrameSchema, { kind: "update", cursor, count: 3 })).toBe(true);
    expect(Value.Check(ObserveFrameSchema, { kind: "reset", cursor })).toBe(true);
    expect(Value.Check(ObserveFrameSchema, { kind: "reset", cursor, reason: "gap" })).toBe(true);
    expect(Value.Check(ObserveFrameSchema, { kind: "update", cursor, count: -1 })).toBe(false);
    expect(Value.Check(ObserveFrameSchema, { kind: "update", cursor })).toBe(false);
    expect(Value.Check(ObserveFrameSchema, { kind: "other", cursor })).toBe(false);
  });

  it("flags only strictly older epochs as stale", () => {
    expect(isStaleEpoch({ epoch: 2, revision: 0 }, { epoch: 1, revision: 99 })).toBe(true);
    expect(isStaleEpoch({ epoch: 2, revision: 5 }, { epoch: 2, revision: 1 })).toBe(false);
    expect(isStaleEpoch({ epoch: 2, revision: 0 }, { epoch: 3, revision: 0 })).toBe(false);
  });
});

describe("reconcile outcome and descriptor", () => {
  it("accepts known reconcile outcomes and rejects others", () => {
    for (const outcome of RECONCILE_OUTCOMES) expect(Value.Check(ReconcileOutcomeSchema, outcome)).toBe(true);
    expect(Value.Check(ReconcileOutcomeSchema, "gone")).toBe(false);
  });

  it("validates a runtime descriptor", () => {
    const descriptor = { executor: "claude-code", capabilities: unsupportedCapabilities("x") };
    expect(Value.Check(RuntimeDescriptorSchema, descriptor)).toBe(true);
    expect(Value.Check(RuntimeDescriptorSchema, { ...descriptor, lifecycle: "running" })).toBe(true);
    expect(Value.Check(RuntimeDescriptorSchema, { ...descriptor, lifecycle: "paused" })).toBe(false);
    expect(Value.Check(RuntimeDescriptorSchema, { ...descriptor, executor: "nope" })).toBe(false);
  });

  it("exposes the disabled reason", () => {
    expect(RUNTIME_UNSUPPORTED_REASON).toBe("executor-disabled");
  });
});
