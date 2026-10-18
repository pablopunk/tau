import { createReadStream, existsSync, readFileSync, statSync, watchFile } from "node:fs";
import { serverLogOf } from "../logging/rotating-log";
import { realContext } from "../service/context";
import { lifecycleFlagsOf } from "./flags";

const TAIL_LINES = 200;

export const lastLinesOf = (text: string, count: number): string =>
  text.trimEnd().split("\n").slice(-count).join("\n");

function follow(file: string, from: number, write: (text: string) => void): void {
  let position = from;
  watchFile(file, { interval: 500 }, (current) => {
    if (current.size < position) position = 0;
    if (current.size === position) return;
    createReadStream(file, { start: position, end: current.size - 1, encoding: "utf8" }).on("data", (chunk) =>
      write(String(chunk)),
    );
    position = current.size;
  });
}

/** `tau logs [-f]`: the last lines of `<home>/logs/server.log`, then new ones with `-f`. */
export async function runLogs(
  argv: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<void> {
  const flags = lifecycleFlagsOf(argv, realContext());
  const file = serverLogOf(flags.home);
  if (!existsSync(file)) throw new Error(`No log yet: ${file}`);
  write(`${lastLinesOf(readFileSync(file, "utf8"), TAIL_LINES)}\n`);
  if (!flags.follow) return;
  follow(file, statSync(file).size, write);
  await new Promise<void>(() => undefined);
}
