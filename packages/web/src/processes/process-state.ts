import type { ProcessInfo } from "@pi-everywhere/protocol";

export const runningCount = (processes: readonly ProcessInfo[]): number =>
  processes.filter((process) => process.state === "running").length;

export const stateLabel = (process: ProcessInfo): string => {
  if (process.state === "running") return "Running";
  if (process.state === "killed") return "Stopped";
  return process.exitCode === 0 || process.exitCode === null ? "Exited" : `Exited ${process.exitCode}`;
};
