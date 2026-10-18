import type { Core } from "@tau/protocol";
import { notImplemented } from "./not-implemented";

/** Owner C (MVP8) implements it: `Core.timers`, see MVP8.md sections 4 and 5. */
export function createTimersApi(): Core["timers"] {
  const stub = (what: string) => async (): Promise<never> => {
    throw notImplemented(`timers.${what}`);
  };
  return { list: stub("list"), delete: stub("delete"), loop: stub("loop"), stopLoop: stub("stopLoop") };
}
