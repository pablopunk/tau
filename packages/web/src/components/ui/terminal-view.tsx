import type { Terminal } from "@xterm/xterm";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { TERMINAL_FONT_FAMILY, terminalTheme } from "./terminal-theme";

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
/** After a reset the server replays old output; xterm answers the queries inside it (colors, cursor position), and those answers would reach the program now running. */
const REPLAY_QUIET_MS = 600;
const encoder = new TextEncoder();
const binaryBytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);

function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isLeaveCombo = (event: { key: string; ctrlKey: boolean; shiftKey: boolean }) =>
  event.ctrlKey && event.shiftKey && event.key === "ArrowUp";

/** The cell size comes from the font, so measure only once it is there; a failure falls back to the stack. */
async function loadFont() {
  try {
    await Promise.all([document.fonts.load('400 13px "JetBrains Mono"'), document.fonts.load('700 13px "JetBrains Mono"')]);
  } catch {}
}

async function createScreen(host: HTMLElement) {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
    import("@fontsource-variable/jetbrains-mono/wght.css"),
  ]);
  await loadFont();
  const fit = new FitAddon();
  const terminal = new Terminal({
    screenReaderMode: true,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 1,
    cursorBlink: true,
    scrollback: 5000,
    theme: terminalTheme(host),
  });
  terminal.loadAddon(fit);
  terminal.open(host);
  return { terminal, fit };
}

function wireScreen(terminal: Terminal, onInput: (data: Uint8Array) => void, isReplaying: () => boolean) {
  terminal.onData((text) => {
    if (text.startsWith("\x1b") && isReplaying()) return;
    onInput(encoder.encode(text));
  });
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
      let quietUntil = 0;
      wireScreen(
        terminal,
        (data) => latest.current.onInput(data),
        () => performance.now() < quietUntil,
      );
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
        terminal.options.theme = terminalTheme(element);
      });
      element.dataset.loaded = "true";
      refit();
      if (autoFocus) terminal.focus();
      latest.current.onHandle({
        write: (data) => terminal.write(data),
        reset: () => {
          quietUntil = performance.now() + REPLAY_QUIET_MS;
          terminal.reset();
        },
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
      className={cn("size-full min-h-0 overflow-hidden bg-[var(--terminal-bg)] p-3", className)}
    >
      <div ref={host} className="size-full" />
    </section>
  );
}
