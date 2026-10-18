import type { Change } from "@tau/protocol";

export interface ChangeEmitter {
  emit(change: Change): void;
  subscribe(listener: (change: Change) => void): () => void;
  clear(): void;
}

export function createChangeEmitter(): ChangeEmitter {
  const listeners = new Set<(change: Change) => void>();
  return {
    emit(change) {
      for (const listener of [...listeners]) {
        try {
          listener(change);
        } catch (error) {
          console.error("A change listener threw", error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: () => listeners.clear(),
  };
}
