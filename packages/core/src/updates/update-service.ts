import {
  AppError,
  IDLE_JOB,
  isBehind,
  NO_INSTALL,
  type UpdaterPort,
  type UpdateStartBody,
  type UpdateStatus,
} from "@tau/protocol";

export const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
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

  const snapshot = (): UpdateStatus => ({
    current: deps.currentVersion,
    latest,
    checkedAt,
    behind: latest === null ? false : (isBehind(deps.currentVersion, latest) ?? false),
    // STUB (core owner): merge `deps.updater.plan(latest)` and `readJob()` (1 s cache); redaction is the server's.
    canUpdate: true,
    install: NO_INSTALL,
    job: IDLE_JOB,
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

  const startTimer = () => {
    if (timer || stopped) return;
    timer = setInterval(() => void check(), REFRESH_EVERY_MS);
    timer.unref();
  };

  if (deps.autoStart) {
    void check();
    startTimer();
  }

  return {
    async start(_body) {
      // STUB (core owner): update_unsupported / update_busy rules, then `deps.updater.spawn`.
      throw new AppError("update_unsupported", "Updating from the app is not available yet.");
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
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
