export interface LineSplitter {
  push(chunk: string): void;
  /** Emits a held partial line, at the end of the stream. */
  flush(): void;
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let partial = "";
  return {
    push(chunk) {
      const parts = (partial + chunk).split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) onLine(line.replace(/\r$/, ""));
    },
    flush() {
      if (partial === "") return;
      const line = partial;
      partial = "";
      onLine(line);
    },
  };
}
