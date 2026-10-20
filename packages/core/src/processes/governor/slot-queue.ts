export interface SlotInfo {
  readonly entryId: string;
  readonly conversationId: string;
  readonly command: string;
  readonly since: number;
}

export interface SlotHandle {
  /** `true` once the slot is granted, `false` when it was cancelled while waiting. */
  readonly promise: Promise<boolean>;
  /** Removes a waiter, or releases a slot already granted. Idempotent. */
  cancel(): void;
  /** Gives the slot back. Idempotent. */
  release(): void;
}

export interface SlotSnapshot {
  readonly holders: readonly SlotInfo[];
  readonly waiting: readonly SlotInfo[];
}

export interface SlotQueue {
  acquire(info: SlotInfo): SlotHandle;
  /** Raising or `null` wakes waiters at once; lowering never kills a holder. */
  setLimit(limit: number | null): void;
  snapshot(): SlotSnapshot;
  has(entryId: string): boolean;
}

interface Waiter {
  readonly info: SlotInfo;
  readonly grant: (granted: boolean) => void;
}

/** A FIFO counting semaphore; `onChange` fires on queue, grant, release and cancel. */
export function createSlotQueue(initialLimit: number | null, onChange: () => void = () => {}): SlotQueue {
  let limit = initialLimit;
  const holders = new Map<string, SlotInfo>();
  const waiting: Waiter[] = [];
  const free = () => limit === null || holders.size < limit;

  const pump = () => {
    while (waiting.length > 0 && free()) {
      const next = waiting.shift() as Waiter;
      holders.set(next.info.entryId, next.info);
      next.grant(true);
    }
  };

  return {
    acquire(info) {
      let settle: (granted: boolean) => void = () => {};
      const promise = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      let done = false;
      const waiter: Waiter = { info, grant: settle };
      waiting.push(waiter);
      pump();
      onChange();
      const release = () => {
        if (done) return;
        done = true;
        const index = waiting.indexOf(waiter);
        if (index >= 0) {
          waiting.splice(index, 1);
          settle(false);
        } else holders.delete(info.entryId);
        pump();
        onChange();
      };
      return { promise, cancel: release, release };
    },
    setLimit(next) {
      limit = next;
      pump();
      onChange();
    },
    snapshot: () => ({ holders: [...holders.values()], waiting: waiting.map((waiter) => waiter.info) }),
    has: (entryId) => holders.has(entryId) || waiting.some((waiter) => waiter.info.entryId === entryId),
  };
}
