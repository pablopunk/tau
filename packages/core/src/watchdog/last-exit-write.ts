import { appendFileSync, writeFileSync } from "node:fs";

export type ExitReason = "clean" | "watchdog" | "signal" | "unknown";

export interface LastExit {
  readonly reason: ExitReason;
  readonly at: number;
  readonly detail?: string;
}

/** Synchronous on purpose: the watchdog writes this just before it kills the process. */
export function writeLastExitSync(file: string, logFile: string | undefined, exit: LastExit): void {
  writeFileSync(file, `${JSON.stringify(exit)}\n`, { mode: 0o600 });
  if (logFile && exit.reason === "watchdog")
    appendFileSync(logFile, `tau: watchdog killed the server (${exit.detail ?? exit.reason})\n`);
}
