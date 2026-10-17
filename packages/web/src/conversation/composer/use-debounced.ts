import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useDebouncedAfterFirst(value: string | null, delayMs: number): string | null {
  const debounced = useDebounced(value, delayMs);
  const justOpened = debounced === null || value === null;
  return justOpened ? value : debounced;
}
