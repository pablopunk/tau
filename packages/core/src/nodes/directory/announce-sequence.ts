import { join } from "node:path";
import { nextBoot } from "@tau/protocol/identity";
import { readFileIfPresent, writeFileAtomic } from "../../home/atomic-write";

/** `boot` is persisted once per process start (`<home>/announce-boot.json`); `counter` lives in memory from 0. */
export interface AnnounceSequence {
  next(): Promise<{ boot: number; counter: number }>;
  /** A new identity restarts the order (a new origin has no history). */
  restart(): void;
}

export function createAnnounceSequence(home: string, now: () => number): AnnounceSequence {
  const file = join(home, "announce-boot.json");
  let boot: Promise<number> | undefined;
  let counter = 0;
  const readLast = async (): Promise<number> => {
    try {
      const value = Number(JSON.parse((await readFileIfPresent(file)) ?? "{}").boot);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  };
  const start = async () => {
    const next = nextBoot(await readLast(), now());
    await writeFileAtomic(file, `${JSON.stringify({ boot: next })}\n`);
    return next;
  };
  return {
    async next() {
      boot ??= start();
      return { boot: await boot, counter: counter++ };
    },
    restart() {
      counter = 0;
    },
  };
}
