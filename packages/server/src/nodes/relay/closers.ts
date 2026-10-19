/** A live routed stream this node serves or relays, findable by the nodes it belongs to. */
export interface Closer {
  readonly origin: string;
  /** `trail[0]`: the first hop the origin handed the frame to. */
  readonly first: string;
  alive(): boolean;
  close(code: number, reason: string): void;
}

const PURGE_AT = 1024;

/** Every routed stream by origin, so a tombstone (or a cut link) closes them all. */
export function createClosers() {
  const all = new Set<Closer>();
  return {
    add(closer: Closer): void {
      if (all.size >= PURGE_AT) for (const entry of all) if (!entry.alive()) all.delete(entry);
      all.add(closer);
    },
    closeWhere(match: (closer: Closer) => boolean, code: number, reason: string): void {
      for (const closer of [...all]) {
        if (!closer.alive()) all.delete(closer);
        else if (match(closer)) closer.close(code, reason);
      }
    },
    size: () => all.size,
  };
}
export type Closers = ReturnType<typeof createClosers>;
