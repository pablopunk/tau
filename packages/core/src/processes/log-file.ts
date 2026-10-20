import { createWriteStream, type WriteStream } from "node:fs";

export const LOG_FILE_LIMIT_BYTES = 10 * 1024 * 1024;

export interface LogFile {
  append(chunk: string): void;
  close(): Promise<void>;
  /** Bytes shed while the stream or the size cap could not keep up. */
  droppedBytes(): number;
}

export function openLogFile(path: string, limit = LOG_FILE_LIMIT_BYTES): LogFile {
  const stream: WriteStream = createWriteStream(path, { flags: "a", mode: 0o600 });
  stream.on("error", () => undefined);
  let written = 0;
  let dropped = 0;
  let shedding = false;
  stream.on("drain", () => {
    shedding = false;
  });
  return {
    append(chunk) {
      const size = Buffer.byteLength(chunk);
      const room = limit - written;
      if (room <= 0 || shedding) {
        dropped += size;
        return;
      }
      const piece = Buffer.from(chunk).subarray(0, room);
      if (piece.length < size) dropped += size - piece.length;
      written += piece.length;
      if (!stream.write(piece)) shedding = true;
    },
    close: () => new Promise((resolve) => stream.end(resolve)),
    droppedBytes: () => dropped,
  };
}
