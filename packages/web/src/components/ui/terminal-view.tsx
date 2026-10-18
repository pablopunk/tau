import type { ITheme, Terminal } from "@xterm/xterm";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface TerminalHandle {
  write(data: Uint8Array): void;
  /** Clears the screen and scrollback; the server replays right after. */
  reset(): void;
  focus(): void;
}

export interface TerminalViewProps {
  /** Typed bytes (also pasted text and mouse reports). */
  readonly onInput: (data: Uint8Array) => void;
  /** The fitted size, once xterm has loaded and again after each resize (debounced). */
  readonly onResize: (cols: number, rows: number) => void;
  /** Called with the screen once xterm has loaded, and with `null` on unmount. */
  readonly onHandle: (handle: TerminalHandle | null) => void;
  /** Ctrl+Shift+Up: xterm traps Tab, so this is the way back to the composer. */
  readonly onLeave?: () => void;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

const FIT_DEBOUNCE_MS = 80;
const encoder = new TextEncoder();
const binaryBytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);

function cssColor(host: HTMLElement, variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** Light and dark come from the theme variables, so a theme switch only needs this to run again. */
function themeOf(host: HTMLElement): ITheme {
  const foreground = cssColor(host, "--foreground");
  return {
    background: cssColor(host, "--background"),
    foreground,
    cursor: foreground,
    cursorAccent: cssColor(host, "--background"),
    selectionBackground: cssColor(host, "--muted-foreground"),
  };
}

function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isLeaveCombo = (event: { key: string; ctrlKey: boolean; shiftKey: boolean }) =>
  event.ctrlKey && event.shiftKey && event.key === "ArrowUp";

async function createScreen(host: HTMLElement) {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const fit = new FitAddon();
  const terminal = new Terminal({
    screenReaderMode: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: themeOf(host),
  });
  terminal.loadAddon(fit);
  terminal.open(host);
  return { terminal, fit };
}

function wireScreen(terminal: Terminal, onInput: (data: Uint8Array) => void) {
  terminal.onData((text) => onInput(encoder.encode(text)));
  terminal.onBinary((text) => onInput(binaryBytes(text)));
  terminal.attachCustomKeyEventHandler((event) => !isLeaveCombo(event));
}

/** The one effectful design-system part: xterm.js, loaded on first render so a thread view never pays for it. */
export function TerminalView({ onInput, onResize, onHandle, onLeave, autoFocus, className }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ onInput, onResize, onHandle, onLeave });
  latest.current = { onInput, onResize, onHandle, onLeave };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    void createScreen(element).then(({ terminal, fit }) => {
      if (disposed) return terminal.dispose();
      wireScreen(terminal, (data) => latest.current.onInput(data));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refit = () => {
        const size = fit.proposeDimensions();
        if (!size || !Number.isFinite(size.cols)) return;
        fit.fit();
        latest.current.onResize(terminal.cols, terminal.rows);
      };
      const observer = new ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(refit, FIT_DEBOUNCE_MS);
      });
      observer.observe(element);
      const stopTheme = watchTheme(() => {
        terminal.options.theme = themeOf(element);
      });
      element.dataset.loaded = "true";
      refit();
      if (autoFocus) terminal.focus();
      latest.current.onHandle({
        write: (data) => terminal.write(data),
        reset: () => terminal.reset(),
        focus: () => terminal.focus(),
      });
      cleanup = () => {
        clearTimeout(timer);
        observer.disconnect();
        stopTheme();
        latest.current.onHandle(null);
        terminal.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [autoFocus]);

  /** Global shortcuts listen on `window`; a terminal key must stop here, except the way back to the composer. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (isLeaveCombo(event)) latest.current.onLeave?.();
    event.stopPropagation();
  };

  return (
    <section
      aria-label="Terminal"
      onKeyDown={onKeyDown}
      className={cn("size-full min-h-0 overflow-hidden bg-background p-2", className)}
    >
      <div ref={host} className="size-full" />
    </section>
  );
}
