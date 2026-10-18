export const BATCH_WINDOW_MS = 1000;
export const BATCH_MAX_LINES = 20;
export const NOISE_LIMIT = 30;
export const NOISE_WINDOW_MS = 60_000;

export interface MonitorBatch {
  readonly lines: string[];
  readonly dropped: number;
}

export interface MonitorBatcherOptions {
  readonly send: (batch: MonitorBatch) => void;
  readonly onNoisy: () => void;
  readonly batchMs?: number;
  readonly maxLines?: number;
  readonly noiseLimit?: number;
  readonly noiseWindowMs?: number;
  readonly now?: () => number;
}

export interface MonitorBatcher {
  push(line: string): void;
  /** Sends what is waiting now; no timer stays armed. */
  flush(): void;
  close(): void;
}

export function createMonitorBatcher(options: MonitorBatcherOptions): MonitorBatcher {
  const batchMs = options.batchMs ?? BATCH_WINDOW_MS;
  const maxLines = options.maxLines ?? BATCH_MAX_LINES;
  const noiseLimit = options.noiseLimit ?? NOISE_LIMIT;
  const noiseWindowMs = options.noiseWindowMs ?? NOISE_WINDOW_MS;
  const now = options.now ?? Date.now;
  let lines: string[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sentAt: number[] = [];
  let closed = false;

  const tooNoisy = () => {
    const cutoff = now() - noiseWindowMs;
    sentAt = sentAt.filter((at) => at > cutoff);
    sentAt.push(now());
    return sentAt.length > noiseLimit;
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (closed || (lines.length === 0 && dropped === 0)) return;
    const batch = { lines, dropped };
    lines = [];
    dropped = 0;
    if (tooNoisy()) {
      closed = true;
      options.onNoisy();
      return;
    }
    options.send(batch);
  };

  return {
    push(line) {
      if (closed) return;
      if (lines.length < maxLines) lines.push(line);
      else dropped += 1;
      timer ??= setTimeout(flush, batchMs);
    },
    flush,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
