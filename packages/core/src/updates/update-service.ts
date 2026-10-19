import {
  AppError,
  type ConversationSummary,
  hasRunningWork,
  IDLE_JOB,
  isBehind,
  NO_INSTALL,
  runningWorkOf,
  type UpdateJob,
  type UpdaterPort,
  type UpdateStartBody,
  type UpdateStatus,
} from "@tau/protocol";

export const REFRESH_EVERY_MS = 15 * 60_000;
export const JITTER = 0.1;
export const JOB_CACHE_MS = 1_000;
export const MIN_REFRESH_GAP_MS = 60_000;
export const FETCH_TIMEOUT_MS = 10_000;

export interface UpdateServiceDeps {
  readonly currentVersion: string;
  readonly latestVersion: () => Promise<string>;
  readonly now: () => number;
  /** Default false: nothing contacts the registry until `status()`/`refresh()`. The CLI sets true. */
  readonly autoStart?: boolean;
  /** From the CLI. Absent (tests, faux): `install.mode` is `none` and `start` is `update_unsupported`. */
  readonly updater?: UpdaterPort;
  /** Every conversation, for the `update_busy` check. Absent: nothing counts as running. */
  readonly listConversations?: () => Promise<readonly ConversationSummary[]>;
  /** 0..1, injectable for tests. */
  readonly random?: () => number;
}

export interface UpdateService {
  status(): Promise<UpdateStatus>;
  refresh(): Promise<UpdateStatus>;
  start(body: UpdateStartBody): Promise<UpdateStatus>;
  stop(): void;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
    timer.unref();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  let latest: string | null = null;
  let checkedAt: number | null = null;
  let lastAttemptAt: number | null = null;
  let inflight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  let jobCache: { at: number; job: UpdateJob } | undefined;
  const invalidateJob = () => {
    jobCache = undefined;
  };

  const readJob = async (): Promise<UpdateJob> => {
    if (!deps.updater) return IDLE_JOB;
    if (jobCache && deps.now() - jobCache.at < JOB_CACHE_MS) return jobCache.job;
    const raw = await deps.updater.readJob().catch(() => IDLE_JOB);
    const job = raw.target !== null && raw.target === deps.currentVersion ? IDLE_JOB : raw;
    jobCache = { at: deps.now(), job };
    return job;
  };

  const isActive = (job: UpdateJob) => job.state === "installing" || job.state === "restarting";
  const isBehindNow = () => (latest === null ? false : (isBehind(deps.currentVersion, latest) ?? false));

  const snapshot = async (): Promise<UpdateStatus> => ({
    current: deps.currentVersion,
    latest,
    checkedAt,
    behind: isBehindNow(),
    // The owner's view: only the server downgrades it per caller.
    canUpdate: true,
    install: deps.updater && latest !== null ? deps.updater.plan(latest) : NO_INSTALL,
    job: await readJob(),
  });

  const check = (): Promise<void> => {
    if (inflight) return inflight;
    lastAttemptAt = deps.now();
    inflight = withTimeout(Promise.resolve().then(deps.latestVersion), FETCH_TIMEOUT_MS)
      .then((version) => {
        latest = version;
        checkedAt = deps.now();
      })
      .catch(() => undefined)
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  const nextDelay = () => REFRESH_EVERY_MS * (1 + JITTER * (2 * (deps.random ?? Math.random)() - 1));

  const arm = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void check().finally(arm);
    }, nextDelay());
    timer.unref();
  };

  const startTimer = () => {
    if (timer || stopped) return;
    arm();
  };

  const assertCanStart = async (body: UpdateStartBody) => {
    const install = deps.updater && latest !== null ? deps.updater.plan(latest) : NO_INSTALL;
    if (install.mode !== "run" || body.target !== latest || !isBehindNow()) {
      throw new AppError("update_unsupported", "This tau cannot update to that version from here.");
    }
  };

  if (deps.autoStart) {
    void check();
    startTimer();
  }

  return {
    async start(body) {
      await assertCanStart(body);
      const updater = deps.updater as UpdaterPort;
      invalidateJob();
      if (isActive(await readJob())) return snapshot();
      if (!body.force && deps.listConversations) {
        const work = runningWorkOf(await deps.listConversations());
        if (hasRunningWork(work)) throw new AppError("update_busy", "Threads are still running.");
      }
      invalidateJob();
      await updater.spawn({ target: body.target });
      invalidateJob();
      return snapshot();
    },
    async status() {
      if (lastAttemptAt === null && !stopped) {
        void check();
        startTimer();
      }
      return snapshot();
    },
    async refresh() {
      if (stopped) return snapshot();
      startTimer();
      const recent = lastAttemptAt !== null && deps.now() - lastAttemptAt < MIN_REFRESH_GAP_MS;
      if (inflight) await inflight;
      else if (!recent) await check();
      return snapshot();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
