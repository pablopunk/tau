export const RING_LIMIT = 256 * 1024;
const ESC = 0x1b;
const NEWLINE = 0x0a;

const isContinuation = (byte: number) => (byte & 0xc0) === 0x80;

/** The kept output: a chunk list that drops from the front, never a copy per chunk. */
export interface RingBuffer {
  push(chunk: Uint8Array): void;
  /** The kept bytes, split into frames of at most `frameSize`. */
  frames(frameSize: number): Uint8Array[];
  readonly size: number;
}

export function createRingBuffer(limit = RING_LIMIT): RingBuffer {
  const chunks: Uint8Array[] = [];
  /** Index of the first live chunk: `shift()` would be quadratic on a flood of tiny chunks. */
  let head = 0;
  let size = 0;
  let evicted = false;

  function dropFront(excess: number) {
    while (excess > 0 && head < chunks.length) {
      const first = chunks[head] as Uint8Array;
      if (first.length <= excess) {
        head += 1;
        size -= first.length;
        excess -= first.length;
      } else {
        chunks[head] = first.subarray(excess);
        size -= excess;
        excess = 0;
      }
    }
    compact();
  }

  function compact() {
    if (head < 1024 || head < chunks.length / 2) return;
    chunks.splice(0, head);
    head = 0;
  }

  const live = () => chunks.slice(head);

  /** After the first eviction the start may sit mid-line or mid-character. */
  function alignStart() {
    let skip = 0;
    outer: for (const chunk of live()) {
      for (const byte of chunk) {
        if (byte === NEWLINE || byte === ESC) break outer;
        skip += 1;
      }
    }
    if (skip < size) dropFront(skip);
    while (head < chunks.length && isContinuation((chunks[head] as Uint8Array)[0] as number)) dropFront(1);
  }

  return {
    push(chunk) {
      if (chunk.length === 0) return;
      chunks.push(chunk.slice());
      size += chunk.length;
      if (size <= limit) return;
      dropFront(size - limit);
      if (!evicted) {
        evicted = true;
        alignStart();
      }
    },
    frames(frameSize) {
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of live()) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      const frames: Uint8Array[] = [];
      for (let start = 0; start < all.length; start += frameSize)
        frames.push(all.subarray(start, start + frameSize));
      return frames;
    },
    get size() {
      return size;
    },
  };
}
