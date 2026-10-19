import type { RunCommand } from "./command-runner";
import { readJobFile, writeJobFile } from "./job-file";
import { launchdRemoveArgs } from "./spawn-child";

export interface JobReporter {
  step(state: "installing" | "restarting" | "idle" | "failed", error?: string): void;
  /** Last step of a `launchctl submit` child: remove its own label. */
  release(run: RunCommand): Promise<void>;
}

/** True only for the child the updater spawned: the nonce matches the job file and `pid` is the recorded one. */
export function isUpdateChild(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  pid: number,
): boolean {
  const nonce = env.TAU_UPDATE_JOB;
  const job = readJobFile(home);
  return Boolean(nonce) && job !== undefined && job.nonce === nonce && job.pid === pid;
}

/**
 * The child's side of the job file: writes its own pid now and every step later. Best effort: a write error
 * (ENOSPC) must not stop the update. Without a matching nonce there is no job and every call does nothing.
 */
export function createJobReporter(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  pid: number,
): JobReporter | undefined {
  const nonce = env.TAU_UPDATE_JOB;
  if (!nonce || readJobFile(home)?.nonce !== nonce) return undefined;
  const step: JobReporter["step"] = (state, error) => {
    const job = readJobFile(home);
    if (job === undefined || job.nonce !== nonce) return;
    try {
      writeJobFile(home, { ...job, state, pid, error: error ?? null }, `child-${pid}`);
    } catch {
      // nothing more to do
    }
  };
  step("installing");
  const label = env.TAU_UPDATE_LABEL;
  return {
    step,
    async release(run) {
      if (label) await run("launchctl", launchdRemoveArgs(label), { stdio: "capture" });
    },
  };
}
