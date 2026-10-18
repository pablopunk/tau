import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ExitReason, type LastExit, writeLastExitSync } from "./last-exit-write";

export const CRASH_LOOP_STARTS = 5;
export const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000;
const KEEP_STARTS = 10;
const REASONS: readonly ExitReason[] = ["clean", "watchdog", "signal", "unknown"];

export interface StartRecordFiles {
  readonly startsFile: string;
  readonly lastExitFile: string;
  readonly runningFile: string;
}

export const startRecordFiles = (home: string): StartRecordFiles => ({
  startsFile: join(home, "starts.json"),
  lastExitFile: join(home, "last-exit.json"),
  runningFile: join(home, "running.json"),
});

export interface StartRecord {
  readonly previousExit: LastExit;
  /** Set when 5 starts fell in 5 minutes: the server starts with remote off. */
  readonly crashLoop: boolean;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

const numberOf = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

function readStarts(file: string): number[] {
  const parsed = readJson(file);
  return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
}

/** A run that never wrote its end left `last-exit.json` older than its own `running.json`: `unknown`. */
function previousExitOf(files: StartRecordFiles): LastExit {
  const exit = readJson(files.lastExitFile) as Partial<LastExit> | undefined;
  const startedAt = numberOf((readJson(files.runningFile) as { startedAt?: unknown } | undefined)?.startedAt);
  const at = numberOf(exit?.at);
  const reason = REASONS.find((r) => r === exit?.reason);
  const ended = reason !== undefined && at !== undefined && (startedAt === undefined || at >= startedAt);
  if (ended) return { reason, at, detail: exit?.detail };
  return { reason: "unknown", at: startedAt ?? at ?? 0 };
}

export function isCrashLoop(starts: readonly number[], now: number): boolean {
  return starts.filter((t) => now - t <= CRASH_LOOP_WINDOW_MS).length >= CRASH_LOOP_STARTS;
}

/** Reads the previous run's end, records this start (last 10) and marks the run as running. */
export function recordStart(files: StartRecordFiles, now: number): StartRecord {
  mkdirSync(dirname(files.startsFile), { recursive: true });
  const previousExit = previousExitOf(files);
  const starts = [...readStarts(files.startsFile), now].slice(-KEEP_STARTS);
  writeFileSync(files.startsFile, `${JSON.stringify(starts)}\n`, { mode: 0o600 });
  writeFileSync(files.runningFile, `${JSON.stringify({ startedAt: now })}\n`, { mode: 0o600 });
  return { previousExit, crashLoop: isCrashLoop(starts, now) };
}

export const CRASH_LOOP_TEXT =
  "Remote access is off because tau restarted 5 times in 5 minutes. Turn it on again when ready.";

/** Written once at the end of a run; the first writer wins, so a signal is not turned into `clean` by `exit`. */
export function createExitMarker(file: string, now: () => number = Date.now): (reason: ExitReason) => void {
  let written = false;
  return (reason) => {
    if (written) return;
    written = true;
    writeLastExitSync(file, undefined, { reason, at: now() });
  };
}
