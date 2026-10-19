import type { UpdateInstall, UpdateJob, UpdateStartBody, UpdateStatus } from "@tau/protocol";
import { AppError, IDLE_JOB, isBehind } from "@tau/protocol";

export interface FakeUpdatesOptions {
  readonly now: () => number;
  /** This tau's version. Default `0.0.0`. */
  readonly currentVersion?: string;
  /** What the registry answers. Default `null`: unreachable, so `status().latest` stays null. */
  readonly latest?: string | null;
  /** Default `{ mode: "run" }`. */
  readonly install?: UpdateInstall;
  /** Default true: the fake plays the owner. */
  readonly canUpdate?: boolean;
  /** The job ends `failed` instead of done. */
  readonly failUpdate?: boolean;
  /** Extra work the fake pretends is running: `start` without `force` is `update_busy`. */
  readonly busy?: boolean;
}

export interface FakeUpdates {
  readonly api: {
    status(): Promise<UpdateStatus>;
    refresh(): Promise<UpdateStatus>;
    start(body: UpdateStartBody): Promise<UpdateStatus>;
  };
  /** Changes what the next `refresh()` finds; `null` makes the registry unreachable. */
  setLatest(latest: string | null): void;
  /** Moves the job to its next step (installing → restarting → done or failed). Returns false when idle. */
  advance(): boolean;
}

const RUN_INSTALL: UpdateInstall = { mode: "run", command: null, reason: null };
const FAIL_TAIL = "npm error code E404";

export function createFakeUpdates(options: FakeUpdatesOptions): FakeUpdates {
  let current = options.currentVersion ?? "0.0.0";
  let registry = options.latest ?? null;
  let known: { latest: string; checkedAt: number } | undefined;
  let job: UpdateJob = IDLE_JOB;
  const snapshot = (): UpdateStatus => ({
    current,
    latest: known?.latest ?? null,
    checkedAt: known?.checkedAt ?? null,
    behind: known ? (isBehind(current, known.latest) ?? false) : false,
    canUpdate: options.canUpdate ?? true,
    install: options.install ?? RUN_INSTALL,
    job,
  });
  if (registry !== null) known = { latest: registry, checkedAt: options.now() };
  const advance = (): boolean => {
    if (job.state === "installing") {
      job = options.failUpdate
        ? { state: "failed", target: job.target, error: "The update failed.", logTail: FAIL_TAIL }
        : { ...job, state: "restarting" };
      return true;
    }
    if (job.state === "restarting") {
      current = job.target ?? current;
      job = IDLE_JOB;
      return true;
    }
    return false;
  };
  const refuse = (body: UpdateStartBody): void => {
    const install = options.install ?? RUN_INSTALL;
    if (install.mode !== "run" || !known || body.target !== known.latest || !snapshot().behind) {
      throw new AppError("update_unsupported", "This tau cannot update to that version.");
    }
    if (options.busy && !body.force) throw new AppError("update_busy", "Work is running.");
  };
  return {
    api: {
      async status() {
        return snapshot();
      },
      async refresh() {
        if (registry !== null) known = { latest: registry, checkedAt: options.now() };
        return snapshot();
      },
      async start(body) {
        if (job.state === "installing" || job.state === "restarting") return snapshot();
        refuse(body);
        job = { state: "installing", target: body.target, error: null, logTail: null };
        return snapshot();
      },
    },
    setLatest(latest) {
      registry = latest;
    },
    advance,
  };
}
