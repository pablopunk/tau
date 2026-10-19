import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobFile } from "./updater";

export const jobFileOf = (home: string) => join(home, "update.json");
export const logFileOf = (home: string) => join(home, "update.log");

const STATES: readonly string[] = ["installing", "restarting", "failed", "idle"];

function isJobFile(value: unknown): value is JobFile {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.state === "string" &&
    STATES.includes(job.state) &&
    typeof job.target === "string" &&
    typeof job.from === "string" &&
    typeof job.nonce === "string" &&
    (job.pid === null || typeof job.pid === "number") &&
    typeof job.startedAt === "number" &&
    (job.error === null || typeof job.error === "string")
  );
}

/** A missing, unreadable or corrupt file is no job. */
export function readJobFile(home: string): JobFile | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(jobFileOf(home), "utf8"));
    return isJobFile(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic (temp file, then rename) and private. Throws on any write error (ENOSPC included). */
export function writeJobFile(home: string, job: JobFile, suffix = `${process.pid}`): void {
  mkdirSync(home, { recursive: true });
  const temp = `${jobFileOf(home)}.${suffix}.tmp`;
  writeFileSync(temp, JSON.stringify(job), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, jobFileOf(home));
}
