import type { Binding } from "./binding";
import type { Runtime } from "./runtime";

export const IDLE_CLOSE_MS = 15 * 60 * 1000;
export const SETTLE_TIMEOUT_MS = 5000;

const INTERRUPTED = "The tool call was interrupted.";

function flushOwedWaiters(binding: Binding): void {
  const waiters = binding.owedWaiters.splice(0);
  for (const wake of waiters) wake();
}

/** Closes the SDK process. The binding keeps its checkpoints, so the next call can resume. */
export function closeQuery(rt: Runtime, binding: Binding): void {
  const query = binding.query;
  if (!query) return;
  binding.query = null;
  binding.input?.close();
  binding.input = null;
  binding.calls.rejectAll(new Error(INTERRUPTED));
  binding.expected.clear();
  binding.owedResults = 0;
  flushOwedWaiters(binding);
  rt.live.delete(binding);
  rt.notifyProcesses();
  query.close();
}

function waitForOwedResults(rt: Runtime, binding: Binding): Promise<void> {
  if (binding.owedResults === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const cancel = rt.deps.clock.setTimer(done, SETTLE_TIMEOUT_MS);
    function done() {
      cancel();
      resolve();
    }
    binding.owedWaiters.push(done);
  });
}

/** `interrupt()` first, then reject the open deferreds. Never `abortController.abort()`: the CLI retries. */
export async function interruptAndSettle(rt: Runtime, binding: Binding): Promise<void> {
  const query = binding.query;
  if (!query) return;
  binding.owedResults += 1;
  const settled = waitForOwedResults(rt, binding);
  await query.interrupt().catch(() => undefined);
  binding.calls.rejectAll(new Error(INTERRUPTED));
  binding.expected.clear();
  await settled;
}

export function noteResultSeen(binding: Binding): boolean {
  if (binding.owedResults === 0) return false;
  binding.owedResults -= 1;
  if (binding.owedResults === 0) flushOwedWaiters(binding);
  return true;
}

export function cancelIdle(binding: Binding): void {
  binding.idleCancel?.();
  binding.idleCancel = null;
}

const isBusy = (binding: Binding): boolean =>
  binding.listener !== null || binding.expected.size > 0 || binding.calls.hasParkedHandler();

export function touchIdle(rt: Runtime, binding: Binding): void {
  cancelIdle(binding);
  if (!binding.query) return;
  binding.idleCancel = rt.deps.clock.setTimer(() => {
    binding.idleCancel = null;
    if (isBusy(binding)) touchIdle(rt, binding);
    else closeQuery(rt, binding);
  }, IDLE_CLOSE_MS);
}
