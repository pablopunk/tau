import type { OperationIdentity } from "../../harness/runtime-docs";
import { type ProcessEntry, type ProcessTable, psProcessTable } from "../process-table";
import type { ProcessIdentity, SupervisorDeps } from "../supervisor";

const sendRealSignal: SupervisorDeps["sendSignal"] = (pid, signal) => {
  process.kill(pid, signal);
};

const epochMillisOf = (startTime: string): string => {
  const millis = Date.parse(startTime);
  return Number.isNaN(millis) ? startTime : String(millis);
};

const withEpochMillis = (entry: ProcessEntry | undefined): ProcessEntry | undefined =>
  entry && { ...entry, startTime: epochMillisOf(entry.startTime) };

/** The store keeps start times as numbers, so every supervisor comparison runs on epoch milliseconds. */
export function withNumericStartTimes(table: ProcessTable): ProcessTable {
  return {
    find: async (pid) => withEpochMillis(await table.find(pid)),
    list: async () => (await table.list()).map((entry) => withEpochMillis(entry) as ProcessEntry),
  };
}

export const resolveSupervisorDeps = (deps: Partial<SupervisorDeps> = {}): SupervisorDeps => ({
  processTable: withNumericStartTimes(deps.processTable ?? psProcessTable),
  sendSignal: deps.sendSignal ?? sendRealSignal,
});

export function toStoredIdentity(identity: ProcessIdentity): OperationIdentity {
  const startTime = Number(identity.startTime);
  if (!Number.isFinite(startTime)) throw new Error(`unusable process start time ${identity.startTime}`);
  return { pid: identity.pid, startTime, nonce: identity.nonce, pgid: identity.pgid };
}

export const toProcessIdentity = (stored: OperationIdentity): ProcessIdentity => ({
  pid: stored.pid,
  startTime: String(stored.startTime),
  nonce: stored.nonce,
  pgid: stored.pgid,
});
