export interface MessageChannel<T> extends AsyncIterable<T> {
  push(value: T): void;
  end(): void;
}

export function createMessageChannel<T>(): MessageChannel<T> {
  const queue: T[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  async function* iterate(): AsyncGenerator<T> {
    while (true) {
      while (queue.length === 0 && !ended) await new Promise<void>((resolve) => (wake = resolve));
      const next = queue.shift();
      if (next === undefined) return;
      yield next;
    }
  }
  return {
    [Symbol.asyncIterator]: iterate,
    push(value) {
      if (ended) return;
      queue.push(value);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
  };
}
