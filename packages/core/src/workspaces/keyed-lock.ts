export interface KeyedLock {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run(key, task) {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
