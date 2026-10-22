import { AppError } from "@tau/protocol";
import { createKeyedLock } from "./keyed-lock";

export interface WriterBarrier {
  run<T>(workspaceKey: string, owner: string, task: () => Promise<T>): Promise<T>;
  assertOpen(workspaceKey: string, thread: string): void;
  isFenced(workspaceKey: string): boolean;
}

const fencedMessage = "This workspace is being changed (merge/remove). Try again when it finishes.";

export function createWriterBarrier(): WriterBarrier {
  const serial = createKeyedLock();
  const pendingOwners = new Map<string, string[]>();

  function enter(key: string, owner: string) {
    pendingOwners.set(key, [...(pendingOwners.get(key) ?? []), owner]);
  }

  function leave(key: string, owner: string) {
    const remaining = [...(pendingOwners.get(key) ?? [])];
    remaining.splice(remaining.indexOf(owner), 1);
    if (remaining.length === 0) pendingOwners.delete(key);
    else pendingOwners.set(key, remaining);
  }

  const ownersOtherThan = (key: string, thread: string) =>
    (pendingOwners.get(key) ?? []).filter((owner) => owner !== thread);

  return {
    run(key, owner, task) {
      enter(key, owner);
      return serial.run(key, task).finally(() => leave(key, owner));
    },
    assertOpen(key, thread) {
      if (ownersOtherThan(key, thread).length > 0) throw new AppError("thread_busy", fencedMessage);
    },
    isFenced: (key) => pendingOwners.has(key),
  };
}
