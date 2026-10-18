import type { TerminalDaemon, TerminalPort, TerminalPortOptions } from "../harness/terminal-daemon";

export interface FakeTerminalHandle {
  readonly options: TerminalPortOptions;
  readonly written: string[];
  readonly sizes: Array<[number, number]>;
  foregroundName: string | undefined;
  closed: boolean;
  /** Emit output as if the shell wrote it. */
  output(text: string | Uint8Array): void;
  /** End the shell on its own. */
  exit(code: number): void;
}

export interface FakeTerminalDaemon extends TerminalDaemon {
  readonly terminals: FakeTerminalHandle[];
  setAvailable(value: boolean): void;
  readonly closedCount: () => number;
}

/** A terminal daemon without a PTY: tests drive output and exit by hand. */
export function createFakeTerminalDaemon(initiallyAvailable = true): FakeTerminalDaemon {
  const terminals: FakeTerminalHandle[] = [];
  let available = initiallyAvailable;
  let closes = 0;

  async function open(options: TerminalPortOptions): Promise<TerminalPort> {
    let finish: (code: number | null) => void = () => undefined;
    const exited = new Promise<number | null>((resolve) => {
      finish = resolve;
    });
    const encoder = new TextEncoder();
    const handle: FakeTerminalHandle = {
      options,
      written: [],
      sizes: [[options.cols, options.rows]],
      foregroundName: undefined,
      closed: false,
      output: (text) => options.onData(typeof text === "string" ? encoder.encode(text) : text),
      exit: (code) => finish(code),
    };
    terminals.push(handle);
    return {
      write: (data) => handle.written.push(typeof data === "string" ? data : new TextDecoder().decode(data)),
      resize: (cols, rows) => handle.sizes.push([cols, rows]),
      close: () => {
        handle.closed = true;
        finish(null);
      },
      foreground: async () => (handle.foregroundName ? { pid: 1, name: handle.foregroundName } : undefined),
      exited,
    };
  }

  return {
    terminals,
    setAvailable: (value) => {
      available = value;
    },
    closedCount: () => closes,
    available: async () => available,
    open,
    async close() {
      closes += 1;
      for (const handle of terminals) handle.closed = true;
    },
  };
}
