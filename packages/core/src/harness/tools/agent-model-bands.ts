import type { ModelInfo } from "@tau/protocol";

export type Band = "free" | "light" | "mid" | "heavy" | "unpriced";

type Cost = NonNullable<ModelInfo["cost"]>;

const MIN_PRICED_FOR_SPLIT = 4;

const rankOf = (cost: Cost) => cost.input + cost.output;
const isFree = (cost: Cost) => cost.input === 0 && cost.output === 0;

function bandOfGroup(before: number, after: number, n: number): Band {
  if (before < n / 3) return "light";
  if (after <= n / 3) return "heavy";
  return "mid";
}

function splitBands(ranks: readonly number[]): Map<number, Band> {
  const sorted = [...ranks].sort((a, b) => a - b);
  const distinct = [...new Set(sorted)];
  const bands = new Map<number, Band>();
  if (sorted.length < MIN_PRICED_FOR_SPLIT || distinct.length === 1) {
    for (const rank of distinct) bands.set(rank, "mid");
    return bands;
  }
  for (const rank of distinct) {
    const before = sorted.filter((other) => other < rank).length;
    bands.set(rank, bandOfGroup(before, sorted.length - before, sorted.length));
  }
  return bands;
}

/** One band per model, in input order. `free` only for a cost the lister already vetted as free. */
export function bandsOf(models: readonly Pick<ModelInfo, "cost">[]): Band[] {
  const priced = models.flatMap(({ cost }) => (cost && !isFree(cost) ? [rankOf(cost)] : []));
  const bands = splitBands(priced);
  return models.map(({ cost }) => {
    if (!cost) return "unpriced";
    if (isFree(cost)) return "free";
    return bands.get(rankOf(cost)) ?? "mid";
  });
}
