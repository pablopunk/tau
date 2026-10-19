import { isBehind, type UpdateStatus } from "@tau/protocol";

export const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
export const MIN_REFRESH_GAP_MS = 60_000;
export const FETCH_TIMEOUT_MS = 10_000;

export interface UpdateServiceDeps {
  readonly currentVersion: string;
  readonly latestVersion: () => Promise<string>;
  readonly now: () => number;
}

export interface UpdateService {
  status(): Promise<UpdateStatus>;
  refresh(): Promise<UpdateStatus>;
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

  return {
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
