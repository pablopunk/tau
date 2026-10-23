import type { InvalidationStep } from "./invalidation-scope";

type Batch = {
  timer: ReturnType<typeof setTimeout>;
  trailingStep?: InvalidationStep;
};

type InvalidationBatcherOptions = {
  windowMs?: number;
};

function stableStepKey(step: InvalidationStep): string {
  return (
    JSON.stringify(step, (_key, value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    }) ?? ""
  );
}

export function createInvalidationBatcher(
  apply: (step: InvalidationStep) => void,
  { windowMs = 250 }: InvalidationBatcherOptions = {},
) {
  const batches = new Map<string, Batch>();
  let disposed = false;

  const enqueue = (step: InvalidationStep) => {
    if (disposed) return;

    const key = stableStepKey(step);
    const batch = batches.get(key);
    if (batch) {
      batch.trailingStep = step;
      return;
    }

    const nextBatch: Batch = {
      timer: setTimeout(() => {
        batches.delete(key);
        if (nextBatch.trailingStep) apply(nextBatch.trailingStep);
      }, windowMs),
    };
    batches.set(key, nextBatch);
    apply(step);
  };

  const dispose = () => {
    disposed = true;
    for (const batch of batches.values()) clearTimeout(batch.timer);
    batches.clear();
  };

  return { enqueue, dispose };
}
