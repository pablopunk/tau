import { createWriteStream, type WriteStream } from "node:fs";

export const LOG_FILE_LIMIT_BYTES = 10 * 1024 * 1024;

export interface LogFile {
  append(chunk: string): void;
  close(): Promise<void>;
}

export function openLogFile(path: string, limit = LOG_FILE_LIMIT_BYTES): LogFile {
  const stream: WriteStream = createWriteStream(path, { flags: "a", mode: 0o600 });
  stream.on("error", () => undefined);
  let written = 0;
  return {
    append(chunk) {
      const room = limit - written;
      if (room <= 0) return;
      const piece = Buffer.from(chunk).subarray(0, room);
      written += piece.length;
      stream.write(piece);
    },
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}
