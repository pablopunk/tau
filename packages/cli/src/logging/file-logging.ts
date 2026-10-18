import { format } from "node:util";
import { createRotatingLog, serverLogOf } from "./rotating-log";

type ConsoleMethod = "log" | "info" | "warn" | "error";
const METHODS: readonly ConsoleMethod[] = ["log", "info", "warn", "error"];

/** Mirrors `console.*` into `<home>/logs/server.log` with timestamps. Returns a function that undoes it. */
export function mirrorConsoleToLogFile(home: string, target: Console = console): () => void {
  const log = createRotatingLog(serverLogOf(home));
  const originals = new Map<ConsoleMethod, Console[ConsoleMethod]>();
  for (const method of METHODS) {
    const original = target[method].bind(target);
    originals.set(method, target[method]);
    target[method] = (...args: unknown[]) => {
      original(...args);
      log.write(`${new Date().toISOString()} ${method} ${format(...args)}\n`);
    };
  }
  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}
