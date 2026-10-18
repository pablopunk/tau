export const STALL_BYTES = 1024 * 1024;
export const STALL_MS = 5000;
const CHECK_MS = 250;

export interface Bufferable {
  readonly bufferedAmount: number;
}

/** Calls `onStalled` once the buffer has stayed above `STALL_BYTES` for `STALL_MS`. Returns the stop function. */
export function watchStall(socket: Bufferable, onStalled: () => void, now = Date.now): () => void {
  let since: number | undefined;
  const timer = setInterval(() => {
    if (socket.bufferedAmount <= STALL_BYTES) {
      since = undefined;
      return;
    }
    since ??= now();
    if (now() - since >= STALL_MS) {
      clearInterval(timer);
      onStalled();
    }
  }, CHECK_MS);
  return () => clearInterval(timer);
}
