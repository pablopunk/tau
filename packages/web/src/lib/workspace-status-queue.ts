const MAX_ACTIVE = 2;
const TIMEOUT_MS = 10_000;

/** Advisory Git reads must leave browser connections available for messages and navigation. */
export function createWorkspaceStatusQueue() {
  let active = 0;
  const waiting: Array<() => void> = [];

  const drain = () => {
    while (active < MAX_ACTIVE && waiting.length > 0) waiting.shift()?.();
  };

  return <T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const cancel = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason);
      };
      const start = () => {
        signal?.removeEventListener("abort", cancel);
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        active++;
        void Promise.resolve()
          .then(async () => {
            const controller = new AbortController();
            const abort = () => controller.abort(signal?.reason);
            signal?.addEventListener("abort", abort, { once: true });
            const timer = setTimeout(
              () => controller.abort(new DOMException("Workspace status timed out", "TimeoutError")),
              TIMEOUT_MS,
            );
            try {
              if (signal?.aborted) abort();
              controller.signal.throwIfAborted();
              return await read(controller.signal);
            } finally {
              clearTimeout(timer);
              signal?.removeEventListener("abort", abort);
            }
          })
          .then(resolve, reject)
          .finally(() => {
            active--;
            drain();
          });
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", cancel, { once: true });
      waiting.push(start);
      drain();
    });
}
