import type { UpdaterPort } from "@tau/protocol";

/**
 * Per-backend gate: `install.mode` is `manual` on a backend until its real restart-survival run has passed
 * (UPDATE-BUTTON.md section 5). Flip a value only in the commit that records the passing run.
 * The detached backend and foreground runs have no supervisor, so they are `run` from the start.
 */
export const BACKEND_VERIFIED = { systemd: false, launchd: false, detached: true } as const;

export interface UpdaterDeps {
  readonly home: string;
}

/** The job file `<home>/update.json`; `from` stays here and is never sent to the web. */
export interface JobFile {
  readonly state: "installing" | "restarting" | "failed" | "idle";
  readonly target: string;
  readonly from: string;
  readonly nonce: string;
  readonly pid: number | null;
  readonly startedAt: number;
  readonly error: string | null;
}

/** STUB (cli owner): plan from `installMethodOf` and `BACKEND_VERIFIED`, spawn per backend, job file with staleness rules. */
export async function createUpdater(_deps: UpdaterDeps): Promise<UpdaterPort> {
  throw new Error("createUpdater is not implemented yet");
}
