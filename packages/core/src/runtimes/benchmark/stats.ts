export const MIN_SAMPLES_FOR_PERCENTILES = 20;

export type PercentileStatus = "reported" | "insufficient-samples" | "no-samples";

export interface Summary {
  readonly count: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly percentileStatus: PercentileStatus;
}

const THOUSANDTH = 1000;

const round = (value: number): number => Math.round(value * THOUSANDTH) / THOUSANDTH;

const ascending = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

/** Nearest-rank percentile of an ascending list, `fraction` in (0, 1]. */
export function nearestRank(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error("percentile of no samples");
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

export function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const EMPTY: Summary = {
  count: 0,
  min: null,
  median: null,
  max: null,
  p50: null,
  p95: null,
  percentileStatus: "no-samples",
};

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return EMPTY;
  const sorted = ascending(values);
  const enough = sorted.length >= MIN_SAMPLES_FOR_PERCENTILES;
  return {
    count: sorted.length,
    min: round(sorted[0] as number),
    median: round(medianOf(sorted)),
    max: round(sorted[sorted.length - 1] as number),
    p50: enough ? round(nearestRank(sorted, 0.5)) : null,
    p95: enough ? round(nearestRank(sorted, 0.95)) : null,
    percentileStatus: enough ? "reported" : "insufficient-samples",
  };
}
