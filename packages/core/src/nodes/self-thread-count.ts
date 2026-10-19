import type { ChangeEmitter } from "../change-emitter";

export interface SelfThreadCount {
  current(): number;
  stop(): void;
}

/** The unarchived thread count this node announces; read sync, refreshed after every conversation change. */
export function createSelfThreadCount(
  count: () => Promise<number>,
  changes: Pick<ChangeEmitter, "subscribe">,
): SelfThreadCount {
  let value = 0;
  let running: Promise<void> | undefined;
  let again = false;
  const refresh = () => {
    if (running) {
      again = true;
      return;
    }
    running = count()
      .then((next) => {
        value = next;
      })
      .catch(() => undefined)
      .finally(() => {
        running = undefined;
        if (again) {
          again = false;
          refresh();
        }
      });
  };
  const unsubscribe = changes.subscribe((change) => {
    if (change.resource === "conversations") refresh();
  });
  refresh();
  return { current: () => value, stop: unsubscribe };
}
