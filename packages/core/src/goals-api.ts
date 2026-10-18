import type { Core } from "@tau/protocol";
import { notImplemented } from "./not-implemented";

/** Owner D (MVP8) implements it: `Core.goals`, see MVP8.md section 7. */
export function createGoalsApi(): Core["goals"] {
  const stub = (what: string) => async (): Promise<never> => {
    throw notImplemented(`goals.${what}`);
  };
  return { set: stub("set"), get: stub("get"), clear: stub("clear") };
}
