const TRACKED = new Set([1049, 47, 25, 1, 2004, 1000, 1002, 1003, 1006]);
const ESC = 0x1b;
const MAX_SEQUENCE = 40;

/** Remembers the last state of the private modes a full-screen job sets, so a cut ring can restore them. */
export interface ModeTracker {
  scan(chunk: Uint8Array): void;
  /** Escape sequences that set every mode seen to its last state. */
  prefix(): string;
}

const isParameterByte = (byte: number) => (byte >= 0x30 && byte <= 0x3b) || byte === 0x3f;

export function createModeTracker(): ModeTracker {
  const states = new Map<number, boolean>();
  let tail: number[] = [];

  function record(parameters: string, enable: boolean) {
    for (const part of parameters.split(";")) {
      const mode = Number(part);
      if (TRACKED.has(mode)) states.set(mode, enable);
    }
  }

  function readSequence(bytes: number[], start: number): { end: number } | "partial" | undefined {
    if (bytes[start + 1] === undefined) return "partial";
    if (bytes[start + 1] !== 0x5b) return undefined;
    if (bytes[start + 2] === undefined) return "partial";
    if (bytes[start + 2] !== 0x3f) return undefined;
    let index = start + 3;
    while (index < bytes.length && isParameterByte(bytes[index] as number)) index += 1;
    if (index >= bytes.length) return index - start > MAX_SEQUENCE ? undefined : "partial";
    const final = bytes[index] as number;
    if (final === 0x68 || final === 0x6c) {
      record(String.fromCharCode(...bytes.slice(start + 3, index)), final === 0x68);
    }
    return { end: index + 1 };
  }

  return {
    scan(chunk) {
      const bytes = tail.length > 0 ? [...tail, ...chunk] : Array.from(chunk);
      tail = [];
      let index = 0;
      while (index < bytes.length) {
        if (bytes[index] !== ESC) {
          index += 1;
          continue;
        }
        const found = readSequence(bytes, index);
        if (found === "partial") {
          tail = bytes.slice(index);
          return;
        }
        index = found ? found.end : index + 1;
      }
    },
    prefix() {
      let text = "";
      for (const [mode, enabled] of states) text += `\x1b[?${mode}${enabled ? "h" : "l"}`;
      return text;
    },
  };
}
