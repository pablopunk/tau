import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalHandle } from "@/components/ui/terminal-view";
import { terminalApi } from "../terminal-api";
import {
  createTerminalConnection,
  type TerminalConnection,
  type TerminalSink,
  type TerminalStreamState,
} from "./terminal-connection";

export type { TerminalStreamState };

export interface TerminalStream {
  readonly state: TerminalStreamState;
  readonly bind: (handle: TerminalHandle | null) => void;
  readonly sendInput: (data: Uint8Array) => void;
  readonly sendResize: (cols: number, rows: number) => void;
}

type Pending = { reset: true } | { data: Uint8Array };

/** Output that arrives before xterm has loaded waits here, in order, and is flushed on `bind`. */
function createSink(): { sink: TerminalSink; bind: (handle: TerminalHandle | null) => void } {
  let handle: TerminalHandle | null = null;
  let pending: Pending[] = [];
  const apply = (item: Pending, target: TerminalHandle) =>
    "reset" in item ? target.reset() : target.write(item.data);
  const push = (item: Pending) => (handle ? apply(item, handle) : pending.push(item));
  return {
    sink: { write: (data) => push({ data }), reset: () => push({ reset: true }) },
    bind(next) {
      handle = next;
      if (!next) return;
      for (const item of pending) apply(item, next);
      pending = [];
    },
  };
}

export function useTerminalStream(terminalId: string): TerminalStream {
  const [state, setState] = useState<TerminalStreamState>({ status: "connecting", exitCode: null });
  const sinkRef = useRef(createSink());
  const connection = useRef<TerminalConnection | undefined>(undefined);
  const lastSize = useRef<{ cols: number; rows: number } | undefined>(undefined);

  useEffect(() => {
    setState({ status: "connecting", exitCode: null });
    const next = createTerminalConnection({
      open: (handlers) => terminalApi.openStream(terminalId, handlers),
      sink: sinkRef.current.sink,
      onState: setState,
    });
    connection.current = next;
    if (lastSize.current) next.sendResize(lastSize.current.cols, lastSize.current.rows);
    return () => {
      next.close();
      connection.current = undefined;
    };
  }, [terminalId]);

  const sendInput = useCallback((data: Uint8Array) => connection.current?.sendInput(data), []);
  const sendResize = useCallback((cols: number, rows: number) => {
    lastSize.current = { cols, rows };
    connection.current?.sendResize(cols, rows);
  }, []);
  const bind = useCallback((handle: TerminalHandle | null) => sinkRef.current.bind(handle), []);
  return { state, bind, sendInput, sendResize };
}
