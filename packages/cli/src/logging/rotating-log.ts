import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const MAX_LOG_BYTES = 10 * 1024 * 1024;

export const serverLogOf = (home: string) => join(home, "logs", "server.log");

const sizeOf = (file: string): number => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

export interface RotatingLog {
  write(text: string): void;
}

/** Appends to `file`; past `maxBytes` the file becomes `<file>.1` (one old file is kept). */
export function createRotatingLog(file: string, maxBytes: number = MAX_LOG_BYTES): RotatingLog {
  mkdirSync(dirname(file), { recursive: true });
  return {
    write(text) {
      if (sizeOf(file) + Buffer.byteLength(text) > maxBytes) renameSync(file, `${file}.1`);
      appendFileSync(file, text);
    },
  };
}
