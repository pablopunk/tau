import type { ProcessInfo } from "@tau/protocol";

export const runningCount = (processes: readonly ProcessInfo[]): number =>
  processes.filter((process) => process.state === "running" || process.state === "queued").length;

export const stateLabel = (process: ProcessInfo): string => {
  if (process.state === "queued") return "Queued";
  if (process.state === "running") return "Running";
  if (process.state === "killed") return "Stopped";
  return process.exitCode === 0 || process.exitCode === null ? "Exited" : `Exited ${process.exitCode}`;
};
