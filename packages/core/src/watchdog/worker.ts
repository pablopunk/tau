import { workerData } from "node:worker_threads";
import { monotonicNow } from "./clock";
import { writeLastExitSync } from "./last-exit-write";
import { createWatchdogLoop, TICK_MS } from "./watchdog-loop";

export interface WatchdogWorkerData {
  readonly counter: SharedArrayBuffer;
  readonly lastExitFile: string;
  readonly logFile?: string;
  readonly tickMs?: number;
  readonly stallTicks?: number;
  readonly sleepGapMs?: number;
}

const data = workerData as WatchdogWorkerData;
const counter = new Int32Array(data.counter);

const loop = createWatchdogLoop({
  readCounter: () => Atomics.load(counter, 0),
  now: monotonicNow,
  stallTicks: data.stallTicks,
  sleepGapMs: data.sleepGapMs,
  onStall: (detail) => {
    writeLastExitSync(data.lastExitFile, data.logFile, { reason: "watchdog", at: Date.now(), detail });
    // `process.exit` in a worker ends only the worker; SIGKILL ends the process and the OS service restarts it.
    process.kill(process.pid, "SIGKILL");
  },
});

setInterval(() => loop.tick(), data.tickMs ?? TICK_MS);
