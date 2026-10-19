import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const TAIL_BYTES = 4096;
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is how ANSI escapes are matched
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** The last 4 KB of the log without colour codes; undefined when there is no log. */
export function logTailOf(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8").replace(ANSI, "");
    return text === "" ? null : text;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
