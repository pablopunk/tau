import { Worker } from "node:worker_threads";
import type { WatchdogWorkerData } from "./worker";

const BEAT_MS = 1000;

export interface WatchdogOptions {
  readonly lastExitFile: string;
  readonly logFile?: string;
  /** `dist/watchdog.js` next to the bundle. */
  readonly workerUrl: URL;
  readonly tickMs?: number;
  readonly stallTicks?: number;
}

export interface Watchdog {
  stop(): Promise<void>;
}

/** Beats a shared counter once a second from the main thread; a worker kills the process when it stops moving. */
export function startWatchdog(options: WatchdogOptions): Watchdog {
  const counter = new SharedArrayBuffer(4);
  const view = new Int32Array(counter);
  const data: WatchdogWorkerData = {
    counter,
    lastExitFile: options.lastExitFile,
    logFile: options.logFile,
    tickMs: options.tickMs,
    stallTicks: options.stallTicks,
  };
  const worker = new Worker(options.workerUrl, { workerData: data });
  worker.unref();
  const beat = setInterval(() => Atomics.add(view, 0, 1), BEAT_MS);
  beat.unref();
  return {
    async stop() {
      clearInterval(beat);
      await worker.terminate();
    },
  };
}
