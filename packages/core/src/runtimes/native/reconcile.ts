import type { ReconcileOutcome, RuntimeLifecycle } from "@tau/protocol";
import type { OperationIdentity } from "../../harness/runtime-docs";
import type { RuntimeStore } from "../../harness/runtime-store";
import {
  classifyAfterRestart,
  type ProcessIdentity,
  type StopOptions,
  type StopResult,
  type SupervisorDeps,
  stopByIdentity,
} from "../supervisor";
import { toProcessIdentity } from "./supervised-spawn";

export interface ReconcileDeps {
  readonly supervisor: SupervisorDeps;
  readonly stop?: StopOptions;
}

type Death = { verified: true } | { verified: false; reason: string };

const VERIFIED: Death = { verified: true };

const noticeKey = (operationId: string): string => `reconcile:${operationId}`;

async function surfaceNotice(store: RuntimeStore, operationId: string, text: string): Promise<void> {
  await store.appendEvent({ type: "notice", key: noticeKey(operationId), code: "reconciled", text });
}

async function stopAlive(identity: ProcessIdentity, deps: ReconcileDeps): Promise<Death> {
  const stopped: StopResult = await stopByIdentity(identity, deps.stop, deps.supervisor);
  if (stopped.outcome === "unknown") return { verified: false, reason: stopped.reason };
  return VERIFIED;
}

async function verifyDeathAfterRestart(identity: ProcessIdentity, deps: ReconcileDeps): Promise<Death> {
  const classification = await classifyAfterRestart(identity, deps.supervisor);
  if (classification === "dead") return VERIFIED;
  if (classification === "alive-reused-pid") return VERIFIED;
  if (classification === "alive-same") return stopAlive(identity, deps);
  return { verified: false, reason: "the process table could not be read; nothing was signalled" };
}

async function settleUnknown(
  store: RuntimeStore,
  operationId: string,
  reason: string,
): Promise<ReconcileOutcome> {
  await store.settle("outcome-unknown", reason);
  await surfaceNotice(store, operationId, `Outcome unknown after restart: ${reason}`);
  return "outcome-unknown";
}

async function settleAfterVerifiedDeath(
  store: RuntimeStore,
  operationId: string,
  delivered: boolean,
  cancelling: boolean,
): Promise<ReconcileOutcome> {
  if (cancelling) {
    await store.settleCancels();
    await surfaceNotice(store, operationId, "Cancelled after restart; the process is verified dead.");
    return "settled";
  }
  if (delivered) {
    return settleUnknown(store, operationId, "the prompt was delivered and the process is gone");
  }
  await store.settle("interrupted", "the process is gone and the prompt was never delivered");
  await surfaceNotice(store, operationId, "Interrupted before the prompt was delivered.");
  return "interrupted";
}

const hasIdentity = (operation: {
  identity?: OperationIdentity;
}): operation is { identity: OperationIdentity } => operation.identity !== undefined;

async function enterReconciling(store: RuntimeStore, lifecycle: RuntimeLifecycle | undefined): Promise<void> {
  if (lifecycle === "reconciling") return;
  await store.setLifecycle("reconciling", { restart: true });
}

/** Applies persisted state only after a restart. Never relaunches and signals only a process that is verifiably the recorded one. */
export async function reconcileNative(store: RuntimeStore, deps: ReconcileDeps): Promise<ReconcileOutcome> {
  const { operation, lifecycle } = await store.operationState();
  if (!operation || operation.terminal) return "settled";
  const cancelling = (await store.inspect()).cancelsInFlight > 0;
  await enterReconciling(store, lifecycle);
  if (!hasIdentity(operation)) {
    return settleUnknown(
      store,
      operation.operationId,
      "a launch intent exists without a recorded process identity",
    );
  }
  const death = await verifyDeathAfterRestart(toProcessIdentity(operation.identity), deps);
  if (!death.verified) return settleUnknown(store, operation.operationId, death.reason);
  return settleAfterVerifiedDeath(
    store,
    operation.operationId,
    operation.deliveredRequestId !== undefined,
    cancelling,
  );
}
