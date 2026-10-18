export const COALESCE_MS = 8;
export const COALESCE_MAX_BYTES = 16 * 1024;
export const MAX_FRAME_BYTES = 64 * 1024;

export interface Coalescer {
  push(data: Uint8Array): void;
  flush(): void;
  dispose(): void;
}

/** Joins chunks arriving within `COALESCE_MS` (or up to `COALESCE_MAX_BYTES`) into one frame; no frame exceeds `MAX_FRAME_BYTES`. */
export function createCoalescer(send: (frame: Uint8Array) => void): Coalescer {
  let pending: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (size === 0) return;
    const frame = Buffer.concat(pending, size);
    pending = [];
    size = 0;
    send(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  }

  function add(chunk: Uint8Array): void {
    pending.push(chunk);
    size += chunk.length;
    if (size >= COALESCE_MAX_BYTES) flush();
    else timer ??= setTimeout(flush, COALESCE_MS);
  }

  return {
    push(data) {
      for (let at = 0; at < data.length; at += MAX_FRAME_BYTES) {
        if (size + Math.min(MAX_FRAME_BYTES, data.length - at) > MAX_FRAME_BYTES) flush();
        add(data.subarray(at, at + MAX_FRAME_BYTES));
      }
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = [];
      size = 0;
    },
  };
}
