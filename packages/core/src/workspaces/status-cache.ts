const FRESH_MS = 5_000;
const MAX_ENTRIES = 256;

/** Only advisory reads use this cache; mutations and destructive guards read Git directly. */
export function createStatusCache<T>(now = Date.now) {
  const values = new Map<string, { value: T; expires: number }>();
  const flights = new Map<string, Promise<T>>();
  let generation = 0;

  const get = (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = values.get(key);
    if (cached && now() < cached.expires) return Promise.resolve(cached.value);
    values.delete(key);
    const pending = flights.get(key);
    if (pending) return pending;
    const started = generation;
    const flight = Promise.resolve()
      .then(load)
      .then((value) => {
        if (generation !== started) return get(key, load);
        values.set(key, { value, expires: now() + FRESH_MS });
        if (values.size > MAX_ENTRIES) {
          const oldest = values.keys().next().value;
          if (oldest !== undefined) values.delete(oldest);
        }
        return value;
      })
      .finally(() => {
        if (flights.get(key) === flight) flights.delete(key);
      });
    flights.set(key, flight);
    return flight;
  };

  return {
    get,
    invalidate() {
      generation++;
      values.clear();
      flights.clear();
    },
  };
}
