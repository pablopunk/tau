import type { RunningWork, UpdateStatus } from "@tau/protocol";

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? "" : "s"}`;

export const updateTitle = (latest: string): string => `Update tau to ${latest}?`;

export const updateBody = (current: string, reason: string | null): string =>
  `You have ${current}. ${reason ?? "tau will restart and the page reconnects in under a minute."}`;

export function runningWorkText(work: RunningWork): string | null {
  const parts = [
    work.threads.length > 0 ? plural(work.threads.length, "thread") : null,
    work.subagents.length > 0 ? plural(work.subagents.length, "subagent") : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  const verb = work.threads.length + work.subagents.length === 1 ? "is" : "are";
  const resume = work.resuming.length > 0 ? " Threads with timers or a goal resume afterwards." : "";
  return `${parts.join(" and ")} ${verb} running. They will be stopped.${resume}`;
}

export const confirmLabel = (hasWork: boolean): string =>
  hasWork ? "Stop work and update" : "Update and restart";

export const manualTitle = "Update tau";
export const manualBody = (reason: string | null): string =>
  `This tau can't update itself${reason ? `: ${reason}` : "."}`;

export const progressLabel = (job: UpdateStatus["job"]): string =>
  job.state === "restarting" ? "Restarting…" : `Installing ${job.target ?? ""}…`.replace(" …", "…");

export const FAILED_BODY = "The update failed.";
export const GAVE_UP = "tau did not come back. Run `tau status`.";
export const updatedToast = (version: string): string => `tau updated to ${version}`;
